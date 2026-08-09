import type { StateStore } from '../../core/ports/repositories';
import { defaultPostJourney, type AppState, type CustomPhase, type PostJourneyState } from '../../core/domain/state';
import type { Difficulty, EnergyLevel, JeeRelevance, PhaseId, TaskBankEntry, TaskType, ThinkingSkill } from '../../core/domain/task-bank';
import type { DailyPlan, ProgressionConfig } from '../../core/domain/progress';
import { DEFAULT_PROGRESSION_CONFIG } from '../../core/domain/progress';
import type { ChatToolAction, ChatToolActionResult, ChatToolResult } from '../../core/domain/chat-tools';
import { CHAT_TOOL_CATALOG, chatToolActionSchema, chatToolBatchSchema, type ChatToolMeta } from '../../core/domain/chat-tools';
import { AiActionRegistry, executeAiAction } from '../../core/domain/ai-actions';
import type { HabitProgressionService } from '../habit-engine/planner';
import type { TaskBankService } from '../task-bank/task-bank.service';
import type { TaskGenerationService } from '../ai/task-generation.service';
import type { PlannerToolsService } from '../planner/planner.service';
import { plannerActionForQuery, type PlannerToolAction } from '../../core/domain/subject-planner';
import { isAbortError } from '../../core/domain/llm';
import { formatDayLabel, formatPlanProgress, formatScheduledTasks } from './plan-format';
import { buildContextOverview } from './context-overview';
import { isoAddDays } from '../habit-engine/dates';
import { deviceTimeZone, todayISO, type Clock } from '../../core/ports/clock';

const MIN_DAY = 1;
const MAX_DAY = 90;
const MAX_RANGE_DAYS = 10;
/** Fallback duration (minutes) when the model omits durationMin on addTask/bulkAddTasks. */
const DEFAULT_TASK_DURATION_MIN = 45;

const ACTIONS = new AiActionRegistry();
ACTIONS.register({ id: 'addTask', label: 'Add task', description: 'Create an editable task for one plan day.', entityType: 'dynamicTaskBank', permissions: ['create'] });
ACTIONS.register({ id: 'editTask', label: 'Edit task', description: 'Override a built-in or dynamic task.', entityType: 'dynamicTaskBank', permissions: ['edit'] });
ACTIONS.register({ id: 'removeTask', label: 'Remove task from a day', description: 'Hide a task for one day only; the task bank is never modified.', entityType: 'dynamicTaskBank', permissions: ['delete'], confirmationRequired: true });
ACTIONS.register({ id: 'bulkRemoveTasks', label: 'Bulk remove from day', description: 'Hide multiple tasks for one day only; the task bank is never modified.', entityType: 'dynamicTaskBank', permissions: ['bulk-edit'], confirmationRequired: true, supportsBulk: true });
ACTIONS.register({ id: 'markDone', label: 'Mark task done', description: 'Update completion log for one task.', entityType: 'taskLogs', permissions: ['edit'] });
ACTIONS.register({ id: 'bulkMarkDone', label: 'Bulk mark done', description: 'Update completion logs for multiple tasks.', entityType: 'taskLogs', permissions: ['bulk-edit'], confirmationRequired: true, supportsBulk: true });
ACTIONS.register({ id: 'setDayMode', label: 'Mark rest/study day', description: 'Mark or unmark a journey day as a rest (holiday) day.', entityType: 'restDays', permissions: ['edit'], confirmationRequired: true });
// Task Bank management
ACTIONS.register({ id: 'editAnyTask', label: 'Edit any task', description: 'Edit any task in the task bank (title, duration, category).', entityType: 'taskBank', permissions: ['edit'] });
ACTIONS.register({ id: 'deleteAnyTask', label: 'Delete task from bank', description: 'Permanently delete a task from the task bank.', entityType: 'taskBank', permissions: ['delete'], confirmationRequired: true });
// Block management actions
ACTIONS.register({ id: 'createBlock', label: 'Create custom block', description: 'Create a custom study block for post-journey mode.', entityType: 'customBlocks', permissions: ['create'] });
ACTIONS.register({ id: 'deleteBlock', label: 'Delete block', description: 'Delete a custom study block.', entityType: 'customBlocks', permissions: ['delete'], confirmationRequired: true });
ACTIONS.register({ id: 'activateBlock', label: 'Activate block', description: 'Set a custom block as active.', entityType: 'customBlocks', permissions: ['edit'] });

// Strong plan/block action words. A message containing any of these is
// clearly about the plan, task bank or custom blocks.
const TASK_QUERY_WORDS = [
  'task', 'plan', 'din', 'day', 'aaj', 'kal', 'parso', 'week', 'hafta', 'month', 'mahina',
  'mark', 'done', 'complete', 'delete', 'remove', 'hata', 'hatao', 'add', 'badlo', 'badal',
  'schedule', 'change', 'edit', 'update', 'replan', 'reschedule', 'shift', 'increase',
  'decrease', 'reduce', 'goal', 'target', 'revision', 'padhai', 'tasks', 'saare', 'all', 'bulk',
  // Hinglish & Action triggers
  'karo', 'karna', 'banao', 'bana', 'dikhao', 'show', 'check', 'status', 'progress',
  'score', 'streak', 'history', 'backup', 'sync', 'reset', 'clear', 'uncomplete',
  'pending', 'todo', 'audit', 'analyze', 'summary', 'report',
  // Study workflow triggers
  'study', 'padhna', 'syllabus', 'chapter', 'mock',
  'test', 'questions', 'problems', 'notes', 'formula', 'jee', 'exam', 'rank', 'percentile',
  // Block-related anchors
  'block', 'phase', 'activate', 'extend', 'list',
  // Real-user Hinglish/English — high-precision plan/task/rest intent.
  // Deliberately generic conversation words (batao/dekh/kya/next/left) are
  // excluded: each match costs an extra decision-hop LLM call, so only words
  // with strong plan/task/rest intent belong here.
  'tomorrow', 'bacha', 'bache', 'remaining', 'chutti', 'holiday', 'rest', 'skip', 'chhod',
  'cancel', 'adjust', 'postpone', 'delay', 'routine', 'timetable', 'time table',
  'taiyari', 'preparation', 'revise', 'planner', 'deadline', 'due',
];

// Words that look like plan words but are ALSO general-chat subjects
// ("concept samjhao", "is problem ka solution"). They only route to tools when
// they appear inside a custom-block command (anchored by block/phase + verb).
const BLOCK_COMMAND_WORDS = ['banao', 'bana', 'create', 'delete', 'remove', 'hatao', 'activate', 'extend', 'shuru', 'custom'];

// Block type configurations
const BLOCK_TYPES: Record<string, { name: string; icon: string; habits: Record<string, string[]> }> = {
  physics: { name: 'Physics', icon: '⚛️', habits: { easy: ['Read HCV Concepts'], medium: ['Read HCV Concepts', 'Solve 10 Problems'], hard: ['Read HCV Concepts', 'Solve 20 Problems', 'Formula Revision'] } },
  chemistry: { name: 'Chemistry', icon: '🧪', habits: { easy: ['NCERT Reading'], medium: ['NCERT Reading', 'Reaction Practice'], hard: ['NCERT Reading', 'Reaction Practice', 'JEE Patterns'] } },
  maths: { name: 'Maths', icon: '🔢', habits: { easy: ['Daily Practice'], medium: ['Daily Practice', 'Previous Year Questions'], hard: ['Daily Practice', 'Previous Year Questions', 'Speed Calculation'] } },
  revision: { name: 'Revision', icon: '📖', habits: { easy: ['Topic Recap'], medium: ['Topic Recap', 'Quick Revisions'], hard: ['Topic Recap', 'Quick Revisions', 'Flashcards'] } },
  mock: { name: 'Mock Test', icon: '🧠', habits: { easy: ['Full Mock'], medium: ['Full Mock', 'Analysis'], hard: ['Full Mock', 'Analysis', 'Weak Topic Focus'] } },
  concept: { name: 'Concept Building', icon: '💡', habits: { easy: ['Theory Reading'], medium: ['Theory Reading', 'Example Problems'], hard: ['Theory Reading', 'Example Problems', 'Concept Map'] } },
  problem: { name: 'Problem Solving', icon: '🔬', habits: { easy: ['Problem Sets'], medium: ['Problem Sets', 'Time Trials'], hard: ['Problem Sets', 'Time Trials', 'Error Analysis'] } },
};

type TaskMetadataPatch = Partial<{
  description: string;
  habitId: string;
  phase: PhaseId;
  difficulty: number;
  energyLevel: EnergyLevel;
  tags: string[];
  prerequisites: string[];
  taskType: TaskType;
  revisionSuitability: number;
  backlogSuitability: number;
  thinkingSkills: ThinkingSkill[];
  jeeRelevance: JeeRelevance;
}>;

const METADATA_KEYS: Array<keyof TaskMetadataPatch> = [
  'description',
  'habitId',
  'phase',
  'difficulty',
  'energyLevel',
  'tags',
  'prerequisites',
  'taskType',
  'revisionSuitability',
  'backlogSuitability',
  'thinkingSkills',
  'jeeRelevance',
];

/**
 * Normalizes a task title for duplicate detection: lowercase + punctuation/
 * whitespace collapsed, so "Kinematics revision!", " Kinematics revision " and
 * "Kinematics revision" all count as the same task on a day.
 */
function normalizeTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Executes the deterministic chat tools against the app store. Mutations go
 * through the StateStore so the UI snapshot and every service stay in sync.
 */
export class ChatToolsService {
  private readonly store: StateStore;
  private readonly planner: HabitProgressionService;
  private readonly taskBank: TaskBankService;
  private readonly taskGeneration: TaskGenerationService;
  private readonly config: ProgressionConfig;
  private readonly plannerTools: PlannerToolsService | null;
  private readonly now: Clock;

  constructor(
    store: StateStore,
    planner: HabitProgressionService,
    taskBank: TaskBankService,
    taskGeneration: TaskGenerationService,
    config: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG,
    plannerTools: PlannerToolsService | null = null,
    now: Clock = { now: () => new Date() },
  ) {
    this.store = store;
    this.planner = planner;
    this.taskBank = taskBank;
    this.taskGeneration = taskGeneration;
    this.config = config;
    this.plannerTools = plannerTools;
    this.now = now;
  }

  /** True when the student imported at least one coaching planner. */
  hasPlannerData(): boolean {
    return this.plannerTools ? this.plannerTools.hasPlannerData() : false;
  }

  /** The full user-pickable tool set for the chat "@" tool-scope picker. */
  listTools(): ChatToolMeta[] {
    return CHAT_TOOL_CATALOG;
  }

  /** Picks the tools the user pinned via "@" mentions — validates ids so a
   *  stale/unknown mention can never slip through into the decision prompt. */
  resolveToolScope(ids: string[]): string[] {
    const known = new Set(CHAT_TOOL_CATALOG.map((t) => t.id));
    return [...new Set(ids)].filter((id) => known.has(id));
  }

  /** Cheap heuristic: does this message plausibly ask about the plan/tasks?
   *  General concept questions ("concept samjhao", "physics kaise padhein")
   *  deliberately do NOT route to tools — only concrete plan/task/block
   *  commands do. "concept building block banao" still works because it is
   *  anchored on block + a command verb. Uploaded-planner questions route to
   *  the SAME tools hop (tests/routine/subjects) when planner data exists. */
  isTaskQuery(text: string): boolean {
    if (this.hasPlannerData() && this.plannerTools && this.plannerTools.isPlannerQuery(text)) return true;
    const t = text.toLowerCase();
    if (TASK_QUERY_WORDS.some((w) => t.includes(w))) return true;
    if (!t.includes('block') && !t.includes('phase')) return false;
    return BLOCK_COMMAND_WORDS.some((w) => t.includes(w));
  }

  /** True when the message is about uploaded coaching planners AND no planner
   *  data exists — callers use this to keep the LLM hop planner-scoped even
   *  before an import, so it never drifts to plan/task tools. */
  isPlannerQueryOnly(text: string): boolean {
    return this.plannerTools ? this.plannerTools.isPlannerQuery(text) : false;
  }

  /**
   * Deterministic planner fast path: resolves UNAMBIGUOUS uploaded-planner
   * questions ("friday ka schedule batao", "tests dekho", "physics mein kya
   * kya hai") straight to one planner tool action, so the right planner tool
   * is used even when the LLM would drift to getPlan/getAllTasks. Returns null
   * when the LLM decision hop should decide. Subject guesses are only accepted
   * when they match imported data.
   */
  plannerActionFor(text: string, todayISO: string): ChatToolAction | null {
    if (!this.hasPlannerData()) return null;
    const action = plannerActionForQuery(text, todayISO);
    if (!action) return null;
    if (action.action === 'getSubject' && !this.subjectDataMatch(action.subject)) return null;
    return action;
  }

  private subjectDataMatch(subject: string): boolean {
    const w = subject.toLowerCase();
    return (this.store.get().subjectPlanners ?? []).some(
      (p) => p.subject.toLowerCase().includes(w) || w.includes(p.subject.toLowerCase()),
    );
  }

  /**
   * Deterministic getContext fast path: whole-journey overview questions
   * ("mera progress kya hai", "status batao", "context batao", "streak kitna
   * hai") resolve straight to getContext instead of letting the model guess a
   * plan day. Explicit plan/test/subject anchors are excluded so "day 5 ka
   * summary" still reaches the normal LLM decision hop.
   */
  contextActionFor(text: string): ChatToolAction | null {
    const t = text.toLowerCase().trim();
    if (!t) return null;
    const EXCLUDED = /\b(day\s*\d+|din\s*\d+|plan|schedule|routine|timetable|syllabus|test|subject|task|block|aaj|kal|parso|is week|hafta|mahina|chapter)\b/;
    if (EXCLUDED.test(t)) return null;
    // "progress mat dikhao" is a refusal, not a request for context — a naive
    // keyword match would answer with a full overview the user asked NOT to see.
    const NEGATION = /\b(mat|nahi|nhi|mata|na hi|don'?t|dont|not|never)\b/;
    if (NEGATION.test(t)) return null;
    if (/\bcontext\b/.test(t)) return { action: 'getContext' };
    if (
      /\b(overview|status|progress|streak|journey|report|summary)\b/.test(t) &&
      /\b(batao|dekho|dikhao|de do|check|kya hai|kaisa|kitna|chahiye|chal raha)\b/.test(t)
    ) {
      return { action: 'getContext' };
    }
    return null;
  }

  /** Extracts and validates a single tool action from the model reply. */
  parseTool(text: string): ChatToolAction | null {
    const actions = this.parseTools(text);
    return actions.length === 1 ? actions[0] : null;
  }

  /**
   * Extracts tool actions from the model reply. Accepts a single action object,
   * a batch wrapper {"actions":[...]} or a bare array — in any JSON or prose.
   * Also parses Python-style tool calls ("print(removeTask(task_id=...))") so
   * models trained on Python output still execute the batch instead of failing.
   */
  parseTools(text: string): ChatToolAction[] {
    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.slice(objStart, objEnd + 1));
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined) {
        const single = chatToolActionSchema.safeParse(parsed);
        if (single.success) return [single.data as ChatToolAction];
        const batch = chatToolBatchSchema.safeParse(parsed);
        if (batch.success) return batch.data.actions;
        // If the model emitted an actions wrapper but one action is incomplete
        // (for example addTask without required durationMin), fail the whole
        // decision so ChatService can issue the strict retry instead of silently
        // executing only the valid subset.
        if (typeof parsed === 'object' && parsed !== null && 'actions' in parsed) return [];
      }
    }
    const arrStart = text.indexOf('[');
    const arrEnd = text.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try {
        const parsedArr: unknown = JSON.parse(text.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsedArr)) {
          const parsedActions = parsedArr.map((a) => chatToolActionSchema.safeParse(a));
          if (parsedActions.every((r) => r.success)) {
            return parsedActions.map((r) => (r as { success: true; data: ChatToolAction }).data).slice(0, 100);
          }
          // Not a valid action array — fall through to python-call parsing
          // instead of failing (e.g. intents=["a","b"] inside a python call).
        }
      } catch {
        // fall through
      }
    }
    const python = parsePythonToolCalls(text);
    if (python.length > 0) return python;
    return [];
  }

  /**
   * Diagnoses WHY `parseTools` returned no actions, when the reply looks like
   * a genuine (if broken) tool-call attempt — a recognized action name with a
   * missing/invalid field (e.g. setDayMode without "mode"), an unknown action
   * name, or an actions-batch with one bad entry. Returns the exact zod
   * validation message so the retry prompt can tell the model precisely what
   * to fix, instead of a generic "answer with JSON" nudge that doesn't help
   * when the model already tried and just got a field wrong.
   *
   * Returns null when the reply doesn't look like a tool attempt at all (pure
   * prose) — that case keeps the existing generic CHAT_TOOL_RETRY message.
   */
  describeParseFailure(text: string): string | null {
    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    if (objStart === -1 || objEnd <= objStart) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(objStart, objEnd + 1));
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    // Batch wrapper: report the first bad entry that names a REAL action.
    // An entry naming an unknown/hallucinated action (e.g. the disallowed
    // "websearch") is left for the default fallback to handle, same as
    // before — only recognized-but-malformed actions get specific feedback.
    if ('actions' in parsed && Array.isArray((parsed as { actions: unknown }).actions)) {
      const list = (parsed as { actions: unknown[] }).actions;
      for (let i = 0; i < list.length; i++) {
        if (!isKnownActionName(describeActionField(list[i]))) continue;
        const result = chatToolActionSchema.safeParse(list[i]);
        if (!result.success) {
          return `actions[${i}] (action: ${describeActionField(list[i])}) is invalid: ${formatZodIssues(result.error.issues)}`;
        }
      }
      return null; // no bad entry naming a known action — nothing specific to report
    }

    // Single action object.
    if ('action' in parsed && isKnownActionName(describeActionField(parsed))) {
      const result = chatToolActionSchema.safeParse(parsed);
      if (!result.success) {
        return `Your JSON had "action":"${describeActionField(parsed)}" but: ${formatZodIssues(result.error.issues)}`;
      }
    }
    return null;
  }

  /**
   * Executes a batch of actions in order. If any destructive/bulk action lacks
   * explicit confirmation, the WHOLE batch is previewed and nothing is applied
   * — partial execution of a multi-part request is never allowed.
   */
  async runMany(actions: ChatToolAction[]): Promise<ChatToolResult> {
    if (actions.length === 0) return { ok: false, summary: 'Koi tool action nahi mila.' };
    const needsConfirm = actions.filter((a) => {
      const meta = ACTIONS.list().find((x) => x.id === a.action);
      return meta?.confirmationRequired === true && !('confirmed' in a && a.confirmed === true);
    });
    if (needsConfirm.length > 0) {
      const lines = needsConfirm.map((a) => {
        const label = ACTIONS.list().find((x) => x.id === a.action)?.label ?? a.action;
        const target =
          'taskId' in a && a.taskId ? ` task "${a.taskId}"` : 'taskIds' in a && a.taskIds?.length ? ` tasks ${a.taskIds.join(', ')}` : '';
        const dayLabel = 'day' in a ? `Day ${a.day}` : '';
        return `- ${label}${dayLabel ? ` for ${dayLabel}` : ''}${target}`;
      });
      return {
        ok: false,
        requiresConfirmation: true,
        summary:
          'Preview only — inhe confirm karna hoga (destructive/bulk):\n' +
          lines.join('\n') +
          '\nJab user confirm kare, poora batch wapas bhejo, in destructive actions par "confirmed":true ke saath.',
      };
    }
    const summaries: string[] = [];
    let anyOk = false;
    let confirmationPending = false;
    const missingDays = new Set<number>();
    const results: ChatToolActionResult[] = [];
    for (const a of actions) {
      const r = await this.run(a);
      summaries.push(r.summary);
      if (r.ok) anyOk = true;
      else if (r.requiresConfirmation) confirmationPending = true;
      for (const d of r.missingTaskIdDays ?? []) missingDays.add(d);
      results.push({
        action: a.action,
        ok: r.ok,
        summary: r.summary,
        requiresConfirmation: r.requiresConfirmation,
        missingTaskIdDays: r.missingTaskIdDays,
        retryable: r.retryable,
      });
    }
    return {
      ok: anyOk && !confirmationPending,
      requiresConfirmation: confirmationPending || undefined,
      summary: summaries.join('\n'),
      missingTaskIdDays: missingDays.size > 0 ? [...missingDays] : undefined,
      results,
    };
  }

  /**
   * Deterministic getPlan summaries for the given days — used by the chat
   * service to show the model a day's real task ids after a guessed-id failure.
   */
  renderPlans(days: number[]): string {
    const state = this.store.get();
    const unique = [...new Set(days)].sort((a, b) => a - b);
    return unique.map((d) => this.getPlan(state, d).summary).join('\n\n');
  }

  async run(action: ChatToolAction): Promise<ChatToolResult> {
    const state = this.store.get();
    try {
      switch (action.action) {
        case 'getPlan':
          return this.getPlan(state, action.day);
        case 'getRange':
          return this.getRange(state, action.fromDay, action.toDay);
        case 'addTask':
          return await this.addTask(state, action);
        case 'bulkAddTasks':
          return await this.bulkAddTasks(state, action);
        case 'removeTask':
          return this.removeTask(state, action.day, action.taskId, action.confirmed === true);
        case 'bulkRemoveTasks':
          return this.bulkRemoveTasks(state, action.day, action.taskIds, action.confirmed === true);
        case 'setDayMode':
          return this.setDayMode(state, action.day, action.mode, action.confirmed === true);
        case 'editTask':
          return this.editTask(state, action);
        case 'markDone':
          return this.markDone(state, action.day, action.taskId);
        case 'bulkMarkDone':
          return this.bulkMarkDone(state, action.day, action.taskIds, action.confirmed === true);
        case 'createBlock':
          return this.createBlock(state, action);
        case 'deleteBlock':
          return this.deleteBlock(state, action.blockId, action.confirmed === true);
        case 'activateBlock':
          return this.activateBlock(state, action.blockId);
        case 'editBlock':
          return this.editBlock(state, action);
        case 'listBlocks':
          return this.listBlocks(state);
        case 'extendBlock':
          return this.extendBlock(state, action.blockId, action.days);
        // Task Bank Management
        case 'getAllTasks':
          return this.getAllTasks(state, action.day);
        case 'getTaskBank':
          return this.getTaskBank(state, action.category);
        case 'editAnyTask':
          return this.editAnyTask(state, action);
        case 'deleteAnyTask':
          return this.deleteAnyTask(state, action.taskId, action.confirmed === true);
        case 'getContext':
          return await this.getContext(state);
        // Read-only uploaded-coaching-planner actions — delegated to the
        // PlannerToolsService so the model can read subjects/tests/routine in
        // the SAME hop as the task tools.
        case 'listPlanners':
        case 'getSubject':
        case 'getPlanner':
        case 'getTest':
        case 'getTests':
        case 'getRoutine':
        case 'getDay':
          return this.runPlanner(action);
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      return { ok: false, summary: err instanceof Error ? err.message : 'tool execution failed' };
    }
  }

  /** Delegates one planner action to the deterministic planner executor. */
  private async runPlanner(action: ChatToolAction): Promise<ChatToolResult> {
    if (!this.plannerTools) return { ok: false, summary: 'Planner tools available nahi hain.' };
    const result = await this.plannerTools.runMany([action as unknown as PlannerToolAction]);
    return { ok: result.ok, summary: result.summary, retryable: result.retryable };
  }

  /**
   * Deterministic getContext tool: the full current-journey snapshot (date,
   * day/phase/streak, today's tasks + progress, XP/habits/gaps) plus post-journey
   * blocks and uploaded-planner summary — read-only, always succeeds.
   */
  private async getContext(state: AppState): Promise<ChatToolResult> {
    const timeZone = state.timeZone ?? deviceTimeZone();
    const dateISO = todayISO(this.now, timeZone);
    const lines: string[] = [buildContextOverview(state, dateISO, this.planner, this.config)];
    const blocks = sortBlocks(state.postJourney?.customPhases ?? []);
    if (blocks.length > 0) {
      const active = state.postJourney?.activeCustomPhaseId;
      const activeName = blocks.find((b) => b.id === active)?.name;
      lines.push(
        `Post-journey blocks: ${blocks.length} — ${blocks.map((b) => `${b.name} (Days ${b.dayStart}-${b.dayEnd})`).join(', ')}.${activeName ? ` Active: ${activeName}.` : ' No active block.'}`,
      );
    }
    if (this.hasPlannerData() && this.plannerTools) {
      const plannerList = await this.plannerTools.runMany([{ action: 'listPlanners' }]);
      if (plannerList.ok) lines.push(`Uploaded coaching planners:\n${plannerList.summary}`);
    }
    return { ok: true, summary: lines.join('\n') };
  }

  // ========== BLOCK MANAGEMENT ==========

  private createBlock(state: AppState, action: Extract<ChatToolAction, { action: 'createBlock' }>): ChatToolResult {
    const { name, description, days = 15, dayStart, focusAreas = [], difficulty = 'medium', goals = [], habits = [] } = action;
    const duration = clampBlockDays(days);
    const existingBlocks = sortBlocks(state.postJourney?.customPhases ?? []);

    const effectiveFocus = focusAreas.length > 0 ? focusAreas : this.detectFocusAreas(name);
    const difficultyLevel = difficulty as 'easy' | 'medium' | 'hard' | 'extreme';
    const generatedHabits = habits.length > 0 ? habits : this.generateHabitsForFocus(effectiveFocus, difficultyLevel);
    const generatedGoals = goals.length > 0 ? goals : [`Master ${effectiveFocus.join(', ') || 'topics'}`, 'Complete daily practice', 'Track progress'];
    const startDay = Math.max(91, dayStart ?? nextBlockStart(existingBlocks));

    const block = {
      id: createBlockId(),
      name,
      description: description ?? `Custom block focused on ${effectiveFocus.join(', ') || 'study'} with ${difficultyLevel} difficulty`,
      dayStart: startDay,
      dayEnd: startDay + duration - 1,
      goals: generatedGoals,
      habits: generatedHabits,
      difficulty: difficultyLevel,
      createdBy: 'ai' as const,
      createdAt: new Date().toISOString().slice(0, 10),
    };

    const customPhases = sortBlocks([...existingBlocks, block]);
    this.store.save(withPostJourney(state, {
      customPhases,
      activeCustomPhaseId: block.id,
      journeyComplete: true,
      completedAt: state.postJourney?.completedAt ?? new Date().toISOString(),
      extensionDays: extensionDaysFor(customPhases),
    }));

    const focusList = effectiveFocus.map(f => BLOCK_TYPES[f] ? `${BLOCK_TYPES[f].icon} ${BLOCK_TYPES[f].name}` : f).join(', ');
    return {
      ok: true,
      summary: `✅ Created and activated "${block.name}" (id:${block.id})!\n\n📅 Days ${block.dayStart}-${block.dayEnd} (${duration} days)\n📝 ${block.description}\n🎯 Focus: ${focusList || 'General'}\n⚡ Difficulty: ${difficultyLevel}\n\n📋 Habits:\n${generatedHabits.map(h => `• ${h}`).join('\n') || '• General study'}\n\n🎯 Goals:\n${generatedGoals.map(g => `• ${g}`).join('\n')}\n\nTotal post-journey extension: ${extensionDaysFor(customPhases)} days.`,
    };
  }

  private deleteBlock(state: AppState, blockId: string, confirmed: boolean): ChatToolResult {
    const blocks = sortBlocks(state.postJourney?.customPhases ?? []);
    const block = blocks.find(b => b.id === blockId);

    if (!block) return { ok: false, retryable: true, summary: `Block "${blockId}" not found. Use listBlocks to get valid block IDs.` };

    if (!confirmed) {
      return {
        ok: false,
        requiresConfirmation: true,
        summary: `⚠️ Delete "${block.name}" (id:${blockId}, Days ${block.dayStart}-${block.dayEnd})?\n\nHabits: ${block.habits.join(', ') || 'none'}\nGoals: ${block.goals.join(', ') || 'none'}\n\nSay the action again with "confirmed":true to confirm.`,
      };
    }

    const customPhases = blocks.filter(b => b.id !== blockId);
    const currentActive = state.postJourney?.activeCustomPhaseId;
    const activeCustomPhaseId = currentActive === blockId ? (customPhases[0]?.id ?? null) : (currentActive ?? null);
    this.store.save(withPostJourney(state, {
      customPhases,
      activeCustomPhaseId,
      extensionDays: extensionDaysFor(customPhases),
    }));
    return { ok: true, summary: `🗑️ Deleted "${block.name}". ${activeCustomPhaseId ? `Active block is now ${activeCustomPhaseId}.` : 'No active block now.'}` };
  }

  private activateBlock(state: AppState, blockId: string): ChatToolResult {
    const blocks = sortBlocks(state.postJourney?.customPhases ?? []);
    const block = blocks.find(b => b.id === blockId);

    if (!block) return { ok: false, retryable: true, summary: `Block "${blockId}" not found. Use listBlocks to get valid block IDs.` };

    this.store.save(withPostJourney(state, { activeCustomPhaseId: blockId, journeyComplete: true }));

    return {
      ok: true,
      summary: `✅ Activated "${block.name}" (id:${block.id})!\n\n${formatBlockDetails(block)}`,
    };
  }

  private listBlocks(state: AppState): ChatToolResult {
    const blocks = sortBlocks(state.postJourney?.customPhases ?? []);
    const activeId = state.postJourney?.activeCustomPhaseId;

    if (blocks.length === 0) {
      return { ok: true, summary: `📋 No custom blocks yet.\n\nSay "create a 15 day physics block" to make your first block!` };
    }

    const list = blocks.map((b, i) => `${i + 1}. ${b.id === activeId ? '🟢 ACTIVE' : '⚪'} ${formatBlockDetails(b)}`).join('\n\n');

    return {
      ok: true,
      summary: `📋 Your Custom Blocks (${blocks.length}, extension ${extensionDaysFor(blocks)} days):\n\n${list}\n\nUse exact block IDs above for edit/delete/activate/extend commands.`,
    };
  }

  private editBlock(state: AppState, action: Extract<ChatToolAction, { action: 'editBlock' }>): ChatToolResult {
    const { blockId, name, description, difficulty, goals, habits, dayStart, dayEnd, days } = action;
    const blocks = sortBlocks(state.postJourney?.customPhases ?? []);
    const block = blocks.find(b => b.id === blockId);

    if (!block) return { ok: false, retryable: true, summary: `Block "${blockId}" not found. Use listBlocks first, then retry with the exact id.` };
    if (!hasBlockEdit(action)) return { ok: false, retryable: true, summary: `Block "${blockId}": edit ke liye name, description, difficulty, days/dayStart/dayEnd, goals ya habits field chahiye. Use listBlocks first, then retry.` };

    const nextStart = dayStart ?? block.dayStart;
    const nextEnd = days !== undefined ? nextStart + clampBlockDays(days) - 1 : (dayEnd ?? block.dayEnd);
    if (nextEnd < nextStart) return { ok: false, retryable: true, summary: `Block "${blockId}": dayEnd (${nextEnd}) dayStart (${nextStart}) se pehle nahi ho sakta.` };

    const updated: typeof block = {
      ...block,
      name: name ?? block.name,
      description: description ?? block.description,
      dayStart: nextStart,
      dayEnd: nextEnd,
      difficulty: (difficulty as typeof block.difficulty) ?? block.difficulty,
      goals: goals ?? block.goals,
      habits: habits ?? block.habits,
    };

    const customPhases = sortBlocks(blocks.map(b => b.id === blockId ? updated : b));
    this.store.save(withPostJourney(state, { customPhases, extensionDays: extensionDaysFor(customPhases) }));

    const changes: string[] = [];
    if (name) changes.push(`name → "${name}"`);
    if (description) changes.push('description updated');
    if (difficulty) changes.push(`difficulty → ${difficulty}`);
    if (dayStart !== undefined || dayEnd !== undefined || days !== undefined) changes.push(`days → ${updated.dayStart}-${updated.dayEnd}`);
    if (goals) changes.push(`${goals.length} goals`);
    if (habits) changes.push(`${habits.length} habits`);

    return { ok: true, summary: `✅ Updated block. Changes: ${changes.join(', ')}\n\n${formatBlockDetails(updated)}` };
  }

  private extendBlock(state: AppState, blockId: string, daysToAdd: number): ChatToolResult {
    const blocks = sortBlocks(state.postJourney?.customPhases ?? []);
    const block = blocks.find(b => b.id === blockId);

    if (!block) return { ok: false, retryable: true, summary: `Block "${blockId}" not found. Use listBlocks to get valid block IDs.` };

    const extra = clampBlockDays(daysToAdd, 30);
    const updatedBlocks = blocks.map(b => {
      if (b.id === blockId) return { ...b, dayEnd: b.dayEnd + extra };
      if (b.dayStart > block.dayEnd) return { ...b, dayStart: b.dayStart + extra, dayEnd: b.dayEnd + extra };
      return b;
    });
    const customPhases = sortBlocks(updatedBlocks);

    this.store.save(withPostJourney(state, { customPhases, extensionDays: extensionDaysFor(customPhases) }));
    const updated = customPhases.find(b => b.id === blockId)!;

    return { ok: true, summary: `✅ Extended "${block.name}" by ${extra} days.\n\n${formatBlockDetails(updated)}\n\nLater blocks shifted forward; total extension is ${extensionDaysFor(customPhases)} days.` };
  }

  // ========== TASK BANK MANAGEMENT ==========

  private getAllTasks(state: AppState, day: number): ChatToolResult {
    const d = clamp(day);
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    
    const dateISO = this.dateForDay(state, d);
    const plan = this.planForDay(state, d);
    const dynamicTasks = state.dynamicTaskBank.filter(t => 
      t.unlockConditions.some(c => c.type === 'day-exact' && c.day === d)
    );
    
    const lines: string[] = [];
    lines.push(`📋 All Tasks for Day ${d} — ${formatDayLabel(dateISO)} (${dateISO}):\n`);
    
    if (plan.tasks.length === 0) {
      lines.push('No tasks scheduled for this day.');
    } else {
      lines.push(`\n🔵 Scheduled Tasks (${plan.tasks.length}):`);
      for (const item of plan.tasks) {
        const entry = item.entry;
        const isDynamic = entry.id.startsWith('ai-') || dynamicTasks.some(t => t.id === entry.id);
        const creator = isDynamic ? '🤖 AI' : '📚 Bank';
        lines.push(`\n• ${creator} **${entry.title}** (ID: ${entry.id})`);
        lines.push(`  ⏱️ ${entry.estimatedDurationMin} min`);
        lines.push(...formatFullTaskInfo(entry, '  '));
      }
    }
    
    lines.push(`\n\n💡 AI can add more tasks with: addTask, bulkAddTasks`);
    
    return { ok: true, summary: lines.join('\n') };
  }

  private getTaskBank(state: AppState, category?: string): ChatToolResult {
    const allTasks = this.taskBank.getAll();
    const dynamicTasks = state.dynamicTaskBank.filter(t => !t.unlockConditions.some(c => c.type === 'day-exact'));
    
    const combined = [...allTasks, ...dynamicTasks];
    
    // Filter by category if provided
    const filtered = category 
      ? combined.filter(t => 
          t.tags.some(tag => tag.toLowerCase().includes(category.toLowerCase())) ||
          t.title.toLowerCase().includes(category.toLowerCase())
        )
      : combined;
    
    if (filtered.length === 0) {
      return { 
        ok: true, 
        summary: category 
          ? `No tasks found for "${category}". Try: physics, chemistry, maths, revision, mock, concept, problem`
          : 'Task bank is empty.' 
      };
    }
    
    const lines: string[] = [];
    lines.push(`📚 Task Bank (${filtered.length} tasks${category ? ` in "${category}"` : ''}):\n`);
    
    // Group by tags
    const byTag: Record<string, typeof filtered> = {};
    for (const task of filtered) {
      const tag = task.tags[0] || 'General';
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(task);
    }
    
    for (const [tag, tasks] of Object.entries(byTag)) {
      lines.push(`\n🏷️ ${tag} (${tasks.length}):`);
      for (const task of tasks.slice(0, 10)) {
        const isDynamic = task.id.startsWith('ai-');
        const creator = isDynamic ? '🤖' : '📚';
        lines.push(`  ${creator} **${task.title}** (ID: ${task.id}, ${task.estimatedDurationMin}min)`);
        lines.push(...formatFullTaskInfo(task, '    '));
      }
      if (tasks.length > 10) {
        lines.push(`  ... +${tasks.length - 10} more`);
      }
    }
    
    lines.push(`\n\n💡 Use editAnyTask or deleteAnyTask to modify any task by ID.`);
    
    return { ok: true, summary: lines.join('\n') };
  }

  private editAnyTask(state: AppState, action: Extract<ChatToolAction, { action: 'editAnyTask' }>): ChatToolResult {
    const { taskId, title, durationMin, category } = action;
    
    // Check in dynamic task bank first; base tasks are also editable via the
    // same id-matched override that the task bank screen uses.
    const dynamicIdx = state.dynamicTaskBank.findIndex(t => t.id === taskId);
    const baseTask = this.taskBank.getById(taskId);
    if (dynamicIdx === -1 && !baseTask) {
      return { ok: false, retryable: true, summary: `Task "${taskId}" not found in any task bank. Pehle getTaskBank/getAllTasks se valid task id dekh lo, phir retry karo.` };
    }
    
    const task = dynamicIdx !== -1 ? state.dynamicTaskBank[dynamicIdx] : baseTask!;
    if (!hasTaskEdit(action) && !category) {
      return { ok: false, retryable: true, summary: `Task "${taskId}": edit ke liye title, durationMin, category ya metadata field chahiye. Pehle getTaskBank/getAllTasks se full info dekho, phir retry karo.` };
    }
    const updated = applyTaskMetadata(
      {
        ...task,
        title: title ?? task.title,
        estimatedDurationMin: durationMin ?? task.estimatedDurationMin,
        tags: category ? [category, ...task.tags.filter(t => t !== category)] : task.tags,
        active: true,
      },
      action,
    );
    
    // A base task edit becomes a full override (same id) so the change is real
    // and survives — mirroring TaskBankScreen.saveEdit.
    const next = dynamicIdx !== -1
      ? state.dynamicTaskBank.map((t, i) => i === dynamicIdx ? updated : t)
      : [...state.dynamicTaskBank, updated];
    
    this.store.save({ ...state, dynamicTaskBank: next });
    
    const changes: string[] = [];
    if (title) changes.push(`title → "${title}"`);
    if (durationMin) changes.push(`duration → ${durationMin} min`);
    if (category) changes.push(`tag → ${category}`);
    
    return {
      ok: true,
      summary: `Updated task "${updated.title}"!\n\nChanges: ${changes.join(', ')}`,
    };
  }

  private deleteAnyTask(state: AppState, taskId: string, confirmed: boolean): ChatToolResult {
    const dynamicIdx = state.dynamicTaskBank.findIndex(t => t.id === taskId);
    const baseTask = this.taskBank.getById(taskId);
    const task = dynamicIdx !== -1 ? state.dynamicTaskBank[dynamicIdx] : baseTask;
    
    if (!task) {
      return { ok: false, retryable: true, summary: `Task "${taskId}" not found in any task bank. Pehle getTaskBank se valid task id dekho, phir retry karo.` };
    }
    
    if (!confirmed) {
      return {
        ok: false,
        requiresConfirmation: true,
        summary: `Delete task "${task.title}" (ID: ${taskId})?\n\nSay the action again with "confirmed":true to confirm.`,
      };
    }
    
    // Custom tasks are removed outright; base tasks are hidden with an
    // active:false override (seed never mutates) — same as TaskBankScreen.deleteTask.
    const next = dynamicIdx !== -1
      ? state.dynamicTaskBank.filter(t => t.id !== taskId)
      : [...state.dynamicTaskBank, { ...task, active: false }];
    
    this.store.save({ ...state, dynamicTaskBank: next });
    
    const note = dynamicIdx === -1 ? ' (hidden from plans; seed task protected)' : '';
    return { ok: true, summary: `Deleted task "${task.title}".${note}` };
  }

  private detectFocusAreas(text: string): string[] {
    const lower = text.toLowerCase();
    const detected: string[] = [];
    
    const keywords: Record<string, string> = {
      'physics': 'physics', 'phys': 'physics', 'hcv': 'physics',
      'chemistry': 'chemistry', 'chem': 'chemistry', 'ncert': 'chemistry',
      'maths': 'maths', 'math': 'maths', 'mathematics': 'maths',
      'revision': 'revision', 'revise': 'revision', 'review': 'revision',
      'mock': 'mock', 'test': 'mock', 'exam': 'mock',
      'concept': 'concept', 'theory': 'concept',
      'problem': 'problem', 'solve': 'problem', 'practice': 'problem',
    };
    
    for (const [keyword, focusId] of Object.entries(keywords)) {
      if (lower.includes(keyword) && !detected.includes(focusId)) {
        detected.push(focusId);
      }
    }
    
    return detected;
  }

  private generateHabitsForFocus(focusAreas: string[], difficulty: 'easy' | 'medium' | 'hard' | 'extreme'): string[] {
    const habits: string[] = [];
    const level = difficulty === 'extreme' ? 'hard' : difficulty;
    
    for (const area of focusAreas) {
      const config = BLOCK_TYPES[area];
      if (config?.habits[level]) {
        habits.push(...config.habits[level]);
      }
    }
    
    return [...new Set(habits)].slice(0, 6);
  }

  // Helper to get blocks summary (can be called from AI prompts)
  private getPlan(state: AppState, day: number): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const isRest = (state.restDays ?? []).includes(d);
    const plan = this.planner.buildPlan(state, dateISO, this.config);
    if (plan.tasks.length === 0) {
      return {
        ok: true,
        summary: isRest
          ? `Day ${d} — ${formatDayLabel(dateISO)} (${dateISO}): REST DAY (chhuti). No auto tasks; sirf explicitly scheduled tasks hi dikhte hain.`
          : `Day ${d} — ${formatDayLabel(dateISO)} (${dateISO}): no tasks planned.`,
      };
    }
    const lines = [`Day ${d} plan — ${formatDayLabel(dateISO)} (${dateISO})${isRest ? ' [REST DAY]' : ''} — ${formatPlanProgress(plan, state)}:`];
    lines.push(...formatScheduledTasks(plan, state));
    return { ok: true, summary: lines.join('\n') };
  }

  private getRange(state: AppState, fromDay: number, toDay: number): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const from = clamp(Math.min(fromDay, toDay));
    const to = clamp(Math.max(fromDay, toDay));
    const span = to - from + 1;
    if (span > MAX_RANGE_DAYS) {
      // No hard failure: split into ≤7-day windows so "next 15 din ka plan"
      // just works in one call instead of erroring out.
      const parts: string[] = [];
      for (let f = from; f <= to; f += MAX_RANGE_DAYS) {
        const t = Math.min(f + MAX_RANGE_DAYS - 1, to);
        parts.push(this.formatRange(state, f, t));
      }
      return { ok: true, summary: parts.join('\n\n') };
    }
    return { ok: true, summary: this.formatRange(state, from, to) };
  }

  private formatRange(state: AppState, from: number, to: number): string {
    const lines = [`Plan overview Day ${from}-${to}:`];
    for (let d = from; d <= to; d++) {
      const plan = this.planForDay(state, d);
      const dateISO = this.dateForDay(state, d);
      const rest = (state.restDays ?? []).includes(d);
      const first = formatScheduledTasks(plan, state, 4).join('; ');
      lines.push(`Day ${d} — ${formatDayLabel(dateISO)} (${dateISO})${rest ? ' [REST DAY]' : ''}: ${formatPlanProgress(plan, state)}. ${first}`);
    }
    return lines.join('\n');
  }

  private async addTask(state: AppState, action: Extract<ChatToolAction, { action: 'addTask' }>): Promise<ChatToolResult> {
    const d = clamp(action.day);
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    // durationMin is optional in the schema — default it here so a model that
    // omits the field still gets a real task instead of a rejected action.
    const durationMin = action.durationMin ?? DEFAULT_TASK_DURATION_MIN;
    const existingTitles = this.dayTaskTitles(state, d);
    if (existingTitles.has(normalizeTaskTitle(action.intent))) {
      return {
        ok: false,
        summary: `Day ${d}: "${action.intent}" is already on this day's plan — duplicate add blocked, kuch nahi badla.`,
      };
    }
    let entry: TaskBankEntry;
    try {
      const result = await this.taskGeneration.generate(state, {
        intent: action.intent,
        dayNumber: d,
        durationMin,
      });
      entry = applyTaskMetadata(
        result.source === 'bank' ? cloneBankTask(result.entry, d) : scheduleForDay(result.entry, d),
        action,
      );
    } catch {
      entry = createLocalTask(action.intent, d, durationMin, action);
    }
    if (existingTitles.has(normalizeTaskTitle(entry.title))) {
      return {
        ok: false,
        summary: `Day ${d}: "${entry.title}" is already on this day's plan — duplicate add blocked, kuch nahi badla.`,
      };
    }
    const next = state.dynamicTaskBank.some((e) => e.id === entry.id)
      ? state.dynamicTaskBank.map((e) => (e.id === entry.id ? entry : e))
      : [...state.dynamicTaskBank, entry];
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('addTask'),
      entityId: entry.id,
      summary: `Added for Day ${d}: ${entry.title} (id:${entry.id}, ${entry.estimatedDurationMin}min)`,
      beforeState: state.dynamicTaskBank,
      afterState: next,
      confirmed: true,
    });
    this.store.save(resultAction.state);
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `${resultAction.summary} It is scheduled ONLY for Day ${d}. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private async bulkAddTasks(state: AppState, action: Extract<ChatToolAction, { action: 'bulkAddTasks' }>): Promise<ChatToolResult> {
    const d = clamp(action.day);
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const durationMin = action.durationMin ?? DEFAULT_TASK_DURATION_MIN;
    const existingTitles = this.dayTaskTitles(state, d);
    const added: TaskBankEntry[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];
    for (const intent of action.intents.slice(0, 100)) {
      // Duplicate guard: same task already on this day (or just added in this
      // batch) is skipped instead of re-added.
      if (existingTitles.has(normalizeTaskTitle(intent))) {
        skipped.push(intent);
        continue;
      }
      try {
        const result = await this.taskGeneration.generate(state, {
          intent,
          dayNumber: d,
          durationMin,
        });
        const entry = applyTaskMetadata(
          result.source === 'bank' ? cloneBankTask(result.entry, d) : scheduleForDay(result.entry, d),
          action,
        );
        if (existingTitles.has(normalizeTaskTitle(entry.title))) {
          skipped.push(intent);
          continue;
        }
        added.push(entry);
        existingTitles.add(normalizeTaskTitle(entry.title));
      } catch {
        // Provider/model failure must not make a user-visible add fail. Keep
        // the batch moving with a deterministic local task.
        added.push(createLocalTask(intent, d, durationMin, action));
        existingTitles.add(normalizeTaskTitle(intent));
        failed.push(intent);
      }
    }
    if (added.length === 0) {
      return {
        ok: false,
        summary: `Day ${d}: koi naya task add nahi hua${skipped.length ? ` — already exist: ${skipped.join('; ')}` : ''}${failed.length ? ` (fail hua: ${failed.join('; ')})` : ''}.`,
      };
    }
    let next = [...state.dynamicTaskBank];
    for (const entry of added) {
      next = next.some((e) => e.id === entry.id) ? next.map((e) => (e.id === entry.id ? entry : e)) : [...next, entry];
    }
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('addTask'),
      entityId: added.map((a) => a.id).join(','),
      summary: `Added ${added.length} task(s) for Day ${d}: ${added.map((a) => a.title).join('; ')}`,
      beforeState: state.dynamicTaskBank,
      afterState: next,
      confirmed: true,
    });
    this.store.save(resultAction.state);
    const failedNote = failed.length > 0 ? `\n${failed.length} task(s) AI se generate nahi hue, local fallback se add kar diye: ${failed.join('; ')}.` : '';
    const skippedNote = skipped.length > 0 ? `\n${skipped.length} task(s) already exist, duplicate avoid karne ke liye skip kar diye: ${skipped.join('; ')}.` : '';
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `${resultAction.summary}${failedNote}${skippedNote} All added tasks scheduled ONLY for Day ${d}. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private bulkRemoveTasks(state: AppState, day: number, taskIds: string[] | undefined, confirmed = false): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const plan = this.planForDay(state, d);
    const visible = new Map(plan.tasks.map((item) => [item.entry.id, item.entry]));
    const ids = taskIds ?? [];
    if (ids.length === 0) return { ok: false, retryable: true, summary: `Day ${d}: task id(s) chahiye (plan se).` };
    const invalid = ids.filter((id) => !visible.has(id));
    if (invalid.length > 0) return { ok: false, retryable: true, summary: `Day ${d}: task id(s) planned list mein nahi mile: ${invalid.join(', ')}.`, missingTaskIdDays: [d] };

    let next = [...state.dynamicTaskBank];
    for (const id of ids) {
      const entry = visible.get(id);
      if (!entry) continue;
      next = applyDayRemoval(next, entry, d);
    }
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('bulkRemoveTasks'),
      entityId: `${this.dateForDay(state, d)}:bulk:${ids.join(',')}`,
      summary: `remove ${ids.length} task(s) from Day ${d} (bank untouched)`,
      beforeState: state.dynamicTaskBank,
      afterState: next,
      confirmed,
    });
    if (!resultAction.ok) return { ok: false, requiresConfirmation: resultAction.requiresConfirmation, summary: resultAction.summary };
    this.store.save(resultAction.state);
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `Removed ${ids.length} task(s) from Day ${d} (${this.dateForDay(state, d)}) — sirf is din se, task bank kabhi delete nahi hota. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private removeTask(state: AppState, day: number, taskId: string, confirmed = false): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const plan = this.planForDay(state, d);
    const planned = plan.tasks.find((t) => t.entry.id === taskId);
    if (!planned) {
      const known = state.dynamicTaskBank.find((e) => e.id === taskId) ?? this.taskBank.getById(taskId);
      if (!known) return { ok: false, retryable: true, summary: `Day ${d}: task id "${taskId}" nahi mila.`, missingTaskIdDays: [d] };
      return { ok: false, retryable: true, summary: `Day ${d}: "${known.title}" is day ke plan mein nahi hai (shayad kisi aur din ke liye scheduled). Pehle getPlan bhejo.`, missingTaskIdDays: [d] };
    }
    const next = applyDayRemoval([...state.dynamicTaskBank], planned.entry, d);
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('removeTask'),
      entityId: taskId,
      summary: `remove task ${planned.entry.title} from Day ${d} (bank untouched)`,
      beforeState: state.dynamicTaskBank,
      afterState: next,
      confirmed,
    });
    if (!resultAction.ok) return { ok: false, requiresConfirmation: resultAction.requiresConfirmation, summary: resultAction.summary };
    this.store.save(resultAction.state);
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `Removed from Day ${d}: ${planned.entry.title} (id:${taskId}) — sirf is din se, task bank kabhi delete nahi hota. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private setDayMode(state: AppState, day: number, mode: 'study' | 'rest', confirmed = false): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const wantsRest = mode === 'rest';
    const current = (state.restDays ?? []).includes(d);
    if (current === wantsRest) {
      return { ok: true, summary: `Day ${d} already ${wantsRest ? 'rest (chhuti) hai' : 'study day hai'}. ${this.planPreview(state, d)}` };
    }
    const next = wantsRest ? [...(state.restDays ?? []), d] : (state.restDays ?? []).filter((x) => x !== d);
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('setDayMode'),
      entityId: this.dateForDay(state, d),
      summary: `${wantsRest ? 'mark rest (holiday)' : 'mark study'} Day ${d} (${this.dateForDay(state, d)})`,
      beforeState: state.restDays,
      afterState: next,
      confirmed,
    });
    if (!resultAction.ok) return { ok: false, requiresConfirmation: resultAction.requiresConfirmation, summary: resultAction.summary };
    this.store.save(resultAction.state);
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `Day ${d} ab ${wantsRest ? 'REST DAY (chhuti) hai — sirf explicitly scheduled tasks dikhenge' : 'normal study day hai'}. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private editTask(state: AppState, action: Extract<ChatToolAction, { action: 'editTask' }>): ChatToolResult {
    const d = clamp(action.day);
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const dynamic = state.dynamicTaskBank.find((e) => e.id === action.taskId);
    const entry = dynamic ?? this.taskBank.getById(action.taskId);
    if (!entry) return { ok: false, retryable: true, summary: `Day ${d}: task id "${action.taskId}" nahi mila.`, missingTaskIdDays: [d] };
    if (!hasTaskEdit(action)) {
      return { ok: false, retryable: true, summary: `Day ${d}: edit ke liye title, durationMin, dayTo ya metadata field chahiye. Pehle getPlan/getAllTasks se task info dekho, phir exact field ke saath retry karo.`, missingTaskIdDays: [d] };
    }
    const edited: typeof entry = applyTaskMetadata(
      {
        ...entry,
        title: action.title !== undefined ? action.title : entry.title,
        estimatedDurationMin: action.durationMin !== undefined ? clamp(action.durationMin) : entry.estimatedDurationMin,
        unlockConditions:
          action.dayTo !== undefined ? [{ type: 'day-exact' as const, day: clamp(action.dayTo) }] : entry.unlockConditions,
      },
      action,
    );
    const next = dynamic
      ? state.dynamicTaskBank.map((e) => (e.id === edited.id ? edited : e))
      : [...state.dynamicTaskBank, edited];
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('editTask'),
      entityId: edited.id,
      summary: `Edited Day ${d}: ${edited.title} (${edited.estimatedDurationMin}min)`,
      beforeState: state.dynamicTaskBank,
      afterState: next,
      confirmed: true,
    });
    this.store.save(resultAction.state);
    const moved = action.dayTo !== undefined ? ` and moved to Day ${clamp(action.dayTo)} (sirf usi din dikhega)` : '';
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `${resultAction.summary}${moved}. ${this.planPreview(resultAction.state, action.dayTo ?? d)}`,
    };
  }

  private markDone(state: AppState, day: number, taskId: string): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const logKey = this.logKeyForTask(state, d, taskId);
    if (!logKey) {
      return {
        ok: false,
        retryable: true,
        summary: `Day ${d}: task id "${taskId}" is day ke plan mein nahi hai — sirf planned tasks ko done mark kiya ja sakta hai. Pehle getPlan bhejo aur planned task id use karo.`,
        missingTaskIdDays: [d],
      };
    }
    const log = { ...(state.taskLogs[logKey] ?? {}) };
    log[taskId] = true;
    const nextLogs = { ...state.taskLogs, [logKey]: log };
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('markDone'),
      entityId: `${logKey}:${taskId}`,
      summary: `Marked done for Day ${d} (${dateISO}): ${this.taskBank.getById(taskId)?.title ?? taskId}`,
      beforeState: state.taskLogs,
      afterState: nextLogs,
      confirmed: true,
    });
    this.store.save(resultAction.state);
    return { ok: true, versionId: resultAction.versionId, summary: resultAction.summary };
  }


  private bulkMarkDone(state: AppState, day: number, taskIds: string[] | undefined, confirmed = false): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const plan = this.planForDay(state, d);
    const visible = new Map(plan.tasks.map((item) => [item.entry.id, item.logKey]));
    const ids = taskIds && taskIds.length > 0 ? taskIds : [...visible.keys()];
    const invalid = ids.filter((id) => !visible.has(id));
    if (ids.length === 0) return { ok: false, retryable: true, summary: `Day ${d}: koi tasks planned nahi hain.` };
    if (invalid.length > 0) return { ok: false, retryable: true, summary: `Day ${d}: task id(s) planned list mein nahi mile: ${invalid.join(', ')}.`, missingTaskIdDays: [d] };

    const nextLogs = { ...state.taskLogs };
    for (const id of ids) {
      const key = visible.get(id) ?? dateISO;
      nextLogs[key] = { ...(nextLogs[key] ?? {}), [id]: true };
    }
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('bulkMarkDone'),
      entityId: `${dateISO}:bulk:${ids.join(',')}`,
      summary: `mark ${ids.length} task(s) done for Day ${d} (${dateISO})`,
      beforeState: state.taskLogs,
      afterState: nextLogs,
      confirmed,
    });
    if (!resultAction.ok) return { ok: false, requiresConfirmation: resultAction.requiresConfirmation, summary: resultAction.summary };
    this.store.save(resultAction.state);
    return { ok: true, versionId: resultAction.versionId, summary: `Marked ${ids.length} task(s) done for Day ${d} (${dateISO}). Version:${resultAction.versionId ?? 'n/a'}. Undo available in AI Activity.` };
  }


  private logKeyForTask(state: AppState, day: number, taskId: string): string | null {
    // Only tasks actually on the day's plan get a completion log. An unlocked
    // or guessed bank id that was never scheduled must NOT silently log under
    // today's date — that would be a fake success.
    const planned = this.planForDay(state, day).tasks.find((task) => task.entry.id === taskId);
    return planned ? planned.logKey : null;
  }

  /** Compact after-mutation view of a day's plan so the AI can narrate results. */
  private planPreview(state: AppState, day: number): string {
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const plan = this.planForDay(state, d);
    const rest = (state.restDays ?? []).includes(d);
    if (plan.tasks.length === 0) {
      return rest
        ? `Day ${d} (${formatDayLabel(dateISO)}) ab REST DAY hai — plan khali.`
        : `Day ${d} — ${formatDayLabel(dateISO)} (${dateISO}): no tasks planned.`;
    }
    const lines = [`Updated plan Day ${d} — ${formatDayLabel(dateISO)} (${dateISO})${rest ? ' [REST DAY]' : ''} — ${formatPlanProgress(plan, state)}:`];
    lines.push(...formatScheduledTasks(plan, state));
    return lines.join('\n');
  }

  private planForDay(state: AppState, day: number): DailyPlan {
    const dateISO = this.dateForDay(state, day);
    return this.planner.buildPlan(state, dateISO, this.config);
  }

  /** Normalized titles already scheduled on a day (used to block duplicate adds). */
  private dayTaskTitles(state: AppState, day: number): Set<string> {
    return new Set(this.planForDay(state, day).tasks.map((item) => normalizeTaskTitle(item.entry.title)));
  }

  /**
   * Day → ISO date, computed in pure UTC — MUST match the planner's
   * `rawDayNumberForDate` (also UTC). Mixing local-time parsing with
   * `toISOString()` shifts every date by a day on non-UTC machines, which
   * would write completion logs under the wrong calendar day.
   */
  private dateForDay(state: AppState, day: number): string {
    if (!state.startDateISO) {
      throw new Error('Cannot map plan day to a date without a journey start date.');
    }
    return isoAddDays(state.startDateISO, day - 1);
  }
}



function hasBlockEdit(action: Record<string, unknown>): boolean {
  return Boolean(
    action.name !== undefined ||
    action.description !== undefined ||
    action.difficulty !== undefined ||
    action.goals !== undefined ||
    action.habits !== undefined ||
    action.dayStart !== undefined ||
    action.dayEnd !== undefined ||
    action.days !== undefined
  );
}

function withPostJourney(state: AppState, patch: Partial<PostJourneyState>): AppState {
  const current = state.postJourney ?? defaultPostJourney();
  const nextPostJourney: PostJourneyState = {
    ...current,
    ...patch,
    mastery: patch.mastery ?? current.mastery,
    customPhases: patch.customPhases ?? current.customPhases,
    pendingAISuggestions: patch.pendingAISuggestions ?? current.pendingAISuggestions,
    finalStats: patch.finalStats ?? current.finalStats,
  };
  return { ...state, postJourney: nextPostJourney };
}

function sortBlocks(blocks: CustomPhase[]): CustomPhase[] {
  return [...blocks].sort((a, b) => a.dayStart - b.dayStart || a.dayEnd - b.dayEnd || a.name.localeCompare(b.name));
}

function nextBlockStart(blocks: CustomPhase[]): number {
  return Math.max(90, ...blocks.map((b) => b.dayEnd)) + 1;
}

function extensionDaysFor(blocks: CustomPhase[]): number {
  return Math.max(0, ...blocks.map((b) => b.dayEnd - 90));
}

function clampBlockDays(days: number, max = 90): number {
  if (!Number.isFinite(days)) return 1;
  return Math.min(Math.max(Math.round(days), 1), max);
}

function createBlockId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `block-${crypto.randomUUID().slice(0, 8)}`;
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createTaskId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `ai-${crypto.randomUUID().slice(0, 8)}`;
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatBlockDetails(block: CustomPhase): string {
  return [
    `**${block.name}** (id:${block.id})`,
    `Days ${block.dayStart}-${block.dayEnd} · ${block.dayEnd - block.dayStart + 1} days · ${block.difficulty}`,
    `📝 ${block.description}`,
    `📋 Habits: ${block.habits.length > 0 ? block.habits.join(', ') : 'none'}`,
    `🎯 Goals: ${block.goals.length > 0 ? block.goals.join(', ') : 'none'}`,
    `${block.createdBy === 'ai' ? '🤖 AI' : '👤 User'} · created:${block.createdAt}`,
  ].join('\n   ');
}

function createLocalTask(intent: string, day: number, durationMin: number, metadata: TaskMetadataPatch = {}): TaskBankEntry {
  const title = intent.replace(/\s+/g, ' ').trim().slice(0, 90) || 'Focused study task';
  const lower = title.toLowerCase();
  const subject = lower.includes('physics') ? 'physics' : lower.includes('chemistry') ? 'chemistry' : lower.includes('math') ? 'maths' : undefined;
  return applyTaskMetadata(
    {
      id: createTaskId(),
      habitId: metadata.habitId ?? 'h1',
      title,
      description: metadata.description ?? `Local fallback task from chat request: ${title}`,
      phase: metadata.phase ?? 'jee-core',
      difficulty: clampDifficulty(metadata.difficulty ?? 2),
      estimatedDurationMin: clamp(durationMin),
      energyLevel: metadata.energyLevel ?? (durationMin >= 90 ? 'high' : durationMin >= 45 ? 'medium' : 'low'),
      tags: metadata.tags ?? ['ai-fallback', ...(subject ? [subject] : [])],
      prerequisites: metadata.prerequisites ?? [],
      taskType: metadata.taskType ?? 'Beginner',
      revisionSuitability: metadata.revisionSuitability ?? 0.4,
      backlogSuitability: metadata.backlogSuitability ?? 0.4,
      thinkingSkills: metadata.thinkingSkills ?? ['planning', 'focus'],
      jeeRelevance: metadata.jeeRelevance ?? { subject, score: 0.5 },
      unlockConditions: [{ type: 'day-exact', day }],
      active: true,
    },
    metadata,
  );
}

function hasTaskEdit(action: Record<string, unknown>): boolean {
  return Boolean(action.title !== undefined || action.durationMin !== undefined || action.dayTo !== undefined || METADATA_KEYS.some((key) => action[key] !== undefined));
}

function applyTaskMetadata<T extends TaskBankEntry>(entry: T, patch: TaskMetadataPatch): T {
  const next: TaskBankEntry = { ...entry };
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.habitId !== undefined) next.habitId = patch.habitId;
  if (patch.phase !== undefined) next.phase = patch.phase;
  if (patch.difficulty !== undefined) next.difficulty = clampDifficulty(patch.difficulty);
  if (patch.energyLevel !== undefined) next.energyLevel = patch.energyLevel;
  if (patch.tags !== undefined) next.tags = [...patch.tags];
  if (patch.prerequisites !== undefined) next.prerequisites = [...patch.prerequisites];
  if (patch.taskType !== undefined) next.taskType = patch.taskType;
  if (patch.revisionSuitability !== undefined) next.revisionSuitability = patch.revisionSuitability;
  if (patch.backlogSuitability !== undefined) next.backlogSuitability = patch.backlogSuitability;
  if (patch.thinkingSkills !== undefined) next.thinkingSkills = [...patch.thinkingSkills];
  if (patch.jeeRelevance !== undefined) next.jeeRelevance = { ...patch.jeeRelevance };
  return next as T;
}

function clampDifficulty(value: number): Difficulty {
  return Math.min(5, Math.max(1, Math.round(value))) as Difficulty;
}

function formatFullTaskInfo(entry: TaskBankEntry, prefix = ''): string[] {
  const lines = [
    `${prefix}📝 ${entry.description || 'No description'}`,
    `${prefix}🔧 habit:${entry.habitId} phase:${entry.phase} difficulty:${entry.difficulty}/5 energy:${entry.energyLevel} type:${entry.taskType}`,
    `${prefix}📈 revision:${entry.revisionSuitability} backlog:${entry.backlogSuitability} jee:${entry.jeeRelevance.score}${entry.jeeRelevance.subject ? ` subject:${entry.jeeRelevance.subject}` : ''}${entry.jeeRelevance.examWindow ? ' examWindow:true' : ''}`,
  ];
  if (entry.tags.length > 0) lines.push(`${prefix}🏷️ tags:${entry.tags.join(', ')}`);
  if (entry.prerequisites.length > 0) lines.push(`${prefix}🧩 prerequisites:${entry.prerequisites.join(', ')}`);
  if (entry.thinkingSkills.length > 0) lines.push(`${prefix}🧠 thinking:${entry.thinkingSkills.join(', ')}`);
  lines.push(`${prefix}🔓 unlock:${entry.unlockConditions.map(formatUnlockCondition).join('; ')}`);
  return lines;
}

function formatUnlockCondition(condition: TaskBankEntry['unlockConditions'][number]): string {
  switch (condition.type) {
    case 'day': return `day>=${condition.fromDay}`;
    case 'day-exact': return `day=${condition.day}`;
    case 'not-day': return `not-day=${condition.day}`;
    case 'phase': return `phase=${condition.phase}`;
    case 'habit': return `habit=${condition.habitId}`;
    case 'exam-window': return `exam-window<=${condition.daysBeforeExam}`;
    case 'mock-sunday': return 'mock-sunday';
    case 'weekday': return `weekday=${condition.days.join(',')}`;
    case 'day-in': return `day-in=${condition.days.join(',')}`;
    case 'recovery': return 'recovery';
    case 'backlog': return `backlog>=${condition.thresholdDays}`;
    case 'revision': return `revision>${condition.dueAfterDays}`;
  }
}

function clamp(day: number): number {
  if (!Number.isFinite(day)) return MIN_DAY;
  return Math.min(Math.max(day, MIN_DAY), MAX_DAY);
}

function scheduleForDay(entry: TaskBankEntry, day: number): TaskBankEntry {
  return { ...entry, unlockConditions: [{ type: 'day-exact', day }], active: true };
}

/**
 * Day-scoped removal. Explicitly scheduled (day-exact) tasks are deleted for
 * that day; curriculum/built-in tasks get a `not-day` override so they stay in
 * the Task Bank and keep appearing on every OTHER day. The seed bank is never
 * modified.
 */
function applyDayRemoval(next: TaskBankEntry[], entry: TaskBankEntry, day: number): TaskBankEntry[] {
  const dynIdx = next.findIndex((e) => e.id === entry.id);
  const existing = dynIdx !== -1 ? next[dynIdx] : undefined;
  const isExplicit = existing?.unlockConditions.some((c) => c.type === 'day-exact' && c.day === day);
  if (isExplicit) return dynIdx !== -1 ? next.filter((e) => e.id !== entry.id) : next;
  const base = existing ?? entry;
  if (base.unlockConditions.some((c) => c.type === 'not-day' && c.day === day)) return next;
  const updated: TaskBankEntry = {
    ...base,
    active: true,
    unlockConditions: [...base.unlockConditions, { type: 'not-day', day }],
  };
  return dynIdx !== -1 ? next.map((e) => (e.id === updated.id ? updated : e)) : [...next, updated];
}

function cloneBankTask(entry: TaskBankEntry, day: number): TaskBankEntry {
  return {
    ...scheduleForDay(entry, day),
    id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    legacy: undefined,
  };
}

// ========== PYTHON-STYLE TOOL CALL PARSING ==========
// Some models emit tool calls as Python: `print(removeTask(task_id="d1_t3",
// day_id="Day 1"))` or bare `removeTask(day=1, intent="...")`. Without this
// parser the decision hop sees no JSON, falls back to prose, and the requested
// work never runs. These helpers convert such calls into validated actions.

const PYTHON_TOOL_NAME = '(getPlan|getRange|getAllTasks|getTaskBank|addTask|bulkAddTasks|removeTask|bulkRemoveTasks|setDayMode|editTask|markDone|bulkMarkDone|editAnyTask|deleteAnyTask|createBlock|deleteBlock|activateBlock|editBlock|listBlocks|extendBlock|listPlanners|getSubject|getPlanner|getTest|getTests|getRoutine|getContext)';

/** Splits an argument list on top-level commas (ignores commas inside quotes/brackets). */
function splitPythonArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '[' || ch === '(' || ch === '{') {
      depth += 1;
      current += ch;
    } else if (ch === ']' || ch === ')' || ch === '}') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

function parsePythonValue(raw: string): unknown {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  if (/^(?:True|true|False|false)$/.test(v)) return v.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('(') && v.endsWith(')'))) {
    const inner = v.slice(1, -1);
    return splitPythonArgs(inner).map(parsePythonValue).filter((x) => x !== '');
  }
  return v;
}

/** Python "Day 1" / "Day 3" labels and plain numbers → day number; weekday
 *  strings like "Monday" (getRoutine) pass through untouched. */
function coercePythonDay(v: unknown): number | string {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/^\s*(?:day\s*)?(\d+)\s*$/i);
    if (m) return Number(m[1]);
    return v;
  }
  return String(v);
}

function convertPythonArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const aliases: Record<string, string> = {
    task_id: 'taskId',
    task_ids: 'taskIds',
    day_id: 'day',
    day_to: 'dayTo',
    duration_min: 'durationMin',
    from_day: 'fromDay',
    to_day: 'toDay',
    test_name: 'testName',
    planner_id: 'plannerId',
  };
  const out: Record<string, unknown> = { action: name };
  for (const [k, v] of Object.entries(args)) {
    out[aliases[k] ?? k] = v;
  }
  for (const dayKey of ['day', 'dayTo', 'fromDay', 'toDay']) {
    if (out[dayKey] !== undefined) out[dayKey] = coercePythonDay(out[dayKey]);
  }
  return out;
}

function parsePythonArgs(s: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of splitPythonArgs(s)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = parsePythonValue(part.slice(eq + 1));
  }
  return out;
}

/** All recognized action names, derived straight from the schema so this can never drift out of sync. */
const KNOWN_ACTIONS = new Set<string>(chatToolActionSchema.options.map((o) => o.shape.action.value));

function isKnownActionName(name: string): boolean {
  return KNOWN_ACTIONS.has(name);
}

function describeActionField(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && 'action' in raw) {
    const a = (raw as { action: unknown }).action;
    if (typeof a === 'string') return a;
  }
  return 'unknown';
}

/** Formats zod issues as short, model-readable "field: message" lines. */
function formatZodIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

/** Extracts every Python-style tool call in the text into validated actions. */
function parsePythonToolCalls(text: string): ChatToolAction[] {
  const callRe = new RegExp(`(?:print\\s*\\(\\s*)?${PYTHON_TOOL_NAME}\\s*\\(([^)]*)\\)`, 'g');
  const out: ChatToolAction[] = [];
  for (const m of text.matchAll(callRe)) {
    const converted = convertPythonArgs(m[1], parsePythonArgs(m[2]));
    const parsed = chatToolActionSchema.safeParse(converted);
    if (parsed.success) {
      out.push(parsed.data as ChatToolAction);
      if (out.length >= 100) break;
    }
  }
  return out;
}

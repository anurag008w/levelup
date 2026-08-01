import type { StateStore } from '../../core/ports/repositories';
import { defaultPostJourney, type AppState, type CustomPhase, type PostJourneyState } from '../../core/domain/state';
import type { Difficulty, EnergyLevel, JeeRelevance, PhaseId, TaskBankEntry, TaskType, ThinkingSkill } from '../../core/domain/task-bank';
import type { DailyPlan, ProgressionConfig } from '../../core/domain/progress';
import { DEFAULT_PROGRESSION_CONFIG } from '../../core/domain/progress';
import type { ChatToolAction, ChatToolResult } from '../../core/domain/chat-tools';
import { AiActionRegistry, executeAiAction } from '../../core/domain/ai-actions';
import { chatToolActionSchema, chatToolBatchSchema } from '../../core/domain/chat-tools';
import type { HabitProgressionService } from '../habit-engine/planner';
import type { TaskBankService } from '../task-bank/task-bank.service';
import type { TaskGenerationService } from '../ai/task-generation.service';
import { isAbortError } from '../../core/domain/llm';
import { formatDayLabel, formatPlanProgress, formatScheduledTasks } from './plan-format';

const MIN_DAY = 1;
const MAX_DAY = 90;
const MAX_RANGE_DAYS = 10;

const ACTIONS = new AiActionRegistry();
ACTIONS.register({ id: 'addTask', label: 'Add task', description: 'Create an editable task for one plan day.', entityType: 'dynamicTaskBank', permissions: ['create'] });
ACTIONS.register({ id: 'editTask', label: 'Edit task', description: 'Override a built-in or dynamic task.', entityType: 'dynamicTaskBank', permissions: ['edit'] });
ACTIONS.register({ id: 'removeTask', label: 'Remove task from a day', description: 'Hide a task for one day only; the task bank is never modified.', entityType: 'dynamicTaskBank', permissions: ['delete'], confirmationRequired: true });
ACTIONS.register({ id: 'markDone', label: 'Mark task done', description: 'Update completion log for one task.', entityType: 'taskLogs', permissions: ['edit'] });
ACTIONS.register({ id: 'bulkMarkDone', label: 'Bulk mark done', description: 'Update completion logs for multiple tasks.', entityType: 'taskLogs', permissions: ['bulk-edit'], confirmationRequired: true, supportsBulk: true });
ACTIONS.register({ id: 'setDayMode', label: 'Mark rest/study day', description: 'Mark or unmark a journey day as a rest (holiday) day.', entityType: 'restDays', permissions: ['edit'] });
// Task Bank management
ACTIONS.register({ id: 'editAnyTask', label: 'Edit any task', description: 'Edit any task in the task bank (title, duration, category).', entityType: 'taskBank', permissions: ['edit'] });
ACTIONS.register({ id: 'deleteAnyTask', label: 'Delete task from bank', description: 'Permanently delete a task from the task bank.', entityType: 'taskBank', permissions: ['delete'], confirmationRequired: true });
// Block management actions
ACTIONS.register({ id: 'createBlock', label: 'Create custom block', description: 'Create a custom study block for post-journey mode.', entityType: 'customBlocks', permissions: ['create'] });
ACTIONS.register({ id: 'deleteBlock', label: 'Delete block', description: 'Delete a custom study block.', entityType: 'customBlocks', permissions: ['delete'], confirmationRequired: true });
ACTIONS.register({ id: 'activateBlock', label: 'Activate block', description: 'Set a custom block as active.', entityType: 'customBlocks', permissions: ['edit'] });

const TASK_QUERY_WORDS = [
  'task', 'plan', 'din', 'day', 'aaj', 'kal', 'parso', 'week', 'hafta', 'month', 'mahina',
  'mark', 'done', 'complete', 'delete', 'remove', 'hata', 'hatao', 'add', 'badlo', 'badal',
  'schedule', 'change', 'edit', 'update', 'replan', 'reschedule', 'shift', 'increase',
  'decrease', 'reduce', 'goal', 'target', 'revision', 'padhai', 'tasks', 'saare', 'all', 'bulk',
  // Block-related words
  'block', 'phase', 'physics', 'chemistry', 'maths', 'revision', 'mock', 'concept', 'problem',
  'create', 'banao', 'bana', 'hatao', 'activate', 'shuru', 'custom',
];

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
 * Executes the deterministic chat tools against the app store. Mutations go
 * through the StateStore so the UI snapshot and every service stay in sync.
 */
export class ChatToolsService {
  private readonly store: StateStore;
  private readonly planner: HabitProgressionService;
  private readonly taskBank: TaskBankService;
  private readonly taskGeneration: TaskGenerationService;
  private readonly config: ProgressionConfig;

  constructor(
    store: StateStore,
    planner: HabitProgressionService,
    taskBank: TaskBankService,
    taskGeneration: TaskGenerationService,
    config: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG,
  ) {
    this.store = store;
    this.planner = planner;
    this.taskBank = taskBank;
    this.taskGeneration = taskGeneration;
    this.config = config;
  }

  /** Cheap heuristic: does this message plausibly ask about the plan/tasks? */
  isTaskQuery(text: string): boolean {
    const t = text.toLowerCase();
    return TASK_QUERY_WORDS.some((w) => t.includes(w));
  }


  /**
   * Deterministic safety net for weak/refusing models. If the decision hop
   * answers with prose like "I cannot access tools", infer the obvious local
   * tool action from the user's recent chat text instead of surfacing a false
   * capability error. Kept intentionally conservative: only create/add/view
   * commands with safe defaults are inferred.
   */
  inferFallbackActions(text: string): ChatToolAction[] {
    const t = text.toLowerCase();
    const day = inferDay(t);
    const wantsAdd = /\b(add|create|banao|bana|daalo|dalo|dal|create karo|add kro|add karo)\b/.test(t);
    const mentionsBlock = /\bblock|phase\b/.test(t);
    const mentionsTask = /\btasks?|kaam|practice|pyq|flashcards?\b/.test(t);
    const isDummy = /\bdummy|test|sample|practice\b/.test(t);

    if ((wantsAdd || /block add|add block/.test(t)) && mentionsBlock) {
      const days = inferDurationDays(t) ?? (isDummy ? 7 : 15);
      const focusAreas = inferFocusAreasFromText(t);
      const name = inferBlockName(focusAreas, isDummy);
      return [{
        action: 'createBlock',
        name,
        description: isDummy ? 'Dummy test block for checking chat tools' : `${name} study block`,
        days,
        focusAreas,
        difficulty: 'medium',
      }];
    }

    if ((wantsAdd || /tasks? bhi|tasks? dalo|tasks? daalo/.test(t)) && mentionsTask) {
      const durationMin = inferDurationMin(t) ?? 30;
      const intents = inferTaskIntents(t, isDummy);
      if (intents.length > 1) return [{ action: 'bulkAddTasks', day, intents, durationMin }];
      return [{ action: 'addTask', day, intent: intents[0] ?? 'Dummy practice task', durationMin }];
    }

    if (/\b(plan|tasks?|din|day|aaj|kal)\b/.test(t) && /\b(dikhao|bata|show|view|list)\b/.test(t)) {
      return [{ action: 'getPlan', day }];
    }

    return [];
  }

  /** Extracts and validates a single tool action from the model reply. */
  parseTool(text: string): ChatToolAction | null {
    const actions = this.parseTools(text);
    return actions.length === 1 ? actions[0] : null;
  }

  /**
   * Extracts tool actions from the model reply. Accepts a single action object,
   * a batch wrapper {"actions":[...]} or a bare array — in any JSON or prose.
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
            return parsedActions.map((r) => (r as { success: true; data: ChatToolAction }).data).slice(0, 6);
          }
          return [];
        }
      } catch {
        // fall through
      }
    }
    return [];
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
    for (const a of actions) {
      const r = await this.run(a);
      summaries.push(r.summary);
      if (r.ok) anyOk = true;
      else if (r.requiresConfirmation) confirmationPending = true;
      for (const d of r.missingTaskIdDays ?? []) missingDays.add(d);
    }
    return {
      ok: anyOk && !confirmationPending,
      requiresConfirmation: confirmationPending || undefined,
      summary: summaries.join('\n'),
      missingTaskIdDays: missingDays.size > 0 ? [...missingDays] : undefined,
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
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      return { ok: false, summary: err instanceof Error ? err.message : 'tool execution failed' };
    }
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

    if (!block) return { ok: false, summary: `Block "${blockId}" not found. Use listBlocks to get valid block IDs.` };

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

    if (!block) return { ok: false, summary: `Block "${blockId}" not found. Use listBlocks to get valid block IDs.` };

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

    if (!block) return { ok: false, summary: `Block "${blockId}" not found. Use listBlocks first, then retry with the exact id.` };
    if (!hasBlockEdit(action)) return { ok: false, summary: `Block "${blockId}": edit ke liye name, description, difficulty, days/dayStart/dayEnd, goals ya habits field chahiye. Use listBlocks first, then retry.` };

    const nextStart = dayStart ?? block.dayStart;
    const nextEnd = days !== undefined ? nextStart + clampBlockDays(days) - 1 : (dayEnd ?? block.dayEnd);
    if (nextEnd < nextStart) return { ok: false, summary: `Block "${blockId}": dayEnd (${nextEnd}) dayStart (${nextStart}) se pehle nahi ho sakta.` };

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

    if (!block) return { ok: false, summary: `Block "${blockId}" not found. Use listBlocks to get valid block IDs.` };

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
    
    // Check in dynamic task bank first
    const dynamicIdx = state.dynamicTaskBank.findIndex(t => t.id === taskId);
    
    if (dynamicIdx === -1) {
      // Check in base task bank
      const baseTask = this.taskBank.getById(taskId);
      if (!baseTask) {
        return { ok: false, summary: `Task "${taskId}" not found in any task bank.` };
      }
      return { 
        ok: false, 
        summary: `Task "${taskId}" is a base task and cannot be edited directly. Add a custom task instead.` 
      };
    }
    
    const task = state.dynamicTaskBank[dynamicIdx];
    if (!hasTaskEdit(action) && !category) {
      return { ok: false, summary: `Task "${taskId}": edit ke liye title, durationMin, category ya metadata field chahiye. Pehle getTaskBank/getAllTasks se full info dekho, phir retry karo.` };
    }
    const updated = applyTaskMetadata(
      {
        ...task,
        title: title ?? task.title,
        estimatedDurationMin: durationMin ?? task.estimatedDurationMin,
        tags: category ? [category, ...task.tags.filter(t => t !== category)] : task.tags,
      },
      action,
    );
    
    const next = state.dynamicTaskBank.map((t, i) => i === dynamicIdx ? updated : t);
    
    this.store.save({ ...state, dynamicTaskBank: next });
    
    const changes: string[] = [];
    if (title) changes.push(`title → "${title}"`);
    if (durationMin) changes.push(`duration → ${durationMin} min`);
    if (category) changes.push(`tag → ${category}`);
    
    return {
      ok: true,
      summary: `✅ Updated task "${updated.title}"!\n\nChanges: ${changes.join(', ')}`,
    };
  }

  private deleteAnyTask(state: AppState, taskId: string, confirmed: boolean): ChatToolResult {
    const task = state.dynamicTaskBank.find(t => t.id === taskId);
    
    if (!task) {
      return { ok: false, summary: `Task "${taskId}" not found in dynamic task bank.` };
    }
    
    if (!confirmed) {
      return {
        ok: false,
        requiresConfirmation: true,
        summary: `⚠️ Delete task "${task.title}" (ID: ${taskId})?\n\nThis will permanently remove it from the task bank.\n\nSay the action again with "confirmed":true to confirm.`,
      };
    }
    
    const next = state.dynamicTaskBank.filter(t => t.id !== taskId);
    
    this.store.save({ ...state, dynamicTaskBank: next });
    
    return { ok: true, summary: `🗑️ Deleted task "${task.title}".` };
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
    const result = await this.taskGeneration.generate(state, {
      intent: action.intent,
      dayNumber: d,
      durationMin: action.durationMin,
    });
    const entry = applyTaskMetadata(
      result.source === 'bank' ? cloneBankTask(result.entry, d) : scheduleForDay(result.entry, d),
      action,
    );
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
    const added: TaskBankEntry[] = [];
    const failed: string[] = [];
    for (const intent of action.intents.slice(0, 6)) {
      try {
        const result = await this.taskGeneration.generate(state, {
          intent,
          dayNumber: d,
          durationMin: action.durationMin,
        });
        const entry = applyTaskMetadata(
          result.source === 'bank' ? cloneBankTask(result.entry, d) : scheduleForDay(result.entry, d),
          action,
        );
        added.push(entry);
      } catch {
        // Partial success: one bad intent must not abort the whole batch.
        failed.push(intent);
      }
    }
    if (added.length === 0) {
      return { ok: false, summary: `Day ${d}: koi task add nahi ho saka${failed.length ? ` (fail hua: ${failed.join('; ')})` : ''}.` };
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
    const failedNote = failed.length > 0 ? `\n${failed.length} task(s) generate nahi ho paye: ${failed.join('; ')}.` : '';
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `${resultAction.summary}${failedNote} All added tasks scheduled ONLY for Day ${d}. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private bulkRemoveTasks(state: AppState, day: number, taskIds: string[] | undefined, confirmed = false): ChatToolResult {
    const d = clamp(day);
    const plan = this.planForDay(state, d);
    const visible = new Map(plan.tasks.map((item) => [item.entry.id, item.entry]));
    const ids = taskIds ?? [];
    if (ids.length === 0) return { ok: false, summary: `Day ${d}: task id(s) chahiye (plan se).` };
    const invalid = ids.filter((id) => !visible.has(id));
    if (invalid.length > 0) return { ok: false, summary: `Day ${d}: task id(s) planned list mein nahi mile: ${invalid.join(', ')}.`, missingTaskIdDays: [d] };

    let next = [...state.dynamicTaskBank];
    for (const id of ids) {
      const entry = visible.get(id);
      if (!entry) continue;
      next = applyDayRemoval(next, entry, d);
    }
    const resultAction = executeAiAction({
      state,
      action: ACTIONS.require('removeTask'),
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
    const d = clamp(day);
    const plan = this.planForDay(state, d);
    const planned = plan.tasks.find((t) => t.entry.id === taskId);
    if (!planned) {
      const known = state.dynamicTaskBank.find((e) => e.id === taskId) ?? this.taskBank.getById(taskId);
      if (!known) return { ok: false, summary: `Day ${d}: task id "${taskId}" nahi mila.`, missingTaskIdDays: [d] };
      return { ok: false, summary: `Day ${d}: "${known.title}" is day ke plan mein nahi hai (shayad kisi aur din ke liye scheduled). Pehle getPlan bhejo.`, missingTaskIdDays: [d] };
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
    const dynamic = state.dynamicTaskBank.find((e) => e.id === action.taskId);
    const entry = dynamic ?? this.taskBank.getById(action.taskId);
    if (!entry) return { ok: false, summary: `Day ${d}: task id "${action.taskId}" nahi mila.`, missingTaskIdDays: [d] };
    if (!hasTaskEdit(action)) {
      return { ok: false, summary: `Day ${d}: edit ke liye title, durationMin, dayTo ya metadata field chahiye. Pehle getPlan/getAllTasks se task info dekho, phir exact field ke saath retry karo.`, missingTaskIdDays: [d] };
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
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const logKey = this.logKeyForTask(state, d, taskId);
    if (!logKey) return { ok: false, summary: `Day ${d}: task id "${taskId}" nahi mila.`, missingTaskIdDays: [d] };
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
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const plan = this.planForDay(state, d);
    const visible = new Map(plan.tasks.map((item) => [item.entry.id, item.logKey]));
    const ids = taskIds && taskIds.length > 0 ? taskIds : [...visible.keys()];
    const invalid = ids.filter((id) => !visible.has(id));
    if (ids.length === 0) return { ok: false, summary: `Day ${d}: koi tasks planned nahi hain.` };
    if (invalid.length > 0) return { ok: false, summary: `Day ${d}: task id(s) planned list mein nahi mile: ${invalid.join(', ')}.`, missingTaskIdDays: [d] };

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
    const planned = this.planForDay(state, day).tasks.find((task) => task.entry.id === taskId);
    if (planned) return planned.logKey;
    return this.taskBank.getById(taskId) ? this.dateForDay(state, day) : null;
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

  private dateForDay(state: AppState, day: number): string {
    const start = new Date(`${state.startDateISO}T00:00:00`);
    start.setDate(start.getDate() + day - 1);
    return start.toISOString().slice(0, 10);
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

function inferDay(text: string): number {
  const dayMatch = text.match(/(?:day|din)\s*(\d{1,2})/);
  if (dayMatch) return clamp(Number(dayMatch[1]));
  if (/\bkal\b/.test(text)) return 2;
  return 1;
}

function inferDurationMin(text: string): number | null {
  const match = text.match(/(\d{1,3})\s*(?:min|minute|minutes)/);
  return match ? Math.min(600, Math.max(1, Number(match[1]))) : null;
}

function inferDurationDays(text: string): number | null {
  const match = text.match(/(\d{1,2})\s*(?:din|day|days)/);
  return match ? clampBlockDays(Number(match[1])) : null;
}

function inferFocusAreasFromText(text: string): string[] {
  const areas: string[] = [];
  for (const [word, area] of Object.entries({ physics: 'physics', phys: 'physics', chemistry: 'chemistry', chem: 'chemistry', maths: 'maths', math: 'maths', revision: 'revision', mock: 'mock', test: 'mock', concept: 'concept', problem: 'problem', practice: 'problem' })) {
    if (text.includes(word) && !areas.includes(area)) areas.push(area);
  }
  return areas;
}

function inferBlockName(focusAreas: string[], isDummy: boolean): string {
  if (isDummy) return 'Dummy Test Block';
  const primary = focusAreas[0];
  return primary ? `${primary[0].toUpperCase()}${primary.slice(1)} Block` : 'Custom Study Block';
}

function inferTaskIntents(text: string, isDummy: boolean): string[] {
  if (isDummy || /tasks? bhi|tasks? dalo|tasks? daalo/.test(text)) {
    return ['Dummy concept revision', 'Dummy PYQ practice'];
  }
  const cleaned = text.replace(/(?:add|create|banao|bana|daalo|dalo|dal|task|tasks|karo|kro|abhi|day\s*\d+|din\s*\d+)/g, ' ').replace(/\s+/g, ' ').trim();
  return [cleaned || 'Study practice task'];
}

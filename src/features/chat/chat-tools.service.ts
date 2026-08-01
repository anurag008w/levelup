import type { StateStore } from '../../core/ports/repositories';
import type { AppState } from '../../core/domain/state';
import type { TaskBankEntry } from '../../core/domain/task-bank';
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
const MAX_RANGE_DAYS = 7;

const ACTIONS = new AiActionRegistry();
ACTIONS.register({ id: 'addTask', label: 'Add task', description: 'Create an editable task for one plan day.', entityType: 'dynamicTaskBank', permissions: ['create'] });
ACTIONS.register({ id: 'editTask', label: 'Edit task', description: 'Override a built-in or dynamic task.', entityType: 'dynamicTaskBank', permissions: ['edit'] });
ACTIONS.register({ id: 'removeTask', label: 'Remove task from a day', description: 'Hide a task for one day only; the task bank is never modified.', entityType: 'dynamicTaskBank', permissions: ['delete'], confirmationRequired: true });
ACTIONS.register({ id: 'markDone', label: 'Mark task done', description: 'Update completion log for one task.', entityType: 'taskLogs', permissions: ['edit'] });
ACTIONS.register({ id: 'bulkMarkDone', label: 'Bulk mark done', description: 'Update completion logs for multiple tasks.', entityType: 'taskLogs', permissions: ['bulk-edit'], confirmationRequired: true, supportsBulk: true });
ACTIONS.register({ id: 'setDayMode', label: 'Mark rest/study day', description: 'Mark or unmark a journey day as a rest (holiday) day.', entityType: 'restDays', permissions: ['edit'] });

const TASK_QUERY_WORDS = [
  'task', 'plan', 'din', 'day', 'aaj', 'kal', 'parso', 'week', 'hafta', 'month', 'mahina',
  'mark', 'done', 'complete', 'delete', 'remove', 'hata', 'add', 'badlo', 'badal', 'schedule',
  'goal', 'target', 'revision', 'padhai', 'tasks', 'saare', 'all', 'bulk',
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
      }
    }
    const arrStart = text.indexOf('[');
    const arrEnd = text.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try {
        const parsedArr: unknown = JSON.parse(text.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsedArr)) {
          const actions = parsedArr
            .map((a) => chatToolActionSchema.safeParse(a))
            .filter((r): r is { success: true; data: ChatToolAction } => r.success)
            .map((r) => r.data);
          if (actions.length > 0) return actions.slice(0, 6);
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
    for (const a of actions) {
      const r = await this.run(a);
      summaries.push(r.summary);
      if (r.ok) anyOk = true;
      else if (r.requiresConfirmation) confirmationPending = true;
    }
    return {
      ok: anyOk && !confirmationPending,
      requiresConfirmation: confirmationPending || undefined,
      summary: summaries.join('\n'),
    };
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
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      return { ok: false, summary: err instanceof Error ? err.message : 'tool execution failed' };
    }
  }

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
    if (span > MAX_RANGE_DAYS) return { ok: false, summary: `Range se zyada din (max ${MAX_RANGE_DAYS}) — chhota range bhejo.` };
    const lines = [`Plan overview Day ${from}-${to}:`];
    for (let d = from; d <= to; d++) {
      const plan = this.planForDay(state, d);
      const dateISO = this.dateForDay(state, d);
      const rest = (state.restDays ?? []).includes(d);
      const first = formatScheduledTasks(plan, state, 4).join('; ');
      lines.push(`Day ${d} — ${formatDayLabel(dateISO)} (${dateISO})${rest ? ' [REST DAY]' : ''}: ${formatPlanProgress(plan, state)}. ${first}`);
    }
    return { ok: true, summary: lines.join('\n') };
  }

  private async addTask(state: AppState, action: Extract<ChatToolAction, { action: 'addTask' }>): Promise<ChatToolResult> {
    const d = clamp(action.day);
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const result = await this.taskGeneration.generate(state, {
      intent: action.intent,
      dayNumber: d,
      durationMin: action.durationMin,
    });
    const entry = result.source === 'bank' ? cloneBankTask(result.entry, d) : scheduleForDay(result.entry, d);
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
    for (const intent of action.intents.slice(0, 6)) {
      const result = await this.taskGeneration.generate(state, {
        intent,
        dayNumber: d,
        durationMin: action.durationMin,
      });
      const entry = result.source === 'bank' ? cloneBankTask(result.entry, d) : scheduleForDay(result.entry, d);
      added.push(entry);
    }
    if (added.length === 0) return { ok: false, summary: `Day ${d}: koi task add nahi ho saka.` };
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
    return {
      ok: true,
      versionId: resultAction.versionId,
      summary: `${resultAction.summary} All scheduled ONLY for Day ${d}. ${this.planPreview(resultAction.state, d)}`,
    };
  }

  private bulkRemoveTasks(state: AppState, day: number, taskIds: string[] | undefined, confirmed = false): ChatToolResult {
    const d = clamp(day);
    const plan = this.planForDay(state, d);
    const visible = new Map(plan.tasks.map((item) => [item.entry.id, item.entry]));
    const ids = taskIds ?? [];
    if (ids.length === 0) return { ok: false, summary: `Day ${d}: task id(s) chahiye (plan se).` };
    const invalid = ids.filter((id) => !visible.has(id));
    if (invalid.length > 0) return { ok: false, summary: `Day ${d}: task id(s) planned list mein nahi mile: ${invalid.join(', ')}.` };

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
      if (!known) return { ok: false, summary: `Day ${d}: task id "${taskId}" nahi mila.` };
      return { ok: false, summary: `Day ${d}: "${known.title}" is day ke plan mein nahi hai (shayad kisi aur din ke liye scheduled). Pehle getPlan bhejo.` };
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
    if (!entry) return { ok: false, summary: `Day ${d}: task id "${action.taskId}" nahi mila.` };
    const edited: typeof entry = {
      ...entry,
      title: action.title !== undefined ? action.title : entry.title,
      estimatedDurationMin: action.durationMin !== undefined ? clamp(action.durationMin) : entry.estimatedDurationMin,
      unlockConditions:
        action.dayTo !== undefined ? [{ type: 'day-exact' as const, day: clamp(action.dayTo) }] : entry.unlockConditions,
    };
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
    if (!logKey) return { ok: false, summary: `Day ${d}: task id "${taskId}" nahi mila.` };
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
    if (invalid.length > 0) return { ok: false, summary: `Day ${d}: task id(s) planned list mein nahi mile: ${invalid.join(', ')}.` };

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

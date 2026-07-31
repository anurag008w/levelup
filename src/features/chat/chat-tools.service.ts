import type { StateStore } from '../../core/ports/repositories';
import type { AppState } from '../../core/domain/state';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { DailyPlan, ProgressionConfig } from '../../core/domain/progress';
import { DEFAULT_PROGRESSION_CONFIG } from '../../core/domain/progress';
import type { ChatToolAction, ChatToolResult } from '../../core/domain/chat-tools';
import { chatToolActionSchema } from '../../core/domain/chat-tools';
import type { HabitProgressionService } from '../habit-engine/planner';
import type { TaskBankService } from '../task-bank/task-bank.service';
import type { TaskGenerationService } from '../ai/task-generation.service';
import { isAbortError } from '../../core/domain/llm';

const MIN_DAY = 1;
const MAX_DAY = 90;
const MAX_RANGE_DAYS = 7;

const TASK_QUERY_WORDS = [
  'task', 'plan', 'din', 'day', 'aaj', 'kal', 'parso', 'week', 'hafta', 'month', 'mahina',
  'mark', 'done', 'complete', 'delete', 'remove', 'hata', 'add', 'badlo', 'badal', 'schedule',
  'goal', 'target', 'revision', 'padhai', 'tasks',
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
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
    const result = chatToolActionSchema.safeParse(parsed);
    return result.success ? (result.data as ChatToolAction) : null;
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
        case 'removeTask':
          return this.removeTask(state, action.day, action.taskId);
        case 'editTask':
          return this.editTask(state, action);
        case 'markDone':
          return this.markDone(state, action.day, action.taskId);
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      return { ok: false, summary: err instanceof Error ? err.message : 'tool execution failed' };
    }
  }

  private getPlan(state: AppState, day: number): ChatToolResult {
    if (!state.startDateISO) return { ok: false, summary: 'Journey abhi shuru nahi hui.' };
    const d = clamp(day);
    const plan = this.planForDay(state, d);
    if (plan.tasks.length === 0) return { ok: true, summary: `Day ${d}: no tasks planned.` };
    const lines = [`Day ${d} plan (${plan.tasks.length} tasks):`];
    for (const t of plan.tasks) {
      const done = Boolean((state.taskLogs[t.logKey] ?? {})[t.entry.id]);
      lines.push(`- id:${t.entry.id} | ${done ? '[done]' : '[todo]'} | ${t.entry.title} | ${t.group} | ${t.entry.estimatedDurationMin}min`);
    }
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
      const done = plan.tasks.filter((t) => Boolean((state.taskLogs[t.logKey] ?? {})[t.entry.id])).length;
      const first = plan.tasks.slice(0, 4).map((t) => t.entry.title).join('; ');
      lines.push(`Day ${d}: ${plan.tasks.length} tasks (${done} done). ${first}`);
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
    const entry = result.source === 'bank' ? cloneBankTask(result.entry, d) : moveTaskToDay(result.entry, d);
    const next = state.dynamicTaskBank.some((e) => e.id === entry.id)
      ? state.dynamicTaskBank.map((e) => (e.id === entry.id ? entry : e))
      : [...state.dynamicTaskBank, entry];
    this.store.save({ ...state, dynamicTaskBank: next });
    return {
      ok: true,
      summary: `Added for Day ${d}: ${entry.title} (id:${entry.id}, ${entry.estimatedDurationMin}min). Tell the user it will appear in that day's plan and can be edited/deleted from Task Bank.`,
    };
  }

  private removeTask(state: AppState, day: number, taskId: string): ChatToolResult {
    const d = clamp(day);
    const dynamic = state.dynamicTaskBank.find((e) => e.id === taskId);
    const bank = this.taskBank.getById(taskId);
    const entry = dynamic ?? bank;
    if (!entry) return { ok: false, summary: `Day ${d}: task id "${taskId}" nahi mila.` };
    const next = dynamic
      ? state.dynamicTaskBank.filter((e) => e.id !== taskId)
      : [...state.dynamicTaskBank, { ...entry, active: false }];
    this.store.save({ ...state, dynamicTaskBank: next });
    return { ok: true, summary: `Removed from Day ${d}: ${entry.title} (id:${taskId}).` };
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
      unlockConditions: action.dayTo !== undefined ? [{ type: 'day' as const, fromDay: clamp(action.dayTo) }] : entry.unlockConditions,
    };
    const next = dynamic
      ? state.dynamicTaskBank.map((e) => (e.id === edited.id ? edited : e))
      : [...state.dynamicTaskBank, edited];
    this.store.save({ ...state, dynamicTaskBank: next });
    const moved = action.dayTo !== undefined ? ` and moved to Day ${clamp(action.dayTo)}` : '';
    return { ok: true, summary: `Edited Day ${d}: ${edited.title} (${edited.estimatedDurationMin}min)${moved}.` };
  }

  private markDone(state: AppState, day: number, taskId: string): ChatToolResult {
    const d = clamp(day);
    const dateISO = this.dateForDay(state, d);
    const log = { ...(state.taskLogs[dateISO] ?? {}) };
    if (!(taskId in log) && !this.taskBank.getById(taskId)) {
      return { ok: false, summary: `Day ${d}: task id "${taskId}" nahi mila.` };
    }
    log[taskId] = true;
    this.store.save({ ...state, taskLogs: { ...state.taskLogs, [dateISO]: log } });
    return { ok: true, summary: `Marked done for Day ${d} (${dateISO}): ${this.taskBank.getById(taskId)?.title ?? taskId}.` };
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

function moveTaskToDay(entry: TaskBankEntry, day: number): TaskBankEntry {
  return { ...entry, unlockConditions: [{ type: 'day', fromDay: day }], active: true };
}

function cloneBankTask(entry: TaskBankEntry, day: number): TaskBankEntry {
  return {
    ...moveTaskToDay(entry, day),
    id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    legacy: undefined,
  };
}

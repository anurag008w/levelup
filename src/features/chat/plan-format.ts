import type { AppState } from '../../core/domain/state';
import type { DailyPlan, PlannedTask, TaskGroup } from '../../core/domain/progress';
import type { TaskBankEntry } from '../../core/domain/task-bank';

const SLOT_START_MINUTES: Record<TaskGroup, number> = {
  morning: 6 * 60,
  blocks: 16 * 60,
  night: 21 * 60,
  weekly: 10 * 60,
  monthly: 18 * 60,
  mock: 9 * 60,
  exam: 7 * 60,
  bonus: 20 * 60,
};

const BUFFER_MINUTES = 10;

export function formatDayLabel(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00`);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatPlanProgress(plan: DailyPlan, state: AppState): string {
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => isTaskDone(state, task)).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return `${done}/${total} done (${pct}%)`;
}

export function formatScheduledTasks(plan: DailyPlan, state: AppState, limit = plan.tasks.length): string[] {
  const offsets = new Map<TaskGroup, number>();
  return plan.tasks.slice(0, limit).map((task, idx) => {
    const offset = offsets.get(task.group) ?? 0;
    offsets.set(task.group, offset + task.entry.estimatedDurationMin + BUFFER_MINUTES);
    return formatScheduledTask(task, state, idx + 1, offset);
  });
}

function formatScheduledTask(task: PlannedTask, state: AppState, index: number, slotOffsetMin: number): string {
  const start = SLOT_START_MINUTES[task.group] + slotOffsetMin;
  const end = start + task.entry.estimatedDurationMin;
  const done = isTaskDone(state, task) ? 'done' : 'todo';
  const required = task.required ? 'required' : 'optional';
  return `${index}. ${formatMinutes(start)}-${formatMinutes(end)} [${done}] [${required}] id:${task.entry.id} · ${task.entry.title} · ${task.entry.estimatedDurationMin}min · ${task.group} · ${task.entry.taskType} · ${formatTaskMetadata(task.entry)}`;
}

function formatTaskMetadata(entry: TaskBankEntry): string {
  const parts = [
    `habit:${entry.habitId}`,
    `phase:${entry.phase}`,
    `difficulty:${entry.difficulty}/5`,
    `energy:${entry.energyLevel}`,
    `revision:${entry.revisionSuitability}`,
    `backlog:${entry.backlogSuitability}`,
    `jee:${entry.jeeRelevance.score}`,
  ];
  if (entry.jeeRelevance.subject) parts.push(`subject:${entry.jeeRelevance.subject}`);
  if (entry.tags.length > 0) parts.push(`tags:${entry.tags.join(',')}`);
  if (entry.thinkingSkills.length > 0) parts.push(`thinking:${entry.thinkingSkills.join(',')}`);
  if (entry.description) parts.push(`desc:${entry.description}`);
  return parts.join(' · ');
}

function isTaskDone(state: AppState, task: PlannedTask): boolean {
  return Boolean((state.taskLogs[task.logKey] ?? {})[task.entry.id]);
}

function formatMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60).toString().padStart(2, '0');
  const minutes = (normalized % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

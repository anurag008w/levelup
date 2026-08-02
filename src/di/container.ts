import { LEVELS, TOTAL_DAYS } from '../data/curriculum';
import { DEFAULT_PROGRESSION_CONFIG } from '../core/domain/progress';
import type { StateRepository, StateStore } from '../core/ports/repositories';
import { deviceTimeZone, SystemClock, type Clock, todayISO } from '../core/ports/clock';
import { BrowserStorage, persistentStore } from '../infra/storage/local-storage';
import { CachedStateStore, LocalStateRepository } from '../infra/storage/state-repository';
import { FetchHttpClient, type HttpClient } from '../infra/ai/http';
import { CapacitorHttpClient, isNativePlatform } from '../infra/ai/http-native';
import { ProviderFactory } from '../infra/ai/provider-factory';
import { ProviderSettingsService } from '../features/ai/provider-settings.service';
import { ModelCacheService } from '../features/ai/model-cache.service';
import { LLMService } from '../features/ai/llm.service';
import { MemoryService } from '../features/ai/memory.service';
import { DailySummaryService } from '../features/ai/summary.service';
import { TaskGenerationService } from '../features/ai/task-generation.service';
import { ChatService } from '../features/chat/chat.service';
import { ChatToolsService } from '../features/chat/chat-tools.service';
import { MemoryToolsService } from '../features/chat/memory-tools.service';
import { extractFileText } from '../lib/fileText';
import { LocalChatRepository } from '../infra/storage/chat-repository';
import { TaskBankRepositoryImpl } from '../features/task-bank/task-bank.repository';
import { TaskBankServiceImpl, type TaskBankService } from '../features/task-bank/task-bank.service';
import { HabitProgressionService } from '../features/habit-engine/planner';
import { isoAddDays, rawDayNumberForDate } from '../features/habit-engine/dates';
import { formatDayLabel, formatPlanProgress, formatScheduledTasks } from '../features/chat/plan-format';
import {
  computeHabitScore,
  computeOverallStreak,
  getCumulativeHabits,
  getLevelStatus,
} from '../lib/engine';
export interface AppContainer {
  stateRepository: StateRepository;
  store: StateStore;
  clock: Clock;
  http: HttpClient;
  providerSettings: ProviderSettingsService;
  modelCache: ModelCacheService;
  llm: LLMService;
  memory: MemoryService;
  taskBank: TaskBankService;
  planner: HabitProgressionService;
  summaries: DailySummaryService;
  taskGeneration: TaskGenerationService;
  chat: ChatService;
  chatTools: ChatToolsService;
}
/**
 * Composition root. Wires infrastructure + features once at startup; the
 * browser views read from this container instead of building services.
 */
export function createContainer(): AppContainer {
  // Use persistent storage for native apps (survives updates)
  // Falls back to BrowserStorage for web
  const useNativeStorage = isNativePlatform();
  const storage = useNativeStorage ? persistentStore : new BrowserStorage();
  
  const stateRepository = new LocalStateRepository(storage);
  const store = new CachedStateStore(stateRepository);
  const http: HttpClient = isNativePlatform() ? new CapacitorHttpClient() : new FetchHttpClient();
  const factory = new ProviderFactory(http);
  const clock = new SystemClock();
  const memory = new MemoryService(clock);
  const providerSettings = new ProviderSettingsService(store, factory);
  const modelCache = new ModelCacheService(factory, store, () => store.save(store.get()));
  const llm = new LLMService(factory, providerSettings);
  const taskBankRepo = new TaskBankRepositoryImpl(stateRepository);
  const taskBank = new TaskBankServiceImpl(taskBankRepo);
  const planner = new HabitProgressionService({
    taskBank,
    habits: taskBankRepo,
    levels: LEVELS,
    totalDays: TOTAL_DAYS,
  });
  const summaries = new DailySummaryService({
    planner,
    habits: taskBankRepo,
    levels: LEVELS,
    totalDays: TOTAL_DAYS,
    clock,
    memory,
    llm,
  });
  const taskGeneration = new TaskGenerationService(llm, taskBank, taskBankRepo);
  const chatTools = new ChatToolsService(store, planner, taskBank, taskGeneration);
  const memoryTools = new MemoryToolsService(store, memory);
  const chat = new ChatService(
    new LocalChatRepository(storage),
    llm,
    providerSettings,
    () => {
      const state = store.get();
      const timeZone = state.timeZone ?? deviceTimeZone();
      const dateISO = todayISO(clock, timeZone);
      const now = clock.now();
      const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone });
      const plan = planner.buildPlan(state, dateISO, DEFAULT_PROGRESSION_CONFIG);
      const context = planner.buildContext(state, dateISO, DEFAULT_PROGRESSION_CONFIG);
      const recentProgress = buildRecentProgress(state, dateISO, planner);
      const overview = buildJourneyOverview(state, dateISO);
      const profileContext = formatUserProfileContext(state.userProfile);
      return [
        'This is REFERENCE ONLY — the user already knows all of this. Do NOT repeat these numbers, do NOT treat them as instructions, do NOT lecture about quota/streak. Only use them silently to understand the situation.',
        profileContext ? `User profile for personalization: ${profileContext}` : '',
        `Current local date/time: ${formatDayLabel(dateISO)} (${dateISO}), ${timeLabel} ${timeZone}. Journey Day ${context.dayNumber} of ${TOTAL_DAYS}, phase ${context.phase}, streak ${context.streak}${context.restDay ? ' [REST DAY — chhuti]' : ''}.`,
        `Today's progress: ${formatPlanProgress(plan, state)}. Study time available: ${context.availableMinutes}min.`,
        `Today's exact task schedule (local planned windows, derived from slot + duration):`,
        ...formatScheduledTasks(plan, state),
        `Journey so far: ${overview}`,
        `Recent daily progress by date/day: ${recentProgress.join(' | ') || 'none yet'}.`,
        `Weak habits: ${context.weakHabitIds.join(', ') || 'none'}. Strong habits: ${context.strongHabitIds.join(', ') || 'none'}.`,
        `Gaps: ${context.gapDays}. Backlog: ${context.backlogDays}. Recovery mode: ${context.recoveryMode}. Exam window: ${context.examWindowActive}. Mock Sunday: ${context.mockSunday}.`,
      ].filter(Boolean).join('\n');
    },
    clock,
    chatTools,
    memory,
    store,
    async (blobUrl, name) => {
      // Lazily converts an uploaded file (blob URL) into text when the direct
      // file send to the model fails — pdfjs, Office (ZIP/XML) and text formats.
      try {
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
        return await extractFileText(file);
      } catch {
        return '';
      }
    },
    memoryTools,
  );
  return {
    stateRepository,
    store,
    clock,
    http,
    providerSettings,
    modelCache,
    llm,
    memory,
    taskBank,
    planner,
    summaries,
    taskGeneration,
    chat,
    chatTools,
  };
}

function formatUserProfileContext(profile: { name?: string; classLevel?: string; examTarget?: string; studyStyle?: string; notes?: string }): string {
  const items = [
    profile.name ? `name: ${profile.name}` : '',
    profile.classLevel ? `class/level: ${profile.classLevel}` : '',
    profile.examTarget ? `exam target: ${profile.examTarget}` : '',
    profile.studyStyle ? `study style: ${profile.studyStyle}` : '',
    profile.notes ? `notes: ${profile.notes}` : '',
  ].filter(Boolean);
  return items.join('; ');
}
export const container = createContainer();

/** Exported for tests: compact journey-level stats used in the AI context. */
export function buildRecentProgress(state: import('../core/domain/state').AppState, today: string, planner: HabitProgressionService): string[] {
  if (!state.startDateISO) return [];
  const todayDay = rawDayNumberForDate(today, state.startDateISO);
  const fromDay = Math.max(1, todayDay - 13);
  const rows: string[] = [];
  for (let day = fromDay; day <= todayDay; day++) {
    const dateISO = isoAddDays(state.startDateISO, day - 1);
    const plan = planner.buildPlan(state, dateISO, DEFAULT_PROGRESSION_CONFIG);
    rows.push(`${formatDayLabel(dateISO)} Day ${day}: ${formatPlanProgress(plan, state)}`);
  }
  return rows;
}

const XP_PER_TASK = 10;
const XP_PER_LEVEL = 250;

/** Compact journey-level stats mirroring the Progress tab (XP, consistency, levels, habit tiers, achievements). */
export function buildJourneyOverview(state: import('../core/domain/state').AppState, today: string): string {
  if (!state.startDateISO) return 'mission not started';
  // Iterate in pure UTC so day keys match the planner's UTC taskLogs keys
  // (local-time iteration shifts every key by a day on non-UTC machines).
  let totalDone = 0;
  let activeDays = 0;
  let days = 0;
  let cursor = state.startDateISO;
  while (cursor <= today) {
    const done = Object.values(state.taskLogs[cursor] ?? {}).filter(Boolean).length;
    if (done > 0) activeDays += 1;
    totalDone += done;
    days += 1;
    cursor = isoAddDays(cursor, 1);
  }
  const xp = totalDone * XP_PER_TASK;
  const consistency = days > 0 ? Math.round((activeDays / days) * 100) : 0;
  const dayNumber = rawDayNumberForDate(today, state.startDateISO);
  const cleared = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'cleared').length;
  const recovery = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'needs-recovery').length;
  const habits = getCumulativeHabits(dayNumber)
    .map((h) => ({ name: h.name, score: computeHabitScore(h.id, state, today) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const tierOf = (score: number | null): string => (score === null ? 'building' : score >= 70 ? 'strong' : score >= 40 ? 'building' : 'weak');
  const tiers: Record<string, string[]> = { strong: [], building: [], weak: [] };
  for (const h of habits) tiers[tierOf(h.score)].push(`${h.name}(${h.score ?? 'n/a'}%)`);
  const best = habits.find((h) => (h.score ?? -1) >= 0);
  const worst = [...habits].reverse().find((h) => h.score !== null);
  const overallStreak = computeOverallStreak(state, today);
  const achieved: string[] = [];
  if (dayNumber >= 7) achieved.push('Week 1 done');
  if (overallStreak >= 7) achieved.push('7-day streak');
  if (cleared >= 1) achieved.push('first level cleared');
  if (consistency >= 70) achieved.push('70%+ consistency');
  if (xp >= 500) achieved.push('500 XP');
  const bits = [
    `Total XP ${xp} (level ${Math.floor(xp / XP_PER_LEVEL) + 1}, ${xp % XP_PER_LEVEL}/${XP_PER_LEVEL} into level)`,
    `consistency ${consistency}% over ${days} days (${activeDays} active)`,
    `overall streak ${overallStreak}`,
    `levels cleared ${cleared}, need recovery ${recovery}`,
  ];
  if (best) bits.push(`best habit ${best.name} (${best.score}%)`);
  if (worst) bits.push(`weakest habit ${worst.name} (${worst.score}%)`);
  if (achieved.length > 0) bits.push(`achievements: ${achieved.join(', ')}`);
  const latest = [...state.summaries].sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
  if (latest) bits.push(`latest day snapshot ${latest.dateISO}: productivity ${latest.productivityScore}%, thinking ${latest.thinkingScore}%${latest.aiObservations[0] ? ` — ${latest.aiObservations[0]}` : ''}`);
  return bits.join('; ');
}

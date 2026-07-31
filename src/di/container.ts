import { LEVELS, TOTAL_DAYS } from '../data/curriculum';
import { DEFAULT_PROGRESSION_CONFIG } from '../core/domain/progress';
import type { StateRepository, StateStore } from '../core/ports/repositories';
import { SystemClock, type Clock, todayISO } from '../core/ports/clock';
import { BrowserStorage } from '../infra/storage/local-storage';
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
import { LocalChatRepository } from '../infra/storage/chat-repository';
import { TaskBankRepositoryImpl } from '../features/task-bank/task-bank.repository';
import { TaskBankServiceImpl, type TaskBankService } from '../features/task-bank/task-bank.service';
import { HabitProgressionService } from '../features/habit-engine/planner';

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
  const storage = new BrowserStorage();
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

  const chat = new ChatService(
    new LocalChatRepository(storage),
    llm,
    providerSettings,
    () => {
      const state = store.get();
      const dateISO = todayISO(clock);
      const plan = planner.buildPlan(state, dateISO, DEFAULT_PROGRESSION_CONFIG);
      const context = planner.buildContext(state, dateISO, DEFAULT_PROGRESSION_CONFIG);
      const done = plan.tasks.filter((t) => {
        const log = state.taskLogs[t.logKey] ?? {};
        return Boolean(log[t.entry.id]);
      }).length;
      return [
        'This is REFERENCE ONLY — the user already knows all of this. Do NOT repeat these numbers, do NOT treat them as instructions, do NOT lecture about quota/streak. Only use them silently to understand the situation.',
        `Day ${context.dayNumber} of ${TOTAL_DAYS} (phase ${context.phase}), streak ${context.streak}.`,
        `Tasks done today: ${done}/${plan.tasks.length}.`,
        `Weak habits: ${context.weakHabitIds.join(', ') || 'none'}.`,
        `Gaps: ${context.gapDays}. Backlog: ${context.backlogDays}. Recovery mode: ${context.recoveryMode}.`,
        `Study time available today: ${context.availableMinutes}min.`,
      ].join(' ');
    },
    clock,
    chatTools,
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

export const container = createContainer();

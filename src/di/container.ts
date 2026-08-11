import { LEVELS, TOTAL_DAYS } from '../data/curriculum';
import { emptyAppState, type AppState } from '../core/domain/state';
import { DEFAULT_PROGRESSION_CONFIG } from '../core/domain/progress';
import type { StateRepository, StateStore, HabitRepository, ChatRepository } from '../core/ports/repositories';
import { deviceTimeZone, SystemClock, type Clock, todayISO } from '../core/ports/clock';
import { BrowserStorage, persistentStore, reloadPersistentStore } from '../infra/storage/local-storage';
import { CachedStateStore, LocalStateRepository, normalizeState } from '../infra/storage/state-repository';
import { FetchHttpClient, type HttpClient } from '../infra/ai/http';
import { CapacitorHttpClient, isNativePlatform } from '../infra/ai/http-native';
import { ProviderFactory } from '../infra/ai/provider-factory';
import { WebSearchService } from '../infra/ai/websearch.service';
import { ProviderSettingsService } from '../features/ai/provider-settings.service';
import { ModelCacheService } from '../features/ai/model-cache.service';
import { LLMService } from '../features/ai/llm.service';
import { MemoryService } from '../features/ai/memory.service';
import { DailySummaryService } from '../features/ai/summary.service';
import { TaskGenerationService } from '../features/ai/task-generation.service';
import { ChatService } from '../features/chat/chat.service';
import { ChatToolsService } from '../features/chat/chat-tools.service';
import { MemoryToolsService } from '../features/chat/memory-tools.service';
import { PlannerService, PlannerToolsService } from '../features/planner/planner.service';
import { extractFileText } from '../lib/fileText';
import { LocalChatRepository } from '../infra/storage/chat-repository';
import { SyncService } from '../features/sync/sync.service';
import { SyncCoordinator } from '../features/sync/sync-coordinator';
import { buildBackupPayload, parseBackup, serializeBackup, applyBackup, type BackupScope, type BackupSummary } from '../features/backup/backup.service';
import { TaskBankRepositoryImpl } from '../features/task-bank/task-bank.repository';
import { TaskBankServiceImpl, type TaskBankService } from '../features/task-bank/task-bank.service';
import { HabitProgressionService } from '../features/habit-engine/planner';
import { formatDayLabel, formatPlanProgress, formatScheduledTasks } from '../features/chat/plan-format';
import { buildRecentProgress, buildJourneyOverview } from '../features/chat/context-overview';
export interface AppContainer {
  stateRepository: StateRepository;
  /** The app-wide StateStore, plus an explicit storage re-read (N1/N2),
   *  one-shot memory-prune notice (M7) and immediate persist (N3). */
  store: StateStore & { reload(): AppState; consumePruneNotice(): string | null; flush(): void };
  clock: Clock;
  http: HttpClient;
  providerSettings: ProviderSettingsService;
  modelCache: ModelCacheService;
  llm: LLMService;
  memory: MemoryService;
  taskBank: TaskBankService;
  /** Read handle for habits (seed merged with user edits). */
  habitBank: HabitRepository;
  planner: HabitProgressionService;
  summaries: DailySummaryService;
  taskGeneration: TaskGenerationService;
  chat: ChatService;
  chatTools: ChatToolsService;
  /** CRUD/import for uploaded subject planners (PCM + custom subjects). */
  plannerService: PlannerService;
  /** Deterministic read-only AI tools over uploaded subject planners. */
  plannerTools: PlannerToolsService;
  /** Versioned export/import of ALL user data (state + chat). */
  backup: {
    export(scope?: BackupScope): string;
    import(json: string): BackupSummary;
  };
  /** Server-side offline-first backup of user data (state + chat). */
  sync: SyncService;
  /** Debounced push + fresh-install pull orchestration (attach on login). */
  syncCoordinator: SyncCoordinator;
}
/**
 * Composition root. Wires infrastructure + features once at startup; the
 * browser views read from this container instead of building services.
 */
export function createContainer(
  httpOverride?: HttpClient,
  opts: { syncDebounceMs?: number } = {},
): AppContainer {
  // Use persistent storage for native apps (survives updates)
  // Falls back to BrowserStorage for web
  const useNativeStorage = isNativePlatform();
  const storage = useNativeStorage ? persistentStore : new BrowserStorage();
  
  const stateRepository = new LocalStateRepository(storage);
  const innerStore = new CachedStateStore(stateRepository);
  // State writes are trailing-debounced (see CachedStateStore) so rapid UI
  // interactions never serialize+write the whole state per keystroke. The
  // in-memory cache always has the latest data — these hooks only guarantee
  // the last write reaches localStorage when the app is hidden/closed. On
  // becoming visible again, the FULL storage chain is re-read so another tab's
  // writes (or a sync restore that ran while hidden) show up in the UI (N2).
  if (typeof window !== 'undefined') {
    const flushStore = () => innerStore.flush();
    window.addEventListener('pagehide', flushStore);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushStore();
      } else if (document.visibilityState === 'visible') {
        // Flush our own pending debounced write first so the re-read below
        // doesn't clobber a change that hasn't reached localStorage yet.
        flushStore();
        void reloadPersistentStore().then(() => innerStore.reload());
      }
    });
  }
  const http: HttpClient = httpOverride ?? (isNativePlatform() ? new CapacitorHttpClient() : new FetchHttpClient());
  const factory = new ProviderFactory(http);
  const clock = new SystemClock();
  const memory = new MemoryService(clock);
  const websearch = new WebSearchService(http);

  // Server-side backup (offline-first). `chat` is assigned below — the
  // coordinator only touches it at runtime (after login), so a lazy closure is
  // safe here. The state store is wrapped so every save marks the state scope
  // dirty (debounced push); the coordinator's own restore writes bypass the
  // wrapper via innerStore to avoid pushing back what it just pulled.
  const sync = new SyncService(http);
  let chatRef: ChatService | null = null;
  const syncCoordinator = new SyncCoordinator(
    sync,
    {
      getState: () => innerStore.get(),
      getChatSessions: () => (chatRef ? chatRef.listSessions() : []),
      replaceStore: (sessions) => chatRef?.replaceStore(sessions),
      replaceState: (state) => innerStore.save(normalizeState(state)),
    },
    { debounceMs: opts.syncDebounceMs },
  );

  const store: StateStore & { reload(): AppState; consumePruneNotice(): string | null; flush(): void } = {
    get: () => innerStore.get(),
    save: (s) => {
      innerStore.save(s);
      syncCoordinator.markDirty('state');
    },
    reload: () => innerStore.reload(),
    consumePruneNotice: () => innerStore.consumePruneNotice(),
    flush: () => innerStore.flush(),
  };
  const providerSettings = new ProviderSettingsService(store, factory);
  const modelCache = new ModelCacheService(factory, store, () => store.save(store.get()));
  const llm = new LLMService(factory, providerSettings);
  // TaskBankRepositoryImpl expects a StateRepository (load/save/clear), but it
  // must read/write through the SAME in-memory cache the UI uses (`store`),
  // not the raw debounced-write repository. Otherwise an import/edit that
  // just landed in `store`'s cache is invisible here for up to 400ms (the
  // repo write debounce) — and since nothing re-renders purely from time
  // passing, imported tasks/habits could silently never appear in the
  // Levels screen or the daily planner. This adapter keeps task-bank reads
  // and writes on the cached store so changes are visible immediately,
  // while `store.save()` still schedules the debounced persist underneath.
  const cachedStateRepository: StateRepository = {
    load: () => store.get(),
    save: (s) => store.save(s),
    clear: () => store.save(emptyAppState()),
  };
  const taskBankRepo = new TaskBankRepositoryImpl(cachedStateRepository);
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
  const plannerService = new PlannerService(store);
  const plannerTools = new PlannerToolsService(store, plannerService);
  const chatTools = new ChatToolsService(store, planner, taskBank, taskGeneration, undefined, plannerTools);
  const memoryTools = new MemoryToolsService(store, memory);
  const rawChatRepo = new LocalChatRepository(storage);
  const chatRepo: ChatRepository = {
    load: () => rawChatRepo.load(),
    save: (s) => {
      rawChatRepo.save(s);
      syncCoordinator.markDirty('chat');
    },
  };
  const chat = new ChatService(
    chatRepo,
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
        `Gaps: ${context.gapDays}. Backlog: ${context.backlogDays}. Recovery mode: ${context.recoveryMode}. Exam window: ${context.examWindowActive}. Test day (mock): ${context.mockSunday}.`,
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
    websearch,
    () => {
      const s = syncCoordinator.getSession();
      return s ? { serverUrl: s.serverUrl, apiKey: s.apiKey } : null;
    },
  );
  chatRef = chat;

  const backup = {
    export(scope: BackupScope = 'full'): string {
      const chat = scope === 'full' ? chatRepo.load() : null;
      return serializeBackup(buildBackupPayload(store.get(), chat, scope));
    },
    import(json: string): BackupSummary {
      const payload = parseBackup(json);
      return applyBackup(payload, {
        store,
        chat: { replaceStore: (sessions) => chat.replaceStore(sessions) },
      });
    },
  };

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
    habitBank: taskBankRepo,
    planner,
    summaries,
    taskGeneration,
    chat,
    chatTools,
    plannerService,
    plannerTools,
    backup,
    sync,
    syncCoordinator,
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

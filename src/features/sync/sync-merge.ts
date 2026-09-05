import type { AppState, AiSettings } from '../../core/domain/state';
import type { ChatSession, ChatMessage } from '../../core/domain/chat';
import type { CustomTodoTask } from '../../core/domain/todo-tasks';
import type { StudyResource } from '../../core/domain/study-vault';
import type { MemoryEntry } from '../../core/domain/memory';
import type { Habit } from '../../core/domain/habit';
import type { SubjectPlanner } from '../../core/domain/subject-planner';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { MisaSyncPayload } from './sync.service';
import type { RelationshipState, Commitment, UserPromise, DurableMemoryItem } from '../ai/relationship-state';
import type { ProactiveTrigger, ScheduledProactiveMessage } from '../ai/proactive-agent.service';
import { DEFAULT_LIVE_SETTINGS } from '../../core/domain/live-types';
import { normalizeState } from '../../infra/storage/state-repository';

/**
 * Non-destructively merges two AppStates (e.g. Local vs Remote from cloud sync).
 * Ensures no ticked tasks, todos, memory facts, providers, or uploaded resources
 * are lost when switching between Linux desktop and Mobile.
 */
export function mergeAppState(local: AppState, remote: AppState): AppState {
  const normLocal = normalizeState(local);
  const normRemote = normalizeState(remote);

  // 1. Start Date: prefer earlier valid date if both exist, or the non-null one
  let startDateISO = normLocal.startDateISO;
  if (normLocal.startDateISO && normRemote.startDateISO) {
    startDateISO = normLocal.startDateISO <= normRemote.startDateISO ? normLocal.startDateISO : normRemote.startDateISO;
  } else if (!normLocal.startDateISO && normRemote.startDateISO) {
    startDateISO = normRemote.startDateISO;
  }

  // 2. Task Logs: deep union by day and task
  const allDays = new Set([
    ...Object.keys(normLocal.taskLogs || {}),
    ...Object.keys(normRemote.taskLogs || {}),
  ]);
  const taskLogs: Record<string, Record<string, boolean>> = {};
  for (const day of allDays) {
    taskLogs[day] = {
      ...(normRemote.taskLogs?.[day] || {}),
      ...(normLocal.taskLogs?.[day] || {}),
    };
  }

  // 3. Custom To-Dos: union by ID
  const todoMap = new Map<string, CustomTodoTask>();
  for (const t of normRemote.customTodos || []) {
    if (t?.id) todoMap.set(t.id, t);
  }
  for (const t of normLocal.customTodos || []) {
    if (!t?.id) continue;
    const existing = todoMap.get(t.id);
    if (!existing) {
      todoMap.set(t.id, t);
    } else {
      // If either marked completed, keep completed: true; otherwise prefer latest updated
      const completed = existing.completed || t.completed;
      const latest = (t.completedAtISO || t.createdAtISO || '') >= (existing.completedAtISO || existing.createdAtISO || '') ? t : existing;
      todoMap.set(t.id, { ...latest, completed });
    }
  }
  const customTodos = Array.from(todoMap.values());

  // 4. Study Vault Resources: union by ID
  const vaultMap = new Map<string, StudyResource>();
  for (const v of normRemote.studyVault || []) {
    if (v?.id) vaultMap.set(v.id, v);
  }
  for (const v of normLocal.studyVault || []) {
    if (v?.id) vaultMap.set(v.id, v);
  }
  const studyVault = Array.from(vaultMap.values());

  // 5. Memory facts & summaries
  const memEntriesMap = new Map<string, MemoryEntry>();
  const seenFactTexts = new Set<string>();
  for (const e of [...(normRemote.memory?.entries || []), ...(normLocal.memory?.entries || [])]) {
    if (!e || !e.id) continue;
    const normText = (e.content || (e as any).text || '').trim().toLowerCase();
    if (normText && seenFactTexts.has(normText)) continue;
    if (normText) seenFactTexts.add(normText);
    memEntriesMap.set(e.id, e);
  }
  const memSummariesMap = new Map<string, MemoryEntry>();
  for (const s of [...(normRemote.memory?.summaries || []), ...(normLocal.memory?.summaries || [])]) {
    if (s?.id) memSummariesMap.set(s.id, s);
  }
  const lastSummarizedAt = [normLocal.memory?.lastSummarizedAt, normRemote.memory?.lastSummarizedAt]
    .filter(Boolean)
    .sort()
    .pop() || null;

  // 6. Custom Habits: union by ID
  const habitMap = new Map<string, Habit>();
  for (const h of normRemote.customHabits || []) {
    if (h?.id) habitMap.set(h.id, h);
  }
  for (const h of normLocal.customHabits || []) {
    if (h?.id) habitMap.set(h.id, h);
  }
  const customHabits = Array.from(habitMap.values());

  // 7. Subject Planners: union by ID
  const plannerMap = new Map<string, SubjectPlanner>();
  for (const p of normRemote.subjectPlanners || []) {
    if (p?.id) plannerMap.set(p.id, p);
  }
  for (const p of normLocal.subjectPlanners || []) {
    if (p?.id) plannerMap.set(p.id, p);
  }
  const subjectPlanners = Array.from(plannerMap.values());

  // 8. Cleared Levels: union of numbers
  const clearedLevels = Array.from(
    new Set([...(normLocal.clearedLevels || []), ...(normRemote.clearedLevels || [])])
  ).sort((a, b) => a - b);

  // 9. Rest Days & Test Days: union
  const restDays = Array.from(
    new Set([...(normLocal.restDays || []), ...(normRemote.restDays || [])])
  ).sort((a, b) => a - b);
  const testDays = Array.from(
    new Set([...(normLocal.testDays || []), ...(normRemote.testDays || [])])
  ).sort((a, b) => a - b);

  // 10. AI Settings: merge providers & preferences
  const providers = {
    ...(normRemote.aiSettings?.providers || {}),
    ...(normLocal.aiSettings?.providers || {}),
  };
  const activeProviderId = normLocal.aiSettings?.activeProviderId || normRemote.aiSettings?.activeProviderId || null;
  const aiSettings: AiSettings = {
    ...normRemote.aiSettings,
    ...normLocal.aiSettings,
    providers,
    activeProviderId,
    chat: {
      ...(normRemote.aiSettings?.chat || {}),
      ...(normLocal.aiSettings?.chat || {}),
    },
    websearch: {
      ...(normRemote.aiSettings?.websearch || {}),
      ...(normLocal.aiSettings?.websearch || {}),
    },
    live: {
      ...DEFAULT_LIVE_SETTINGS,
      ...(normRemote.aiSettings?.live || {}),
      ...(normLocal.aiSettings?.live || {}),
    },
  };

  // 11. Dynamic Task Bank: union by ID
  const taskBankMap = new Map<string, TaskBankEntry>();
  for (const tb of normRemote.dynamicTaskBank || []) {
    if (tb?.id) taskBankMap.set(tb.id, tb);
  }
  for (const tb of normLocal.dynamicTaskBank || []) {
    if (tb?.id) taskBankMap.set(tb.id, tb);
  }
  const dynamicTaskBank = Array.from(taskBankMap.values());

  // 12. User Profile: merge non-blank fields
  const userProfile = {
    name: normLocal.userProfile?.name || normRemote.userProfile?.name || '',
    classLevel: normLocal.userProfile?.classLevel || normRemote.userProfile?.classLevel || '',
    examTarget: normLocal.userProfile?.examTarget || normRemote.userProfile?.examTarget || '',
    studyStyle: normLocal.userProfile?.studyStyle || normRemote.userProfile?.studyStyle || '',
    notes: normLocal.userProfile?.notes || normRemote.userProfile?.notes || '',
  };

  return {
    ...normRemote,
    ...normLocal,
    startDateISO,
    taskLogs,
    customTodos,
    studyVault,
    memory: {
      entries: Array.from(memEntriesMap.values()),
      summaries: Array.from(memSummariesMap.values()),
      lastSummarizedAt,
    },
    customHabits,
    subjectPlanners,
    clearedLevels,
    restDays,
    testDays,
    aiSettings,
    dynamicTaskBank,
    userProfile,
    timeZone: normLocal.timeZone || normRemote.timeZone || null,
    enable90DayTrack: normLocal.enable90DayTrack !== undefined ? normLocal.enable90DayTrack : normRemote.enable90DayTrack,
  };
}

/**
 * Non-destructively merges ChatSessions across devices.
 * Matches sessions by ID and unions messages chronologically by message ID / timestamp.
 */
export function mergeChatSessions(local: ChatSession[], remote: ChatSession[]): ChatSession[] {
  const sessionMap = new Map<string, ChatSession>();

  for (const s of remote || []) {
    if (s?.id) sessionMap.set(s.id, { ...s, messages: [...(s.messages || [])] });
  }

  for (const localSession of local || []) {
    if (!localSession?.id) continue;
    const remoteSession = sessionMap.get(localSession.id);
    if (!remoteSession) {
      sessionMap.set(localSession.id, { ...localSession, messages: [...(localSession.messages || [])] });
    } else {
      // Merge messages by ID / createdAt
      const msgMap = new Map<string, ChatMessage>();
      for (const m of remoteSession.messages || []) {
        const key = m.id || `${m.createdAt}-${m.role}-${m.content.slice(0, 30)}`;
        msgMap.set(key, m);
      }
      for (const m of localSession.messages || []) {
        const key = m.id || `${m.createdAt}-${m.role}-${m.content.slice(0, 30)}`;
        msgMap.set(key, m);
      }
      const mergedMessages = Array.from(msgMap.values()).sort(
        (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );

      const title = localSession.title && localSession.title !== 'New Chat' ? localSession.title : remoteSession.title;
      const updatedAt = (localSession.updatedAt || '') >= (remoteSession.updatedAt || '') ? localSession.updatedAt : remoteSession.updatedAt;

      sessionMap.set(localSession.id, {
        ...remoteSession,
        ...localSession,
        title: title || 'New Chat',
        updatedAt,
        messages: mergedMessages,
        prefs: {
          ...(remoteSession.prefs || {}),
          ...(localSession.prefs || {}),
        },
      });
    }
  }

  return Array.from(sessionMap.values()).sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
}

/**
 * Non-destructively merges two Misa sync payloads (Local vs Remote) so
 * cross-device recovery keeps BOTH devices' relationship memory, scheduled
 * reminders/calls, and proactive prefs.
 *
 * Strategy:
 *   - Lists (commitments, promises, durability memories, reminders, msgs/news)
 *     union by ID; entities without IDs dedupe by resolved key.
 *   - Numeric timers (streaks, fatigue counts, timestamps) take the max / most
 *     recent so nobody's "today" state is rolled back.
 *   - Scalar prefs (quiet hours, ringtone, grace) take the latest non-default
 *     value; booleans OR together (a feature enabled on either device stays on).
 */
export function mergeMisaData(local: MisaSyncPayload | null, remote: MisaSyncPayload | null): MisaSyncPayload | null {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  return {
    version: 1,
    relationship: mergeRelationshipState(local.relationship, remote.relationship),
    proactive: mergeProactiveBlob(local.proactive, remote.proactive),
  };
}

function mergeRelationshipState(local: RelationshipState, remote: RelationshipState): RelationshipState {
  const byId = <T extends { id?: string }>(key: (x: T) => string, items: T[][]): T[] => {
    const map = new Map<string, T>();
    for (const item of items.flat()) {
      if (!item) continue;
      map.set(item.id && item.id.length > 0 ? item.id : key(item), item);
    }
    return Array.from(map.values());
  };

  return {
    ...remote,
    ...local,
    currentGoal: local.currentGoal || remote.currentGoal,
    currentSubject: local.currentSubject || remote.currentSubject,
    currentProblemArea: local.currentProblemArea || remote.currentProblemArea,
    currentMoodContext: local.currentMoodContext || remote.currentMoodContext,
    lastInteractionTimestamp: Math.max(local.lastInteractionTimestamp || 0, remote.lastInteractionTimestamp || 0),
    lateNightStreak: Math.max(local.lateNightStreak || 0, remote.lateNightStreak || 0),
    recentSentMessages: dedupeStrings([...(remote.recentSentMessages || []), ...(local.recentSentMessages || [])]).slice(0, 20),
    wasUserIdleOrIgnoring: Boolean(local.wasUserIdleOrIgnoring || remote.wasUserIdleOrIgnoring),
    boundaries: {
      dndUntilTimestamp: Math.max(local.boundaries?.dndUntilTimestamp || 0, remote.boundaries?.dndUntilTimestamp || 0),
      quietHoursStart: local.boundaries?.quietHoursStart || remote.boundaries?.quietHoursStart,
      quietHoursEnd: local.boundaries?.quietHoursEnd || remote.boundaries?.quietHoursEnd,
      activeGraceMinutes: Math.max(local.boundaries?.activeGraceMinutes || 0, remote.boundaries?.activeGraceMinutes || 0),
    },
    commitments: byId<Commitment>((c) => `comm:${c.topic}:${c.createdAt}`, [remote.commitments, local.commitments]),
    pendingPromises: byId<UserPromise>((p) => `prm:${p.userPromise}:${p.createdAt}`, [remote.pendingPromises, local.pendingPromises]),
    durableMemories: byId<DurableMemoryItem>((m) => `mem:${m.fact}`, [remote.durableMemories, local.durableMemories]),
    fatigue: {
      consecutiveDismissals: Math.max(local.fatigue?.consecutiveDismissals || 0, remote.fatigue?.consecutiveDismissals || 0),
      fatigueScore: Math.max(local.fatigue?.fatigueScore || 0, remote.fatigue?.fatigueScore || 0),
      lastDismissalTimestamp: Math.max(local.fatigue?.lastDismissalTimestamp || 0, remote.fatigue?.lastDismissalTimestamp || 0),
      todayProactiveCount: Math.max(local.fatigue?.todayProactiveCount || 0, remote.fatigue?.todayProactiveCount || 0),
      proactiveDate: local.fatigue?.proactiveDate || remote.fatigue?.proactiveDate,
      topicCooldowns: { ...(remote.fatigue?.topicCooldowns || {}), ...(local.fatigue?.topicCooldowns || {}) },
    },
    preferredInteractionStyle: local.preferredInteractionStyle || remote.preferredInteractionStyle,
  };
}

function mergeProactiveBlob(
  local: MisaSyncPayload['proactive'],
  remote: MisaSyncPayload['proactive'],
): MisaSyncPayload['proactive'] {
  // Triggers: `id` is a local auto-increment (collides across devices), so
  // dedupe by idempotencyKey (date-topic based, stable across devices) and
  // fall back to a content/time key. Keep the soonest scheduled instance.
  const triggers = new Map<string, ProactiveTrigger>();
  for (const t of [...(remote.pendingTriggers || []), ...(local.pendingTriggers || [])]) {
    if (!t) continue;
    const key = t.idempotencyKey || `trig:${t.type}:${t.scheduledTime}:${t.topic || ''}:${t.offlineMessage}`;
    const existing = triggers.get(key);
    if (!existing) {
      triggers.set(key, t);
    } else if ((existing.scheduledTime || 0) > (t.scheduledTime || 0)) {
      triggers.set(key, t); // earlier occurrence wins
    }
  }

  // Scheduled messages/calls: ids are device-local; dedupe by kind+time+content
  // when ids differ, falling back to id. A cancelled flag anywhere wins.
  const scheduled = new Map<string, ScheduledProactiveMessage>();
  for (const s of [...(remote.scheduledMessages || []), ...(local.scheduledMessages || [])]) {
    if (!s) continue;
    const dedupe: ScheduledProactiveMessage[] = [s, scheduled.get(s.id)].filter((x): x is ScheduledProactiveMessage => Boolean(x));
    if (dedupe.length === 2 && dedupe[0].kind === dedupe[1].kind && dedupe[0].scheduledTime === dedupe[1].scheduledTime) {
      // Same logical reminder from two devices with different ids → merge flags.
      const [a, b] = dedupe;
      scheduled.set(a.id, {
        ...a,
        ...b,
        cancelled: Boolean(a.cancelled || b.cancelled),
        createdAt: Math.max(a.createdAt, b.createdAt),
      });
      continue;
    }
    const existing = scheduled.get(s.id);
    if (!existing) {
      scheduled.set(s.id, s);
    } else {
      scheduled.set(s.id, { ...existing, ...s, cancelled: existing.cancelled || s.cancelled });
    }
  }

  const missed = new Map<string, MisaSyncPayload['proactive']['missedInteractions'][number]>();
  for (const m of [...(remote.missedInteractions || []), ...(local.missedInteractions || [])]) {
    if (!m) continue;
    const key = `${m.kind}:${m.at}:${m.detail}`;
    const existing = missed.get(key);
    if (!existing || (existing.followedUpAt || 0) < (m.followedUpAt || 0)) missed.set(key, m);
  }

  return {
    prefs: {
      ...remote.prefs,
      ...local.prefs,
      // Booleans: a feature ON on either device stays ON.
      enabled: Boolean(local.prefs?.enabled || remote.prefs?.enabled),
      callsEnabled: Boolean(local.prefs?.callsEnabled || remote.prefs?.callsEnabled),
      // Numeric/string prefs take the latest non-default value.
      callFrequency: local.prefs?.callFrequency || remote.prefs?.callFrequency,
      quietHoursStart: local.prefs?.quietHoursStart || remote.prefs?.quietHoursStart,
      quietHoursEnd: local.prefs?.quietHoursEnd || remote.prefs?.quietHoursEnd,
      ringtonePreset: local.prefs?.ringtonePreset || remote.prefs?.ringtonePreset,
      activeGraceMinutes: Math.max(local.prefs?.activeGraceMinutes || 0, remote.prefs?.activeGraceMinutes || 0),
      ...(local.prefs?.customRingtoneUrl || remote.prefs?.customRingtoneUrl
        ? { customRingtoneUrl: latestNonBlank(local.prefs?.customRingtoneUrl, remote.prefs?.customRingtoneUrl) }
        : {}),
    },
    lastActiveTimestamp: Math.max(local.lastActiveTimestamp || 0, remote.lastActiveTimestamp || 0),
    lastUserChatTimestamp: Math.max(local.lastUserChatTimestamp || 0, remote.lastUserChatTimestamp || 0),
    lastCallTimestamp: Math.max(local.lastCallTimestamp || 0, remote.lastCallTimestamp || 0),
    lastCallDeclinedTimestamp: Math.max(local.lastCallDeclinedTimestamp || 0, remote.lastCallDeclinedTimestamp || 0),
    consecutiveCallDeclines: Math.max(local.consecutiveCallDeclines || 0, remote.consecutiveCallDeclines || 0),
    dndUntilTimestamp: Math.max(local.dndUntilTimestamp || 0, remote.dndUntilTimestamp || 0),
    coldStartDone: Boolean(local.coldStartDone || remote.coldStartDone),
    pendingTriggers: Array.from(triggers.values()),
    scheduledMessages: Array.from(scheduled.values()),
    missedInteractions: Array.from(missed.values()),
  };
}

function latestNonBlank<T>(a: T | undefined | null, b: T | undefined | null): T | undefined {
  if (a !== undefined && a !== null && a !== '') return a;
  return (b !== undefined && b !== null && b !== '') ? b : undefined;
}

function dedupeStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter((x) => x && x.trim().length > 0)));
}

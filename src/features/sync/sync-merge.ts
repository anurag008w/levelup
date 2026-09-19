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
 * Non-destructively merge Local vs Remote app state. The merge is intentionally
 * union-oriented so independent work from either device is retained: task logs,
 * todos, study resources, memory, habits, planners, levels, days, AI settings,
 * dynamic tasks, and profile fields are reconciled without a blanket overwrite.
 */
export function mergeAppState(local: AppState, remote: AppState): AppState {
  const normLocal = normalizeState(local);
  const normRemote = normalizeState(remote);

  // 1. Start Date: preserve the earliest known journey start date.
  let startDateISO = normLocal.startDateISO;
  if (normLocal.startDateISO && normRemote.startDateISO) {
    startDateISO = normLocal.startDateISO <= normRemote.startDateISO ? normLocal.startDateISO : normRemote.startDateISO;
  } else if (!normLocal.startDateISO && normRemote.startDateISO) {
    startDateISO = normRemote.startDateISO;
  }

  // 2. Task Logs: deep-union each day so a completed task is never lost.
  const allDays = new Set([...Object.keys(normLocal.taskLogs || {}), ...Object.keys(normRemote.taskLogs || {})]);
  const taskLogs: Record<string, Record<string, boolean>> = {};
  for (const day of allDays) {
    const localDay = normLocal.taskLogs?.[day] || {};
    const remoteDay = normRemote.taskLogs?.[day] || {};
    const taskIds = new Set([...Object.keys(remoteDay), ...Object.keys(localDay)]);
    const mergedDay: Record<string, boolean> = {};
    for (const taskId of taskIds) {
      mergedDay[taskId] = Boolean(remoteDay[taskId] || localDay[taskId]);
    }
    taskLogs[day] = mergedDay;
  }

  // 3. Custom To-Dos: merge by ID, retaining completion and the latest metadata.
  const todoMap = new Map<string, CustomTodoTask>();
  for (const t of normRemote.customTodos || []) if (t?.id) todoMap.set(t.id, t);
  for (const t of normLocal.customTodos || []) {
    if (!t?.id) continue;
    const existing = todoMap.get(t.id);
    if (!existing) todoMap.set(t.id, t);
    else {
      const completed = existing.completed || t.completed;
      const latest = (t.completedAtISO || t.createdAtISO || '') >= (existing.completedAtISO || existing.createdAtISO || '') ? t : existing;
      todoMap.set(t.id, { ...latest, completed });
    }
  }
  const customTodos = Array.from(todoMap.values());

  // 4. Study Vault: union resources by stable ID.
  const vaultMap = new Map<string, StudyResource>();
  for (const v of normRemote.studyVault || []) if (v?.id) vaultMap.set(v.id, v);
  for (const v of normLocal.studyVault || []) if (v?.id) vaultMap.set(v.id, v);
  const studyVault = Array.from(vaultMap.values());

  // 5. Memory Facts: dedupe by ID and normalized fact text.
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
  for (const s of [...(normRemote.memory?.summaries || []), ...(normLocal.memory?.summaries || [])]) if (s?.id) memSummariesMap.set(s.id, s);
  const lastSummarizedAt = [normLocal.memory?.lastSummarizedAt, normRemote.memory?.lastSummarizedAt].filter(Boolean).sort().pop() || null;

  // 6. Custom Habits: union by stable ID.
  const habitMap = new Map<string, Habit>();
  for (const h of normRemote.customHabits || []) if (h?.id) habitMap.set(h.id, h);
  for (const h of normLocal.customHabits || []) if (h?.id) habitMap.set(h.id, h);
  const customHabits = Array.from(habitMap.values());

  // 7. Subject Planners: union by stable ID.
  const plannerMap = new Map<string, SubjectPlanner>();
  for (const p of normRemote.subjectPlanners || []) if (p?.id) plannerMap.set(p.id, p);
  for (const p of normLocal.subjectPlanners || []) if (p?.id) plannerMap.set(p.id, p);
  const subjectPlanners = Array.from(plannerMap.values());

  // 8. Cleared Levels: set-union and stable numeric ordering.
  const clearedLevels = Array.from(new Set([...(normLocal.clearedLevels || []), ...(normRemote.clearedLevels || [])])).sort((a, b) => a - b);

  // 9. Rest/Test Days: set-union and stable numeric ordering.
  const restDays = Array.from(new Set([...(normLocal.restDays || []), ...(normRemote.restDays || [])])).sort((a, b) => a - b);
  const testDays = Array.from(new Set([...(normLocal.testDays || []), ...(normRemote.testDays || [])])).sort((a, b) => a - b);

  // 10. AI Settings: prefer local values while retaining remote provider data and safe live defaults.
  const providers = { ...(normRemote.aiSettings?.providers || {}), ...(normLocal.aiSettings?.providers || {}) };
  const activeProviderId = normLocal.aiSettings?.activeProviderId || normRemote.aiSettings?.activeProviderId || null;
  const remoteLive = normRemote.aiSettings?.live;
  const sanitizedRemoteLive = remoteLive?.apiKey === 'REDACTED_IN_SYNC' || remoteLive?.apiKey === 'REDACTED_IN_BACKUP'
    ? { ...remoteLive, apiKey: undefined }
    : remoteLive;
  const aiSettings: AiSettings = {
    ...normRemote.aiSettings,
    ...normLocal.aiSettings,
    providers,
    activeProviderId,
    chat: { ...(normRemote.aiSettings?.chat || {}), ...(normLocal.aiSettings?.chat || {}) },
    websearch: { ...(normRemote.aiSettings?.websearch || {}), ...(normLocal.aiSettings?.websearch || {}) },
    live: { ...DEFAULT_LIVE_SETTINGS, ...(sanitizedRemoteLive || {}), ...(normLocal.aiSettings?.live || {}) },
  };

  // 11. Dynamic Task Bank: union generated task entries by stable ID.
  const taskBankMap = new Map<string, TaskBankEntry>();
  for (const tb of normRemote.dynamicTaskBank || []) if (tb?.id) taskBankMap.set(tb.id, tb);
  for (const tb of normLocal.dynamicTaskBank || []) if (tb?.id) taskBankMap.set(tb.id, tb);
  const dynamicTaskBank = Array.from(taskBankMap.values());

  // 12. User Profile: prefer populated local fields, then remote values.
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
    memory: { entries: Array.from(memEntriesMap.values()), summaries: Array.from(memSummariesMap.values()), lastSummarizedAt },
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

export function mergeChatSessions(local: ChatSession[], remote: ChatSession[]): ChatSession[] {
  const sessionMap = new Map<string, ChatSession>();
  for (const s of remote || []) if (s?.id) sessionMap.set(s.id, { ...s, messages: [...(s.messages || [])] });
  for (const localSession of local || []) {
    if (!localSession?.id) continue;
    const remoteSession = sessionMap.get(localSession.id);
    if (!remoteSession) sessionMap.set(localSession.id, { ...localSession, messages: [...(localSession.messages || [])] });
    else {
      const localUpdatedAt = Date.parse(localSession.updatedAt || '');
      const remoteUpdatedAt = Date.parse(remoteSession.updatedAt || '');
      const localIsNewer = localUpdatedAt > remoteUpdatedAt
        || (localUpdatedAt === remoteUpdatedAt && chatSessionConflictKey(localSession) > chatSessionConflictKey(remoteSession));
      const latestSession = localIsNewer ? localSession : remoteSession;
      const olderSession = localIsNewer ? remoteSession : localSession;
      const msgMap = new Map<string, ChatMessage>();
      for (const m of remoteSession.messages || []) msgMap.set(m.id || `${m.createdAt}-${m.role}-${m.content.slice(0, 30)}`, m);
      for (const m of localSession.messages || []) {
        const key = m.id || `${m.createdAt}-${m.role}-${m.content.slice(0, 30)}`;
        if (!msgMap.has(key) || localIsNewer) msgMap.set(key, m);
      }
      const mergedMessages = Array.from(msgMap.values()).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      const title = latestSession.title && latestSession.title !== 'New Chat'
        ? latestSession.title
        : (olderSession.title && olderSession.title !== 'New Chat' ? olderSession.title : 'New Chat');
      sessionMap.set(localSession.id, {
        ...olderSession,
        ...latestSession,
        title,
        updatedAt: latestSession.updatedAt || olderSession.updatedAt,
        messages: mergedMessages,
        prefs: { ...(olderSession.prefs || {}), ...(latestSession.prefs || {}) },
      });
    }
  }
  return Array.from(sessionMap.values()).sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

function chatSessionConflictKey(session: ChatSession): string {
  const prefs = Object.entries(session.prefs || {}).sort(([a], [b]) => a.localeCompare(b));
  const messages = [...(session.messages || [])]
    .map((m) => ({ id: m.id || '', role: m.role, content: m.content, createdAt: m.createdAt || '' }))
    .sort((a, b) => `${a.id}\u0000${a.createdAt}\u0000${a.role}\u0000${a.content}`.localeCompare(`${b.id}\u0000${b.createdAt}\u0000${b.role}\u0000${b.content}`));
  return JSON.stringify({ title: session.title || '', createdAt: session.createdAt || '', prefs, messages });
}

export function mergeMisaData(local: MisaSyncPayload | null, remote: MisaSyncPayload | null): MisaSyncPayload | null {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;
  return { version: 1, relationship: mergeRelationshipState(local.relationship, remote.relationship), proactive: mergeProactiveBlob(local.proactive, remote.proactive) };
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
  const remoteCooldowns = sanitizeTopicCooldowns(remote.fatigue?.topicCooldowns);
  const localCooldowns = sanitizeTopicCooldowns(local.fatigue?.topicCooldowns);
  const topicCooldowns: Record<string, number> = { ...remoteCooldowns };
  for (const [topic, localExpiry] of Object.entries(localCooldowns)) {
    const remoteExpiry = topicCooldowns[topic];
    if (!Number.isFinite(localExpiry) || localExpiry < 0) continue;
    if (!Number.isFinite(remoteExpiry) || localExpiry > remoteExpiry) topicCooldowns[topic] = localExpiry;
  }
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
      topicCooldowns,
    },
    preferredInteractionStyle: local.preferredInteractionStyle || remote.preferredInteractionStyle,
  };
}

/**
 * Merge proactive data idempotently across devices. Pending triggers are deduped
 * by idempotencyKey (with a deterministic fallback), scheduled messages are
 * deduped by logical content/time identity, and cancellation is monotonic: if
 * any copy is cancelled, the merged record remains cancelled.
 */
function mergeProactiveBlob(local: MisaSyncPayload['proactive'], remote: MisaSyncPayload['proactive']): MisaSyncPayload['proactive'] {
  const triggers = new Map<string, ProactiveTrigger>();
  for (const t of [...(remote.pendingTriggers || []), ...(local.pendingTriggers || [])]) {
    if (!t) continue;
    const key = t.idempotencyKey || `trig:${t.type}:${t.scheduledTime}:${t.topic || ''}:${t.offlineMessage}`;
    const existing = triggers.get(key);
    if (!existing) triggers.set(key, t);
    else if ((existing.scheduledTime || 0) > (t.scheduledTime || 0)) triggers.set(key, t);
  }
  const scheduled = new Map<string, ScheduledProactiveMessage>();
  for (const s of [...(remote.scheduledMessages || []), ...(local.scheduledMessages || [])]) {
    if (!s) continue;
    const key = scheduledProactiveLogicalKey(s);
    const existing = scheduled.get(key);
    if (!existing) {
      scheduled.set(key, s);
      continue;
    }
    const latest = (existing.createdAt || 0) >= (s.createdAt || 0) ? existing : s;
    scheduled.set(key, {
      ...latest,
      // Cancellation is a tombstone: once observed, sync must never resurrect it.
      cancelled: Boolean(existing.cancelled || s.cancelled),
      deliveryRetries: Math.max(existing.deliveryRetries || 0, s.deliveryRetries || 0),
    });
  }
  const missed = new Map<string, MisaSyncPayload['proactive']['missedInteractions'][number]>();
  for (const m of [...(remote.missedInteractions || []), ...(local.missedInteractions || [])]) {
    if (!m) continue;
    const key = `${m.kind}:${m.at}:${m.detail}`;
    const existing = missed.get(key);
    if (!existing || (existing.followedUpAt || 0) < (m.followedUpAt || 0)) missed.set(key, m);
  }
  const remotePrefs = remote.prefs || {};
  const localPrefs = local.prefs || {};
  const prefs = {
    ...remotePrefs,
    ...localPrefs,
    enabled: Boolean(remotePrefs.enabled || localPrefs.enabled),
    callsEnabled: Boolean(remotePrefs.callsEnabled || localPrefs.callsEnabled),
    activeGraceMinutes: Math.max(remotePrefs.activeGraceMinutes || 0, localPrefs.activeGraceMinutes || 0),
    customRingtoneUrl: localPrefs.customRingtoneUrl?.trim() || remotePrefs.customRingtoneUrl?.trim() || undefined,
  };
  return {
    prefs,
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

function scheduledProactiveLogicalKey(message: ScheduledProactiveMessage): string {
  // The generated ID is the stable identity shared by synced copies.
  // Content/time remains a compatibility fallback for legacy records without an ID.
  if (message.id) return `id:${message.id}`;
  const linkedEntity = message.linkedEntity
    ? `${message.linkedEntity.type}:${message.linkedEntity.value}`
    : '';
  return [message.kind, message.scheduledTime, message.topic || '', message.text || message.reason || '', linkedEntity].join('\\u0000');
}

function sanitizeTopicCooldowns(input: unknown): Record<string, number> {
  if (typeof input !== 'object' || input === null) return {};
  const sanitized: Record<string, number> = {};
  for (const [rawTopic, value] of Object.entries(input as Record<string, unknown>)) {
    const topic = rawTopic.trim();
    if (!topic || typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    sanitized[topic] = value;
  }
  return sanitized;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

import type { AppState, AiSettings } from '../../core/domain/state';
import type { ChatSession, ChatMessage } from '../../core/domain/chat';
import type { CustomTodoTask } from '../../core/domain/todo-tasks';
import type { StudyResource } from '../../core/domain/study-vault';
import type { MemoryEntry } from '../../core/domain/memory';
import type { Habit } from '../../core/domain/habit';
import type { SubjectPlanner } from '../../core/domain/subject-planner';
import type { TaskBankEntry } from '../../core/domain/task-bank';
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

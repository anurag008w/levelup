import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Check, CheckCircle2, ChevronDown, Clock, Flame, Pencil, Plus, RotateCcw, ShieldCheck, Siren, Sunrise, Sunset, Target, Timer, Trash2, X, Zap } from 'lucide-react';
import type { AppState, CustomTodoTask, TodoCategory, TodoPriority } from '../types';
import type { EnergyLevel, TaskBankEntry, TaskType } from '../core/domain/task-bank';
import CustomTodoSection from '../components/CustomTodoSection';
import { PHASES } from '../data/curriculum';
import { DEFAULT_PROGRESSION_CONFIG, type DailyPlan, type PlannedTask } from '../core/domain/progress';
import { TASK_TYPES } from '../core/domain/task-bank';
import { getCurrentDayNumber, getJourneyDayLimit, getLevelForDay, isExamMonthActive, daysUntilExam } from '../lib/engine';
import { computeMasterySummary, effectiveBucket } from '../features/habit-engine/mastery';
import { container } from '../di/container';
import DayGauge from '../components/DayGauge';
import Confetti from '../components/Confetti';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import ProgressBar from '../components/ui/ProgressBar';
import AdminLogin from '../components/AdminLogin';
import DaySwitcher from '../components/DaySwitcher';
import { phaseAccent } from '../lib/phaseColors';
import { parseTaskBankEntry } from '../features/task-bank/validation';
import { haptic, hapticSuccess } from '../lib/haptics';
import type { AdminVerifyResult } from '../lib/admin';
import { useMenuFocus } from '../components/useMenuFocus';
import { MoreButton } from '../components/menu-accessibility';

const ENERGY_LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];
const EMPTY_FORM = { title: '', durationMin: 30, energyLevel: 'medium' as EnergyLevel, taskType: 'Beginner' as TaskType };

export default function TodayScreen({
  state,
  today,
  update,
  adminUnlocked,
  canAutoUnlock,
  onAutoUnlock,
  onUnlockAdmin,
  onLockAdmin,
  onSetAdminDay,
  onNavigate,
}: {
  state: AppState;
  today: string;
  update: (fn: (s: AppState) => AppState) => void;
  adminUnlocked: boolean;
  /** The logged-in session is a server super admin — shield unlocks directly. */
  canAutoUnlock: boolean;
  onAutoUnlock: () => boolean;
  onUnlockAdmin: (username: string, password: string) => Promise<AdminVerifyResult>;
  onLockAdmin: () => void;
  onSetAdminDay: (day: number | null) => void;
  onNavigate?: (tab: 'task-bank' | 'progress' | 'chat') => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    durationMin: number;
    energyLevel?: EnergyLevel;
    taskType?: TaskType;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [confettiKey, setConfettiKey] = useState(0);
  const celebratedRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

  // Clear any pending notice-dismiss timer on unmount so a late tick can't
  // call setState after the environment is gone (crashes test teardown).
  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const dayNumber = getCurrentDayNumber(state, today);
  const journeyDayLimit = getJourneyDayLimit(state);
  const level = getLevelForDay(dayNumber);
  const phase = PHASES.find((p) => p.id === level?.phase);

  // Mastered (completed bucket) tasks for the Completed section.
  const masterySummary = state.startDateISO
    ? computeMasterySummary(state, dayNumber, (d) => container.planner.stats.baseTasksForDay(d))
    : null;
  const completedTasks: TaskBankEntry[] = [];
  if (masterySummary) {
    for (const [id, entry] of masterySummary.entriesById) {
      const m = masterySummary.masteryById.get(id);
      if (!m) continue;
      const placement = state.masteryPlacement?.[id];
      if (effectiveBucket(placement, m.masteredAtDay !== null, dayNumber) === 'completed') {
        completedTasks.push(entry);
      }
    }
    completedTasks.sort(
      (a, b) =>
        (masterySummary.masteryById.get(b.id)?.masteredAtDay ?? 0) -
          (masterySummary.masteryById.get(a.id)?.masteredAtDay ?? 0) ||
        a.title.localeCompare(b.title),
    );
  }
  const completedCount = completedTasks.length;

  const config = {
    ...DEFAULT_PROGRESSION_CONFIG,
    availableMinutes: state.studyTimeMinutes > 0 ? state.studyTimeMinutes : DEFAULT_PROGRESSION_CONFIG.availableMinutes,
    aiEnabled: container.providerSettings.isAiEnabled(),
  };

  const context = state.startDateISO ? container.planner.buildContext(state, today, config) : null;
  const plan: DailyPlan | null = state.startDateISO ? container.planner.buildPlan(state, today, config) : null;

  const pct = plan ? planPct(plan, state) : 0;
  const doneCount = plan ? plan.tasks.filter((t) => isDone(state, t)).length : 0;
  const totalCount = plan ? plan.tasks.length : 0;
  const examMode = isExamMonthActive(state, today);
  const examLeft = daysUntilExam(state, today);
  const streak = context?.streak ?? 0;
  const accent = phaseAccent(phase?.color ?? 'core');
  const dateLabel = formatDate(today);

  useEffect(() => {
    if (pct === 100 && totalCount > 0 && !celebratedRef.current) {
      celebratedRef.current = true;
      setConfettiKey((n) => n + 1);
    }
  }, [pct, totalCount]);

  const is90Day = state.enable90DayTrack !== false;
  const todos = state.customTodos ?? [];

  useEffect(() => {
    if (!state.startDateISO && !is90Day) {
      update((s) => ({ ...s, startDateISO: today }));
    }
  }, [state.startDateISO, is90Day, today, update]);

  function handleAddCustomTodo(newTodoData: { title: string; priority: TodoPriority; category: TodoCategory; estimatedMinutes: number }) {
    const newTodo: CustomTodoTask = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: newTodoData.title,
      completed: false,
      priority: newTodoData.priority,
      category: newTodoData.category,
      estimatedMinutes: newTodoData.estimatedMinutes,
      createdAtISO: new Date().toISOString(),
      createdBy: 'user',
    };
    update((s) => ({
      ...s,
      customTodos: [newTodo, ...(s.customTodos ?? [])],
    }));
  }

  function handleToggleCustomTodo(id: string) {
    haptic(8);
    update((s) => ({
      ...s,
      customTodos: (s.customTodos ?? []).map((t) =>
        t.id === id
          ? { ...t, completed: !t.completed, completedAtISO: !t.completed ? new Date().toISOString() : undefined }
          : t,
      ),
    }));
  }

  function handleDeleteCustomTodo(id: string) {
    haptic();
    update((s) => ({
      ...s,
      customTodos: (s.customTodos ?? []).filter((t) => t.id !== id),
    }));
  }

  function handleEditCustomTodo(id: string, updated: Partial<CustomTodoTask> | string) {
    haptic();
    const patch = typeof updated === 'string' ? { title: updated } : updated;
    update((s) => ({
      ...s,
      customTodos: (s.customTodos ?? []).map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }));
  }

  function handleReorderCustomTodo(newTodos: CustomTodoTask[]) {
    update((s) => ({
      ...s,
      customTodos: newTodos,
    }));
  }

  // --- FLEXIBLE STUDY PLANNER MODE (90-day track disabled) ---
  if (!is90Day) {
    const completedTodos = todos.filter((t) => t.completed);
    const pendingTodos = todos.filter((t) => !t.completed);
    const todoPct = todos.length > 0 ? Math.round((completedTodos.length / todos.length) * 100) : 0;
    const totalMinutes = todos.reduce((acc, t) => acc + (t.estimatedMinutes || 30), 0);

    return (
      <div className="screen fade-up">
        <Confetti trigger={confettiKey} />

        <ScreenHeader
          eyebrow="DAILY MISSION"
          title={greeting()}
          subtitle={`${dateLabel} · ${pendingTodos.length} tasks pending`}
          right={
            <div className="flex items-center gap-2">
              <StreakPill streak={streak} />
              <button
                type="button"
                aria-label={adminUnlocked ? 'Admin panel khula hai (lock karo)' : 'Admin login'}
                className="icon-btn"
                style={adminUnlocked ? { color: 'var(--color-peak)' } : undefined}
                onClick={() => {
                  if (adminUnlocked) {
                    onLockAdmin();
                    return;
                  }
                  if (canAutoUnlock && onAutoUnlock()) {
                    hapticSuccess();
                    return;
                  }
                  setShowAdminLogin(true);
                }}
              >
                <ShieldCheck size={16} />
              </button>
            </div>
          }
        />

        {/* Progress Card for Flexible Mode */}
        <div className="gradient-border mb-4 rounded-2xl p-px">
          <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel/90 px-4 pb-4 pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow text-l">TODAY'S TARGET</p>
                <h2 className="font-display text-xl font-bold tracking-tight text-text mt-0.5">
                  {completedTodos.length === todos.length && todos.length > 0
                    ? 'All Tasks Done! 🎉'
                    : `${completedTodos.length} of ${todos.length} Done`}
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  {totalMinutes > 0 ? `${totalMinutes} min scheduled for today` : 'Add tasks to start your day'}
                </p>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-l/10 font-mono text-base font-bold text-light">
                {todoPct}%
              </div>
            </div>

            <div className="mt-4">
              <ProgressBar value={todoPct} height={8} color={todoPct === 100 ? 'var(--color-success)' : 'var(--color-l)'} />
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="stat-strip mb-4">
          <StatTile icon={<Target size={15} color="var(--color-l)" />} value={`${completedTodos.length}/${todos.length}`} label="Tasks done" />
          <StatTile icon={<Clock size={15} color="var(--color-light)" />} value={`${totalMinutes}m`} label="Total time" />
          <StatTile icon={<Flame size={15} color="var(--color-peak)" />} value={streak} label="Streak days" />
        </div>

        {notice && (
          <div className="toast mb-4 fade-in" role="status">
            <Check size={15} color="var(--color-l)" />
            {notice}
          </div>
        )}

        <CustomTodoSection
          todos={todos}
          onToggle={handleToggleCustomTodo}
          onDelete={handleDeleteCustomTodo}
          onEdit={handleEditCustomTodo}
          onAdd={handleAddCustomTodo}
          onReorder={handleReorderCustomTodo}
          flash={flash}
          isStandalone={true}
        />

        {showAdminLogin && <AdminLogin onLogin={onUnlockAdmin} onClose={() => setShowAdminLogin(false)} />}
      </div>
    );
  }

  if (!state.startDateISO) {
    return <StartScreen onStart={() => update((s) => ({ ...s, startDateISO: today }))} onNavigate={onNavigate} />;
  }

  const activePlan: DailyPlan = plan!;
  const activeContext = context!;

  function flash(msg: string) {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2500);
  }

  function onToggleTask(task: PlannedTask) {
    haptic(8);
    update((s) => togglePlanned(s, task));
  }

  function addTodayTask() {
    if (!form.title.trim()) {
      flash('Pehle task ka title bharo.');
      return;
    }
    if (hasDuplicateTask(state.dynamicTaskBank, form.title.trim(), dayNumber)) {
      flash('Ye task is day ke liye pehle se Task Bank mein hai. Duplicate add nahi hua.');
      return;
    }
    const entry = parseTaskBankEntry({
      id: uid('today'),
      habitId: 'daily_planning',
      title: form.title.trim(),
      description: '',
      phase: level?.phase ?? 'jee-core',
      difficulty: 2,
      estimatedDurationMin: clampInt(form.durationMin, 5, 180),
      energyLevel: form.energyLevel,
      tags: ['today'],
      prerequisites: [],
      taskType: form.taskType,
      revisionSuitability: 0.3,
      backlogSuitability: 0.3,
      thinkingSkills: ['focus'],
      jeeRelevance: { score: 0.5 },
      unlockConditions: [{ type: 'day-exact', day: dayNumber }],
      active: true,
    });
    update((s) => ({ ...s, dynamicTaskBank: upsertUniqueTask(s.dynamicTaskBank, entry) }));
    setForm(EMPTY_FORM);
    setShowAdd(false);
    flash('Task aaj ke plan mein add ho gaya.');
  }

  function startEditTask(task: PlannedTask) {
    setEditingId(task.entry.id);
    setEditDraft({
      title: task.entry.title,
      durationMin: task.entry.estimatedDurationMin,
      energyLevel: task.entry.energyLevel || 'medium',
      taskType: task.entry.taskType || 'Beginner',
    });
  }

  function saveTaskEdit(task: PlannedTask) {
    if (!editDraft || !editDraft.title.trim()) {
      flash('Title khaali nahi ho sakta.');
      return;
    }
    update((s) => ({
      ...s,
      dynamicTaskBank: [
        ...s.dynamicTaskBank.filter((e) => e.id !== task.entry.id),
        {
          ...task.entry,
          title: editDraft.title.trim(),
          estimatedDurationMin: clampInt(editDraft.durationMin, 5, 180),
          energyLevel: editDraft.energyLevel ?? task.entry.energyLevel,
          taskType: editDraft.taskType ?? task.entry.taskType,
          active: true,
        },
      ],
    }));
    setEditingId(null);
    setEditDraft(null);
    flash('Task edit ho gaya.');
  }

  function deleteTask(task: PlannedTask) {
    if (!window.confirm('Ye task aaj ke plan se hata dega (Task Bank delete nahi hota). Confirm?')) return;
    update((s) => {
      if (task.entry.legacy) {
        const existing = s.dynamicTaskBank.find((e) => e.id === task.entry.id);
        const base = existing ?? task.entry;
        if (base.unlockConditions.some((c) => c.type === 'not-day' && c.day === dayNumber)) return s;
        const updated = { ...base, active: true, unlockConditions: [...base.unlockConditions, { type: 'not-day' as const, day: dayNumber }] };
        return {
          ...s,
          dynamicTaskBank: existing ? s.dynamicTaskBank.map((e) => (e.id === updated.id ? updated : e)) : [...s.dynamicTaskBank, updated],
        };
      }
      return { ...s, dynamicTaskBank: s.dynamicTaskBank.filter((e) => e.id !== task.entry.id) };
    });
    flash('Task aaj ke plan se hata diya (bank safe).');
  }

  /** Books a mastered task into a specific content day's plan (one-shot). */
  function moveToDay(taskId: string, day: number) {
    const target = Math.round(day);
    if (!Number.isFinite(target) || target < 1 || target > journeyDayLimit) {
      flash(`Day 1 se ${journeyDayLimit} ke beech ek number do.`);
      return;
    }
    update((s) => ({
      ...s,
      masteryPlacement: { ...(s.masteryPlacement ?? {}), [taskId]: { bucket: 'scheduled', day: target } },
    }));
    if (target === dayNumber) {
      flash('Task aaj ke plan mein wapas aa gaya.');
    } else {
      flash(`Task Day ${target} ke liye schedule ho gaya.`);
    }
  }

  /** Moves a scheduled mastered task back to the permanent completed bucket. */
  function moveBackToCompleted(taskId: string) {
    update((s) => ({
      ...s,
      masteryPlacement: { ...(s.masteryPlacement ?? {}), [taskId]: { bucket: 'completed' } },
    }));
    flash('Task wapas Completed section mein aa gaya.');
  }

  const groups = ['exam', 'morning', 'blocks', 'night', 'weekly', 'monthly', 'bonus', 'mock'] as const;

  return (
    <div className="screen fade-up">
      <Confetti trigger={confettiKey} />

      <ScreenHeader
        eyebrow={`CASE — DAY ${String(dayNumber).padStart(3, '0')} / ${phase?.title ?? 'PHASE'}`}
        title={level?.title ?? greeting()}
        subtitle={`${dateLabel} · Level ${level?.id ?? 0}`}
        right={
          <div className="flex items-center gap-2">
            <StreakPill streak={streak} />
            <button
              type="button"
              aria-label={adminUnlocked ? 'Admin panel khula hai (lock karo)' : 'Admin login'}
              className="icon-btn"
              style={adminUnlocked ? { color: 'var(--color-peak)' } : undefined}
              onClick={() => {
                if (adminUnlocked) {
                  onLockAdmin();
                  return;
                }
                // Super admins get in without a password dialog.
                if (canAutoUnlock && onAutoUnlock()) {
                  hapticSuccess();
                  return;
                }
                setShowAdminLogin(true);
              }}
            >
              <ShieldCheck size={16} />
            </button>
          </div>
        }
      />

      {adminUnlocked && (
        <DaySwitcher
          dayNumber={dayNumber}
          totalDays={journeyDayLimit}
          dateLabel={dateLabel}
          onJump={(n) => onSetAdminDay(n)}
          onToday={() => onSetAdminDay(null)}
          onLock={onLockAdmin}
        />
      )}

      {/* Hero */}
      <div className="gradient-border mb-4 rounded-2xl p-px">
        <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel/90 px-4 pb-4 pt-5">
          <div className="flex items-center justify-center">
            <DayGauge
              dayNumber={dayNumber}
              totalDays={journeyDayLimit}
              todayPct={pct}
              levelCode={`LVL-${String(level?.id ?? 0).padStart(2, '0')}`}
            />
          </div>
          {level && (
            <div className="mt-3 text-center">
              <p className="eyebrow" style={{ color: accent }}>
                {phase?.title}
              </p>
              <h2 className="mt-1 font-display text-base font-bold tracking-tight">{level.title}</h2>
              <p className="mt-0.5 text-xs text-muted">
                Days {level.dayStart}–{level.dayEnd}
              </p>
            </div>
          )}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-muted">Today's plan</span>
              <span className="font-display font-bold" style={{ color: pct === 100 ? 'var(--color-success)' : 'var(--color-text)' }}>
                {doneCount}/{totalCount} · {pct}%
              </span>
            </div>
            <ProgressBar value={pct} height={8} color={pct === 100 ? 'var(--color-success)' : 'var(--color-l)'} />
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="stat-strip mb-4">
        <StatTile icon={<Target size={15} color="var(--color-l)" />} value={`${doneCount}/${totalCount}`} label="Tasks done" />
        <StatTile icon={<Zap size={15} color="var(--color-light)" />} value={activeContext.availableMinutes} label="Min today" />
        <StatTile
          icon={<Calendar size={15} color={activeContext.gapDays >= 2 ? 'var(--color-danger)' : 'var(--color-peak)'} />}
          value={activeContext.gapDays}
          label="Gap days"
          warn={activeContext.gapDays >= 2}
        />
      </div>

      {notice && (
        <div className="toast mb-4 fade-in" role="status">
          <Check size={15} color="var(--color-l)" />
          {notice}
        </div>
      )}

      {!level?.authored && (
        <div className="card mb-4 flex items-start gap-2.5 p-3.5 text-sm text-muted">
          <SparkleIcon />
          <p>Detailed content coming soon. Keep continuing previous level habits (listed below).</p>
        </div>
      )}

      {activeContext.restDay && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-light-dim/50 bg-[rgba(239,233,223,0.08)] p-3.5 fade-in">
          <Sunset size={18} color="var(--color-light)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-light">Rest Day — Chhuti</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Aaj koi auto-plan nahi hai. Sirf wahi tasks dikhenge jo aapne/tumhare coach ne is din ke liye explicitly schedule kiye hain. Fully relax karo ya optional light study karo.
            </p>
          </div>
        </div>
      )}

      {examMode && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-light-dim/50 bg-[rgba(239,233,223,0.08)] p-3.5 fade-in">
          <Siren size={18} color="var(--color-light)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-light">Exam Month — {examLeft} din baaki</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">Naya topic nahi. Sirf revision, mocks aur recovery. Checklist neeche hai.</p>
          </div>
        </div>
      )}

      {/* Add task (inline form, triggered by FAB) */}
      {showAdd && (
        <div className="card mb-4 p-4 fade-in">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-sm font-bold">Aaj ka naya task</p>
            <button type="button" onClick={() => setShowAdd(false)} className="icon-btn" aria-label="Close add task">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-2.5 text-sm">
            <input
              className="field"
              placeholder="Aaj ka task title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
            <div className="grid grid-cols-3 gap-2.5">
              <input
                className="field"
                type="number"
                min={5}
                max={180}
                aria-label="Duration in minutes"
                value={form.durationMin}
                onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) || 30 })}
              />
              <select
                className="field"
                aria-label="Energy level"
                value={form.energyLevel}
                onChange={(e) => setForm({ ...form, energyLevel: e.target.value as EnergyLevel })}
              >
                {ENERGY_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <select
                className="field"
                aria-label="Task type"
                value={form.taskType}
                onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}
              >
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary w-full text-sm font-bold" onClick={addTodayTask}>
              <Plus size={15} />
              Add to today's plan
            </button>
          </div>
        </div>
      )}

      {groups.map((g) => {
        const tasks = group(activePlan, g);
        if (tasks.length === 0) return null;
        const done = tasks.filter((t) => isDone(state, t)).length;
        const accent = groupAccent(g);
        const dim = g === 'bonus';
        return (
          <div key={g} className="mb-4">
            <SectionHeader icon={groupIcon(g)} accent={accent} title={groupLabel(g)} meta={`${done}/${tasks.length}`} />
            <div className="space-y-2.5">
              {tasks.map((t) => (
                <TaskRow
                  key={t.entry.id}
                  task={t}
                  done={isDone(state, t)}
                  onToggle={() => onToggleTask(t)}
                  dim={dim}
                  accent={accent}
                  editing={editingId === t.entry.id}
                  editDraft={editingId === t.entry.id ? editDraft : null}
                  onEditDraft={setEditDraft}
                  onStartEdit={() => startEditTask(t)}
                  onSaveEdit={() => saveTaskEdit(t)}
                  onCancelEdit={() => { setEditingId(null); setEditDraft(null); }}
                  onDelete={() => deleteTask(t)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Completed (mastered) bucket */}
      {completedCount > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="w-full rounded-2xl border border-border bg-panel/70 px-4 py-3 text-left transition-colors hover:border-l/40"
            aria-expanded={showCompleted}
            aria-controls="completed-section"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <CheckCircle2 size={15} color="var(--color-success)" className="shrink-0" />
                <span className="font-display text-sm font-bold">Completed (Mastered)</span>
                <span className="text-[11px] text-muted">{completedCount} task{completedCount === 1 ? '' : 's'}</span>
              </div>
              <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${showCompleted ? 'rotate-180' : ''}`} />
            </div>
          </button>
          {showCompleted && (
            <div id="completed-section" className="mt-2.5 space-y-2.5">
              {completedTasks.map((entry) => (
                <CompletedRow
                  key={entry.id}
                  entry={entry}
                  journeyDayLimit={journeyDayLimit}
                  onMoveToDay={(day) => moveToDay(entry.id, day)}
                  onMoveBack={() => moveBackToCompleted(entry.id)}
                  flash={flash}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Custom To-Dos */}
      <CustomTodoSection
        todos={todos}
        onToggle={handleToggleCustomTodo}
        onDelete={handleDeleteCustomTodo}
        onEdit={handleEditCustomTodo}
        onAdd={handleAddCustomTodo}
        onReorder={handleReorderCustomTodo}
        flash={flash}
        isStandalone={false}
      />

      {/* Floating add button */}
      <button
        type="button"
        onClick={() => setShowAdd((v) => !v)}
        className="fixed z-30 flex items-center gap-1.5 rounded-full border border-l/30 bg-panel-raised px-4 py-3 font-display text-sm font-bold text-l shadow-fab transition-transform active:scale-95"
        style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))', right: 'max(1rem, env(safe-area-inset-right, 0px))' }}
        aria-label={showAdd ? 'Close add task' : 'Add task'}
      >
        {showAdd ? <X size={17} /> : <Plus size={17} />}
        {showAdd ? 'Cancel' : 'Add'}
      </button>

      {showAdminLogin && <AdminLogin onLogin={onUnlockAdmin} onClose={() => setShowAdminLogin(false)} />}
    </div>
  );
}

function StreakPill({ streak }: { streak: number }) {
  const active = streak > 0;
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors"
      style={{
        borderColor: active ? 'rgba(239,233,223,0.45)' : 'var(--color-border)',
        backgroundColor: active ? 'rgba(239,233,223,0.08)' : 'var(--color-panel)',
      }}
    >
      <Flame
        size={13}
        style={{ color: active ? 'var(--color-light)' : 'var(--color-muted-dim)', fill: active ? 'var(--color-l)' : 'none' }}
        aria-hidden="true"
      />
      <span className="font-mono text-sm font-bold" style={{ color: active ? 'var(--color-light)' : 'var(--color-muted)' }}>
        {streak}
      </span>
    </div>
  );
}

function StatTile({ icon, value, label, warn }: { icon: React.ReactNode; value: string | number; label: string; warn?: boolean }) {
  return (
    <div className="stat-strip-item">
      <span className="opacity-90">{icon}</span>
      <span className="font-display text-lg font-bold leading-none" style={{ color: warn ? 'var(--color-danger)' : 'var(--color-text)' }}>
        {value}
      </span>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-l)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
      <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9L12 3z" />
    </svg>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function group(plan: DailyPlan, g: PlannedTask['group']): PlannedTask[] {
  return plan.tasks.filter((t) => t.group === g);
}

function groupLabel(g: PlannedTask['group']): string {
  switch (g) {
    case 'morning':
      return 'Morning Rituals';
    case 'blocks':
      return 'Study Blocks';
    case 'night':
      return 'Night Review';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'exam':
      return 'Exam Month Checklist';
    case 'bonus':
      return 'Bonus (optional)';
    case 'mock':
      return 'Sunday Mock Protocol';
  }
}

function groupIcon(g: PlannedTask['group']) {
  const size = 14;
  const accent = groupAccent(g);
  switch (g) {
    case 'morning':
      return <Sunrise size={size} color={accent} />;
    case 'night':
      return <Sunset size={size} color={accent} />;
    case 'exam':
    case 'mock':
      return <Siren size={size} color={accent} />;
    default:
      return <Timer size={size} color={accent} />;
  }
}

function groupAccent(g: PlannedTask['group']): string {
  switch (g) {
    case 'morning':
    case 'blocks':
      return 'var(--color-l)';
    case 'night':
    case 'exam':
      return 'var(--color-light)';
    case 'weekly':
    case 'monthly':
      return 'var(--color-peak)';
    case 'bonus':
      return 'var(--color-muted)';
    case 'mock':
      return 'var(--color-danger)';
  }
}

function isDone(state: AppState, task: PlannedTask): boolean {
  const log = state.taskLogs[task.logKey] ?? {};
  return Boolean(log[task.entry.id]);
}

function togglePlanned(state: AppState, task: PlannedTask): AppState {
  const log = { ...(state.taskLogs[task.logKey] ?? {}) };
  log[task.entry.id] = !log[task.entry.id];
  return { ...state, taskLogs: { ...state.taskLogs, [task.logKey]: log } };
}

function planPct(plan: DailyPlan, state: AppState): number {
  if (plan.tasks.length === 0) return 0;
  const done = plan.tasks.filter((t) => isDone(state, t)).length;
  return Math.round((done / plan.tasks.length) * 100);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const TaskRow = memo(function TaskRow({
  task,
  done,
  onToggle,
  dim,
  accent,
  editing,
  editDraft,
  onEditDraft,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  task: PlannedTask;
  done: boolean;
  onToggle: () => void;
  dim: boolean;
  accent: string;
  editing: boolean;
  editDraft: { title: string; durationMin: number; energyLevel?: EnergyLevel; taskType?: TaskType } | null;
  onEditDraft: (draft: { title: string; durationMin: number; energyLevel?: EnergyLevel; taskType?: TaskType }) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const firedRef = useRef(false);
  const closeMenu = useCallback(() => {
    setMenuPos(null);
    firedRef.current = false;
  }, []);
  const { menuRef } = useMenuFocus(menuPos !== null, closeMenu);

  function openMenu(clientX: number, clientY: number) {
    haptic(20);
    setMenuPos({ x: clientX, y: clientY });
  }

  function clearHold() {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  if (editing && editDraft) {
    return (
      <div className="card p-3.5 text-sm fade-in space-y-2.5">
        <input
          className="field w-full text-sm font-semibold"
          aria-label="Task title"
          value={editDraft.title}
          onChange={(e) => onEditDraft({ ...editDraft, title: e.target.value })}
          placeholder="Task title"
          autoFocus
        />
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Duration (min)</label>
            <input
              className="field w-full"
              type="number"
              min={5}
              max={180}
              aria-label="Duration in minutes"
              value={editDraft.durationMin}
              onChange={(e) => onEditDraft({ ...editDraft, durationMin: Number(e.target.value) || 30 })}
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Energy</label>
            <select
              className="field w-full capitalize"
              aria-label="Energy level"
              value={editDraft.energyLevel || 'medium'}
              onChange={(e) => onEditDraft({ ...editDraft, energyLevel: e.target.value as EnergyLevel })}
            >
              {ENERGY_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted mb-1">Type</label>
            <select
              className="field w-full capitalize"
              aria-label="Task type"
              value={editDraft.taskType || 'Beginner'}
              onChange={(e) => onEditDraft({ ...editDraft, taskType: e.target.value as TaskType })}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button className="btn btn-primary flex-1 py-2 text-xs font-bold gap-1" onClick={onSaveEdit}>
            <Check size={14} /> Save Changes
          </button>
          <button className="btn btn-ghost px-3 py-2 text-xs" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card card-press relative flex items-center gap-3 p-3"
      style={{
        borderColor: done ? 'rgba(163,19,19,0.55)' : 'var(--color-border)',
        backgroundColor: done ? 'rgba(163,19,19,0.06)' : undefined,
        opacity: dim && !done ? 0.55 : 1,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // Menu already open or a long-press already fired on this gesture —
        // don't let the row re-trigger while the user is interacting with it.
        if (menuPos || firedRef.current) return;
        openMenu(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || menuPos) return;
        firedRef.current = false;
        holdTimer.current = window.setTimeout(() => {
          firedRef.current = true;
          openMenu(e.clientX, e.clientY);
        }, 450);
      }}
      onPointerUp={clearHold}
      onPointerMove={clearHold}
      onPointerLeave={clearHold}
    >
      <MoreButton label={`Open actions for ${task.entry.title}`} onOpen={(r) => openMenu(r.right, r.bottom)} />
      <span
        className="h-10 w-1 shrink-0 rounded-[1px] transition-colors"
        style={{ backgroundColor: done ? 'var(--color-success)' : accent, opacity: done ? 0.45 : 0.5 }}
      />
      <input
        type="checkbox"
        className="task-check shrink-0"
        checked={done}
        onChange={onToggle}
        aria-label={`Mark ${task.entry.title} ${done ? 'incomplete' : 'complete'}`}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium leading-snug ${done ? 'strike text-muted' : 'text-text'}`}>{task.entry.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <Timer size={11} /> {task.entry.estimatedDurationMin} min
          <span className="h-1 w-1 rounded-full bg-muted-dim" />
          {task.entry.energyLevel}
          {task.entry.taskType && (
            <>
              <span className="h-1 w-1 rounded-full bg-muted-dim" />
              {task.entry.taskType}
            </>
          )}
        </p>
      </div>
      {/* Edit / Delete are reached via long-press (or right-click) — see the
          ctx-menu below — so the row stays clean instead of showing
          always-on icon buttons. Portal to <body> so the menu is outside the
          row's DOM: the row's :active transform and pointer handlers can't
          shift/cancel the tap that lands on these buttons. */}
      {menuPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[59]" onClick={closeMenu} aria-hidden="true" />
            <div ref={menuRef} role="menu" className="ctx-menu" style={{ left: menuPos.x, top: menuPos.y }}>
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  haptic();
                  onStartEdit();
                  closeMenu();
                }}
              >
                <Pencil size={15} />
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                className="ctx-item danger"
                onClick={() => {
                  haptic();
                  onDelete();
                  closeMenu();
                }}
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
});

const CompletedRow = memo(function CompletedRow({
  entry,
  journeyDayLimit,
  onMoveToDay,
  onMoveBack,
  flash,
}: {
  entry: TaskBankEntry;
  journeyDayLimit: number;
  onMoveToDay: (day: number) => void;
  onMoveBack: () => void;
  flash: (msg: string) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [day, setDay] = useState('');

  function submit() {
    const n = Number(day);
    if (!Number.isFinite(n) || n < 1 || n > journeyDayLimit) {
      flash(`Day 1 se ${journeyDayLimit} ke beech ek number do.`);
      return;
    }
    onMoveToDay(n);
    setMoving(false);
    setDay('');
  }

  return (
    <div className="card relative flex items-center gap-3 p-3">
      <span className="h-10 w-1 shrink-0 rounded-[1px]" style={{ backgroundColor: 'var(--color-success)', opacity: 0.4 }} />
      <CheckCircle2 size={17} color="var(--color-success)" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-muted strike">{entry.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <Timer size={11} /> {entry.estimatedDurationMin} min
          <span className="h-1 w-1 rounded-full bg-muted-dim" />
          Mastered
        </p>
      </div>
      {moving ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            className="field w-16 py-1 text-center text-sm"
            type="number"
            min={1}
            max={journeyDayLimit}
            aria-label="Move task to day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            autoFocus
          />
          <button type="button" className="btn btn-primary px-2.5 py-1.5 text-xs font-bold" onClick={submit}>
            Move
          </button>
          <button type="button" className="icon-btn" aria-label="Cancel move" onClick={() => { setMoving(false); setDay(''); }}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-l/40 hover:text-text"
          onClick={() => setMoving(true)}
        >
          <RotateCcw size={12} />
          Move to Day
        </button>
      )}
      <button
        type="button"
        className="icon-btn shrink-0"
        aria-label={`Move ${entry.title} back to completed`}
        title="Move back to Completed"
        onClick={onMoveBack}
      >
        <CheckCircle2 size={15} color="var(--color-success)" />
      </button>
    </div>
  );
});

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function StartScreen({ onStart, onNavigate }: { onStart: () => void; onNavigate?: (tab: 'task-bank' | 'progress' | 'chat') => void }) {
  const features = [
    { icon: <Target size={17} color="var(--color-l)" />, label: 'Task Bank', tab: 'task-bank' as const, tint: 'rgba(163,19,19,0.14)' },
    { icon: <Flame size={17} color="var(--color-light)" />, label: 'Streaks', tab: 'progress' as const, tint: 'rgba(239,233,223,0.14)' },
    { icon: <Zap size={17} color="var(--color-peak)" />, label: 'Misa AI', tab: 'chat' as const, tint: 'rgba(239,233,223,0.14)' },
  ];

  return (
    <div className="screen screen-start relative flex flex-col items-center justify-start overflow-hidden text-center">
      {/* Ambient backdrop glow — quiet, not a gimmick */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full opacity-60"
        style={{ background: 'radial-gradient(circle, rgba(239,233,223,0.14), rgba(163,19,19,0.06) 45%, transparent 72%)' }}
      />

      <div className="fade-up relative w-full max-w-xs">
        <div className="gradient-border mx-auto mb-6 w-fit rounded-full p-px" style={{ boxShadow: '0 0 32px -6px rgba(239,233,223,0.35)' }}>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-panel">
            <Flame size={26} color="var(--color-light)" />
          </div>
        </div>
        <p className="eyebrow">LEVELUP · JEE PROTOCOL</p>
        <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight">
          L × Light × <span className="text-light">JEE</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted">
          90 din. 30 levels. 130+ habits — har din clear plan, streak aur AI coach ke saath.
        </p>

        <div className="mt-7 grid w-full grid-cols-3 gap-1.5">
          {features.map((f) => (
            <button
              key={f.label}
              type="button"
              disabled={!onNavigate}
              onClick={() => {
                haptic();
                onNavigate?.(f.tab);
              }}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-panel/70 px-2 py-3 text-center transition-all hover:border-l/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: f.tint }}
              >
                {f.icon}
              </span>
              <span className="text-[11px] font-medium text-muted">{f.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onStart}
          className="btn btn-primary mt-8 w-full gap-2 px-8 font-display text-base font-bold"
          style={{ boxShadow: '0 16px 36px -16px rgba(163,19,19,0.55)' }}
        >
          <Flame size={17} />
          Mission Start — Day 1
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-dim">
          Abhi shuru karo — data bilkul local hai, koi signup nahi.
        </p>
      </div>
    </div>
  );
}

function scheduledDays(entry: { unlockConditions: TaskBankEntry['unlockConditions'] }): number[] {
  return entry.unlockConditions.flatMap((condition) => {
    if (condition.type === 'day') return [condition.fromDay];
    if (condition.type === 'day-exact') return [condition.day];
    if (condition.type === 'day-in') return condition.days;
    return [];
  });
}

function normalizeTaskTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasDuplicateTask(entries: TaskBankEntry[], title: string, day: number, ignoreId?: string): boolean {
  const normalized = normalizeTaskTitle(title);
  return entries.some((entry) =>
    entry.active &&
    entry.id !== ignoreId &&
    normalizeTaskTitle(entry.title) === normalized &&
    scheduledDays(entry).includes(day),
  );
}

function upsertUniqueTask(entries: TaskBankEntry[], entry: TaskBankEntry): TaskBankEntry[] {
  const days = scheduledDays(entry);
  const normalized = normalizeTaskTitle(entry.title);
  const withoutDuplicates = entries.filter((existing) =>
    existing.id === entry.id ||
    !existing.active ||
    normalizeTaskTitle(existing.title) !== normalized ||
    !scheduledDays(existing).some((day) => days.includes(day)),
  );
  return [...withoutDuplicates.filter((existing) => existing.id !== entry.id), entry];
}

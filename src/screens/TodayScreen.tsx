import { memo, useEffect, useRef, useState } from 'react';
import { Calendar, Check, Flame, Pencil, Plus, ShieldAlert, ShieldCheck, Siren, Sunrise, Sunset, Target, Timer, Trash2, X, Zap } from 'lucide-react';
import type { AppState } from '../types';
import type { EnergyLevel, TaskType } from '../core/domain/task-bank';
import { PHASES, TOTAL_DAYS } from '../data/curriculum';
import { DEFAULT_PROGRESSION_CONFIG, type DailyPlan, type PlannedTask } from '../core/domain/progress';
import { TASK_TYPES } from '../core/domain/task-bank';
import { getCurrentDayNumber, getLevelForDay, isExamMonthActive, daysUntilExam } from '../lib/engine';
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
import { haptic } from '../lib/haptics';

const ENERGY_LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];
const EMPTY_FORM = { title: '', durationMin: 30, energyLevel: 'medium' as EnergyLevel, taskType: 'Beginner' as TaskType };

export default function TodayScreen({
  state,
  today,
  update,
  adminUnlocked,
  onUnlockAdmin,
  onLockAdmin,
  onSetAdminDay,
}: {
  state: AppState;
  today: string;
  update: (fn: (s: AppState) => AppState) => void;
  adminUnlocked: boolean;
  onUnlockAdmin: (username: string, password: string) => boolean;
  onLockAdmin: () => void;
  onSetAdminDay: (day: number | null) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; durationMin: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [confettiKey, setConfettiKey] = useState(0);
  const celebratedRef = useRef(false);

  const dayNumber = getCurrentDayNumber(state, today);
  const level = getLevelForDay(dayNumber);
  const phase = PHASES.find((p) => p.id === level?.phase);

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
  const recovery = context?.recoveryMode ?? false;
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

  if (!state.startDateISO) {
    return <StartScreen onStart={() => update((s) => ({ ...s, startDateISO: today }))} />;
  }

  const activePlan: DailyPlan = plan!;
  const activeContext = context!;

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 2500);
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
    update((s) => ({ ...s, dynamicTaskBank: [...s.dynamicTaskBank, entry] }));
    setForm(EMPTY_FORM);
    setShowAdd(false);
    flash('Task aaj ke plan mein add ho gaya.');
  }

  function startEditTask(task: PlannedTask) {
    setEditingId(task.entry.id);
    setEditDraft({ title: task.entry.title, durationMin: task.entry.estimatedDurationMin });
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

  const groups = ['exam', 'morning', 'blocks', 'night', 'weekly', 'monthly', 'bonus', 'mock'] as const;

  return (
    <div className="screen fade-up">
      <Confetti trigger={confettiKey} />

      <ScreenHeader
        eyebrow={`DAY ${dayNumber} / ${TOTAL_DAYS}`}
        title={greeting()}
        subtitle={`${dateLabel} · ${level?.title ?? ''}`}
        right={
          <div className="flex items-center gap-2">
            <StreakPill streak={streak} />
            <button
              type="button"
              aria-label={adminUnlocked ? 'Admin panel khula hai (lock karo)' : 'Admin login'}
              className="icon-btn"
              style={adminUnlocked ? { color: 'var(--color-peak)' } : undefined}
              onClick={() => (adminUnlocked ? onLockAdmin() : setShowAdminLogin(true))}
            >
              <ShieldCheck size={16} />
            </button>
          </div>
        }
      />

      {adminUnlocked && (
        <DaySwitcher
          dayNumber={dayNumber}
          totalDays={TOTAL_DAYS}
          dateLabel={dateLabel}
          onJump={(n) => onSetAdminDay(n)}
          onToday={() => onSetAdminDay(null)}
          onLock={onLockAdmin}
        />
      )}

      {/* Hero */}
      <div className="gradient-border mb-4 rounded-[1.25rem] p-px">
        <div className="rounded-[calc(1.25rem-1px)] bg-panel/90 px-4 pb-4 pt-5">
          <div className="flex items-center justify-center">
            <DayGauge
              dayNumber={dayNumber}
              totalDays={TOTAL_DAYS}
              todayPct={pct}
              levelCode={`LVL-${String(level?.id ?? 0).padStart(2, '0')}`}
            />
          </div>
          {level && (
            <div className="mt-3 text-center">
              <p className="eyebrow" style={{ color: accent }}>
                {phase?.title}
              </p>
              <h2 className="mt-1 font-display text-lg font-bold tracking-tight">{level.title}</h2>
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
      <div className="mb-4 grid grid-cols-3 gap-2.5">
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
          <p>Is level ka detailed content agle update mein add hoga. Tab tak pichle levels ke habits continue rakho — wahi list neeche dikh rahi hai.</p>
        </div>
      )}

      {recovery && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 p-3.5 fade-in">
          <ShieldAlert size={18} color="var(--color-danger)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-danger">Recovery Mode</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Kal ka completion bahut kam tha. Aaj sirf current level ke core tasks required hain — baaki bonus mein optional hain. Momentum wapas banao.
            </p>
          </div>
        </div>
      )}

      {activeContext.restDay && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-light-dim/50 bg-[rgba(245,179,103,0.08)] p-3.5 fade-in">
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
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-light-dim/50 bg-[rgba(245,179,103,0.08)] p-3.5 fade-in">
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

      {/* Floating add button */}
      <button
        type="button"
        onClick={() => setShowAdd((v) => !v)}
        className="fixed z-30 flex items-center gap-1.5 rounded-full border border-l/30 bg-panel-raised px-4 py-3 font-display text-sm font-bold text-l shadow-fab transition-transform active:scale-95"
        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))', right: 'max(1.25rem, calc(50vw - 13.75rem + 1.25rem))' }}
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
        borderColor: active ? 'rgba(245,179,103,0.45)' : 'var(--color-border)',
        backgroundColor: active ? 'rgba(245,179,103,0.08)' : 'var(--color-panel)',
      }}
    >
      <Flame size={15} color={active ? 'var(--color-light)' : 'var(--color-muted-dim)'} className={active ? 'pulse-dot' : ''} />
      <span className="font-mono text-sm font-bold" style={{ color: active ? 'var(--color-light)' : 'var(--color-muted)' }}>
        {streak}
      </span>
    </div>
  );
}

function StatTile({ icon, value, label, warn }: { icon: React.ReactNode; value: string | number; label: string; warn?: boolean }) {
  return (
    <div className="card flex flex-col items-center gap-1 px-2 py-3.5 text-center">
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
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
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
  editDraft: { title: string; durationMin: number } | null;
  onEditDraft: (draft: { title: string; durationMin: number }) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  if (editing && editDraft) {
    return (
      <div className="card p-3.5 text-sm fade-in">
        <div className="space-y-2.5">
          <input className="field" aria-label="Task title" value={editDraft.title} onChange={(e) => onEditDraft({ ...editDraft, title: e.target.value })} />
          <input
            className="field"
            type="number"
            min={5}
            max={180}
            aria-label="Duration in minutes"
            value={editDraft.durationMin}
            onChange={(e) => onEditDraft({ ...editDraft, durationMin: Number(e.target.value) || 30 })}
          />
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1 py-2 text-sm font-bold" onClick={onSaveEdit}>
              <Check size={15} /> Save
            </button>
            <button className="btn btn-ghost px-4" onClick={onCancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card card-press flex items-center gap-3 p-3"
      style={{
        borderColor: done ? 'rgba(52,211,153,0.5)' : 'var(--color-border)',
        backgroundColor: done ? 'rgba(52,211,153,0.06)' : undefined,
        opacity: dim && !done ? 0.55 : 1,
      }}
    >
      <span
        className="h-10 w-1 shrink-0 rounded-full transition-colors"
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
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" className="icon-btn" onClick={onStartEdit} aria-label="Edit task">
          <Pencil size={15} />
        </button>
        <button type="button" className="icon-btn text-red-400/70 hover:bg-danger/10 hover:text-danger" onClick={onDelete} aria-label="Delete task">
          <Trash2 size={15} />
        </button>
      </div>
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

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen flex min-h-screen flex-col items-center justify-center text-center">
      <div className="fade-up">
        <div className="gradient-border mb-6 rounded-full p-px">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-panel">
            <Flame size={26} color="var(--color-light)" />
          </div>
        </div>
        <p className="eyebrow">HUMAN OS · JEE PROTOCOL</p>
        <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight">
          L × Light × <span className="text-light">JEE</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-muted">
          90 din. 30 levels. 130+ habits ek-ek karke build honge — har din ek clear plan, streak aur AI coach ke saath.
        </p>

        <div className="mt-7 grid w-full max-w-xs grid-cols-3 gap-2.5">
          {[
            { icon: <Target size={16} color="var(--color-l)" />, label: 'Task Bank' },
            { icon: <Flame size={16} color="var(--color-light)" />, label: 'Streaks' },
            { icon: <Zap size={16} color="var(--color-peak)" />, label: 'AI Coach' },
          ].map((f) => (
            <div key={f.label} className="card flex flex-col items-center gap-1.5 px-2 py-3.5">
              {f.icon}
              <span className="text-[11px] text-muted">{f.label}</span>
            </div>
          ))}
        </div>

        <button onClick={onStart} className="btn btn-primary mt-8 px-8 font-display text-base font-bold">
          Mission Start — Day 1
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-dim">
          Abhi shuru karo — data bilkul local hai, koi signup nahi.
        </p>
      </div>
    </div>
  );
}

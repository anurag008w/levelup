import { useState } from 'react';
import { Calendar, Check, Flame, Pencil, Plus, ShieldAlert, Siren, Sunrise, Sunset, Target, Timer, Trash2, X, Zap } from 'lucide-react';
import type { AppState } from '../types';
import type { EnergyLevel, TaskType } from '../core/domain/task-bank';
import { PHASES, TOTAL_DAYS } from '../data/curriculum';
import { DEFAULT_PROGRESSION_CONFIG, type DailyPlan, type PlannedTask } from '../core/domain/progress';
import { TASK_TYPES } from '../core/domain/task-bank';
import { getCurrentDayNumber, getLevelForDay, isExamMonthActive, daysUntilExam } from '../lib/engine';
import { container } from '../di/container';
import DayGauge from '../components/DayGauge';
import AICoach from '../components/AICoach';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import { phaseAccent } from '../lib/phaseColors';
import { parseTaskBankEntry } from '../features/task-bank/validation';

const ENERGY_LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];
const EMPTY_FORM = { title: '', durationMin: 30, energyLevel: 'medium' as EnergyLevel, taskType: 'Beginner' as TaskType };

export default function TodayScreen({
  state,
  today,
  update,
}: {
  state: AppState;
  today: string;
  update: (fn: (s: AppState) => AppState) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; durationMin: number } | null>(null);
  const [notice, setNotice] = useState('');

  if (!state.startDateISO) {
    return <StartScreen onStart={() => update((s) => ({ ...s, startDateISO: today }))} />;
  }

  const dayNumber = getCurrentDayNumber(state, today);
  const level = getLevelForDay(dayNumber);
  const phase = PHASES.find((p) => p.id === level?.phase);

  const config = {
    ...DEFAULT_PROGRESSION_CONFIG,
    availableMinutes: state.studyTimeMinutes > 0 ? state.studyTimeMinutes : DEFAULT_PROGRESSION_CONFIG.availableMinutes,
    aiEnabled: container.providerSettings.isAiEnabled(),
  };
  const context = container.planner.buildContext(state, today, config);
  const plan: DailyPlan = container.planner.buildPlan(state, today, config);

  const pct = planPct(plan, state);
  const doneCount = plan.tasks.filter((t) => isDone(state, t)).length;
  const totalCount = plan.tasks.length;
  const recovery = context.recoveryMode;
  const examMode = isExamMonthActive(state, today);
  const examLeft = daysUntilExam(state, today);
  const streak = context.streak;
  const accent = phaseAccent(phase?.color ?? 'core');
  const dateLabel = formatDate(today);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 2500);
  }

  function onToggleTask(task: PlannedTask) {
    update((s) => togglePlanned(s, task));
  }

  function addTodayTask() {
    if (!form.title.trim()) {
      flash('Title bharo.');
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
      unlockConditions: [{ type: 'day', fromDay: dayNumber }],
      active: true,
    });
    update((s) => ({ ...s, dynamicTaskBank: [...s.dynamicTaskBank, entry] }));
    setForm(EMPTY_FORM);
    setShowAdd(false);
    flash('Aaj ka task add ho gaya.');
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
    if (!window.confirm('Ye task aaj ke plan/task bank se delete ho jayega. Confirm?')) return;
    update((s) => {
      if (task.entry.legacy) {
        return {
          ...s,
          dynamicTaskBank: [...s.dynamicTaskBank.filter((e) => e.id !== task.entry.id), { ...task.entry, active: false }],
        };
      }
      return { ...s, dynamicTaskBank: s.dynamicTaskBank.filter((e) => e.id !== task.entry.id) };
    });
    flash('Task delete ho gaya.');
  }

  const groups = ['exam', 'morning', 'blocks', 'night', 'weekly', 'monthly', 'bonus', 'mock'] as const;

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="HUMAN OS"
        title="Mission Dashboard"
        subtitle={dateLabel}
        right={
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-1.5">
            <Flame size={14} color="var(--color-light)" className={streak > 0 ? 'pulse-dot' : ''} />
            <span className="font-mono text-xs font-semibold">{streak}</span>
          </div>
        }
      />

      {/* Hero */}
      <div className="gradient-border mb-4 rounded-2xl p-1">
        <div className="rounded-[14px] bg-panel/80 px-4 pb-4 pt-5">
          <div className="flex items-center justify-center">
            <DayGauge dayNumber={dayNumber} totalDays={TOTAL_DAYS} todayPct={pct} levelCode={`LVL-${String(level?.id ?? 0).padStart(2, '0')}`} />
          </div>
          {level && (
            <div className="mt-3 text-center">
              <p className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: accent }}>
                {phase?.title}
              </p>
              <h2 className="mt-0.5 font-display text-base font-bold">{level.title}</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                Days {level.dayStart}–{level.dayEnd}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard
          icon={<Target size={14} color="var(--color-l)" />}
          value={`${doneCount}/${totalCount}`}
          label="Tasks done"
        />
        <StatCard
          icon={<Zap size={14} color="var(--color-light)" />}
          value={context.availableMinutes}
          label="Min today"
        />
        <StatCard
          icon={<Calendar size={14} color="var(--color-peak)" />}
          value={`${context.gapDays}`}
          label="Gap days"
          warn={context.gapDays >= 2}
        />
      </div>

      <AICoach
        today={today}
        dayNumber={dayNumber}
        levelTitle={level?.title ?? 'Unknown'}
        pct={pct}
        streak={streak}
        recovery={recovery}
        examLeft={examMode ? examLeft : null}
        done={doneCount}
        total={totalCount}
      />

      {notice && <div className="mb-3 rounded-xl border border-border bg-panel px-3 py-2 text-xs text-light">{notice}</div>}

      <div className="mb-4 rounded-2xl border border-border bg-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-sm font-bold">Aaj ke tasks manage karo</p>
            <p className="text-[11px] text-muted">Today tab se direct add, edit, delete — AI bhi same bank use karega.</p>
          </div>
          <button className="btn btn-primary px-3 py-2 text-xs font-bold" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? <X size={14} /> : <Plus size={14} />}
            {showAdd ? 'Cancel' : 'Add'}
          </button>
        </div>
        {showAdd && (
          <div className="mt-3 space-y-2 text-xs">
            <input className="field" placeholder="Aaj ka task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <input className="field" type="number" min={5} max={180} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) || 30 })} />
              <select className="field" value={form.energyLevel} onChange={(e) => setForm({ ...form, energyLevel: e.target.value as EnergyLevel })}>
                {ENERGY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className="field" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button className="btn btn-primary w-full py-2 text-xs font-bold" onClick={addTodayTask}>Add to today's plan</button>
          </div>
        )}
      </div>


      {!level?.authored && (
        <div className="card mb-4 p-4 text-sm text-muted">
          Is level ka detailed content agle update mein add hoga. Tab tak pichle levels ke habits continue rakho — wahi list neeche dikh rahi hai.
        </div>
      )}

      {recovery && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 p-3.5">
          <ShieldAlert size={18} color="var(--color-danger)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-danger">Recovery Mode</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Kal ka completion bahut kam tha. Aaj sirf current level ke CORE tasks required hain — baaki bonus mein optional hain. Momentum wapas banao.
            </p>
          </div>
        </div>
      )}

      {examMode && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-light-dim/50 bg-[rgba(242,166,90,0.08)] p-3.5">
          <Siren size={18} color="var(--color-light)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-light">Exam Month — {examLeft} din baaki</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">Naya topic nahi. Sirf revision, mocks aur recovery. Checklist neeche hai.</p>
          </div>
        </div>
      )}

      {groups.map((g) => {
        const tasks = group(plan, g);
        if (tasks.length === 0) return null;
        const done = tasks.filter((t) => isDone(state, t)).length;
        const accent = groupAccent(g);
        const dim = g === 'bonus';
        return (
          <div key={g} className="mb-4">
            <SectionHeader
              icon={groupIcon(g)}
              accent={accent}
              title={groupLabel(g, tasks.length)}
              meta={`${done}/${tasks.length}`}
            />
            <div className="space-y-2">
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

      {plan.contextSummary && (
        <p className="mt-2 text-center font-mono text-[10px] text-muted">plan: {plan.contextSummary}</p>
      )}
    </div>
  );
}

function StatCard({ icon, value, label, warn }: { icon: React.ReactNode; value: string | number; label: string; warn?: boolean }) {
  return (
    <div className="card flex flex-col items-center gap-1 px-2 py-3 text-center">
      <span className="opacity-80">{icon}</span>
      <span className="font-display text-lg font-bold leading-none" style={{ color: warn ? 'var(--color-danger)' : 'var(--color-text)' }}>
        {value}
      </span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}

function group(plan: DailyPlan, g: PlannedTask['group']): PlannedTask[] {
  return plan.tasks.filter((t) => t.group === g);
}

function groupLabel(g: PlannedTask['group'], count: number): string {
  switch (g) {
    case 'morning':
      return 'Morning';
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
      return `Bonus (optional) · ${count}`;
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

function TaskRow({
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
      <div className="rounded-xl border border-border bg-panel p-3 text-xs">
        <div className="space-y-2">
          <input className="field" value={editDraft.title} onChange={(e) => onEditDraft({ ...editDraft, title: e.target.value })} />
          <input className="field" type="number" min={5} max={180} value={editDraft.durationMin} onChange={(e) => onEditDraft({ ...editDraft, durationMin: Number(e.target.value) || 30 })} />
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1 py-1.5 text-xs font-bold" onClick={onSaveEdit}><Check size={13} /> Save</button>
            <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={onCancelEdit}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all duration-200"
      style={{
        borderColor: done ? 'var(--color-success)' : 'var(--color-border)',
        backgroundColor: done ? 'rgba(124,217,146,0.07)' : 'var(--color-panel)',
        opacity: dim && !done ? 0.55 : 1,
      }}
    >
      <label className="flex flex-1 cursor-pointer items-center gap-3">
      <span
        className="h-5 w-1 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: done ? 'var(--color-success)' : accent, opacity: done ? 0.4 : 0.35 }}
      />
      <input type="checkbox" className="task-check mt-0.5" checked={done} onChange={onToggle} />
      <span className={`text-sm leading-snug ${done ? 'text-muted line-through' : ''}`}>{task.entry.title}</span>
      </label>
      <div className="ml-auto flex shrink-0 gap-1 opacity-80">
        <button type="button" className="btn btn-ghost px-2 py-1" onClick={onStartEdit} aria-label="Edit task"><Pencil size={13} /></button>
        <button type="button" className="btn btn-ghost px-2 py-1 text-red-400" onClick={onDelete} aria-label="Delete task"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">HUMAN OS · JEE PROTOCOL</p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight">
        L × Light × <span className="text-light">JEE</span>
      </h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
        90 din. 30 levels. 130+ habits ek-ek karke build honge — har din ek clear plan, streak aur AI coach ke saath.
      </p>

      <div className="mt-6 grid w-full max-w-xs grid-cols-3 gap-2">
        {[
          { icon: <Target size={15} color="var(--color-l)" />, label: 'Task Bank' },
          { icon: <Flame size={15} color="var(--color-light)" />, label: 'Streaks' },
          { icon: <Zap size={15} color="var(--color-peak)" />, label: 'AI Coach' },
        ].map((f) => (
          <div key={f.label} className="card flex flex-col items-center gap-1.5 px-2 py-3">
            {f.icon}
            <span className="text-[10px] text-muted">{f.label}</span>
          </div>
        ))}
      </div>

      <button onClick={onStart} className="btn btn-primary mt-8 px-8 py-3 font-display text-sm font-bold">
        Mission Start — Day 1
      </button>
      <p className="mt-3 max-w-[240px] text-[11px] leading-relaxed text-muted/70">
        Abhi shuru karo — data bilkul local hai, koi signup nahi.
      </p>
    </div>
  );
}

import { Flame, ShieldAlert, Siren, Sunrise, Sunset, Timer } from 'lucide-react';
import type { AppState } from '../types';
import { PHASES } from '../data/curriculum';
import { EXAM_MONTH_PROTOCOL, MOCK_TEST_PROTOCOL } from '../data/protocols';
import {
  completionPct,
  getCumulativeTasks,
  getDayLog,
  getLevelForDay,
  isExamMonthActive,
  isRecoveryModeActive,
  splitRecoveryTasks,
  tasksBySlot,
  toggleTask,
  computeOverallStreak,
  daysUntilExam,
} from '../lib/engine';
import DayGauge from '../components/DayGauge';
import { phaseAccent } from '../lib/phaseColors';

export default function TodayScreen({
  state,
  today,
  update,
}: {
  state: AppState;
  today: string;
  update: (fn: (s: AppState) => AppState) => void;
}) {
  if (!state.startDateISO) {
    return <StartScreen onStart={() => update((s) => ({ ...s, startDateISO: today }))} />;
  }

  const dayNumber = Math.min(
    Math.max(Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(state.startDateISO + 'T00:00:00').getTime()) / 86400000) + 1, 1),
    90
  );
  const level = getLevelForDay(dayNumber);
  const phase = PHASES.find((p) => p.id === level?.phase);
  const allTasks = getCumulativeTasks(dayNumber);
  const log = getDayLog(state, today);
  const pct = completionPct(allTasks, log);
  const recovery = isRecoveryModeActive(state, today);
  const examMode = isExamMonthActive(state, today);
  const examLeft = daysUntilExam(state, today);
  const streak = computeOverallStreak(state, today);

  const { core, bonus } = recovery ? splitRecoveryTasks(allTasks, level) : { core: allTasks, bonus: [] };

  function onToggle(taskId: string) {
    update((s) => toggleTask(s, today, taskId));
  }
  function onToggleProtocol(prefix: string, id: string) {
    update((s) => toggleTask(s, `${prefix}:${today}`, id));
  }

  const weekKey = `mock:${today}`;
  const mockLog = getDayLog(state, weekKey);
  const examKey = `exam:${today}`;
  const examLog = getDayLog(state, examKey);

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-widest text-muted">HUMAN OS</p>
          <h1 className="font-display text-lg font-bold leading-tight">L × Light × JEE</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-1.5">
          <Flame size={14} color="var(--color-light)" />
          <span className="font-mono text-xs">{streak}</span>
        </div>
      </header>

      <div className="mb-5 flex items-center justify-center rounded-2xl border border-border bg-panel py-5">
        <DayGauge dayNumber={dayNumber} totalDays={90} todayPct={pct} levelCode={`LVL-${String(level?.id ?? 0).padStart(2, '0')}`} />
      </div>

      {level && (
        <div className="mb-5 rounded-xl border border-border bg-panel p-4">
          <p className="font-mono text-[10px] tracking-widest" style={{ color: phaseAccent(phase?.color ?? 'core') }}>
            {phase?.title.toUpperCase()}
          </p>
          <h2 className="font-display text-base font-bold mt-0.5">{level.title}</h2>
          <p className="mt-1 text-xs text-muted">
            Days {level.dayStart}–{level.dayEnd} · Today {pct}% complete
          </p>
        </div>
      )}

      {!level?.authored && (
        <div className="mb-5 rounded-xl border border-border bg-panel-raised p-4 text-sm text-muted">
          Is level ka detailed content agle update mein add hoga. Tab tak pichle levels ke habits continue rakho — wahi list neeche dikh rahi hai.
        </div>
      )}

      {recovery && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3.5">
          <ShieldAlert size={18} color="var(--color-danger)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold" style={{ color: 'var(--color-danger)' }}>
              Recovery Mode
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Kal ka completion bahut kam tha. Aaj sirf current level ke CORE tasks required hain — baaki sab neeche "Bonus"
              mein optional hain. Momentum wapas banao, poori list baad mein.
            </p>
          </div>
        </div>
      )}

      {examMode && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border p-3.5" style={{ borderColor: 'var(--color-light-dim)', backgroundColor: 'rgba(242,166,90,0.08)' }}>
          <Siren size={18} color="var(--color-light)" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-light">Exam Month Protocol — {examLeft} din baaki</p>
            <p className="mt-0.5 text-xs text-muted">Naya topic nahi. Sirf revision, mocks aur recovery. Checklist neeche hai.</p>
          </div>
        </div>
      )}

      {examMode && (
        <TaskGroup title="Exam Month Checklist" icon={Siren} accent="var(--color-light)">
          {EXAM_MONTH_PROTOCOL.map((item) => (
            <TaskRow key={item.id} text={item.text} done={!!examLog[item.id]} onToggle={() => onToggleProtocol('exam', item.id)} />
          ))}
        </TaskGroup>
      )}

      <TaskGroup title="Morning" icon={Sunrise} accent="var(--color-l)">
        {tasksBySlot(core, 'morning').map((t) => (
          <TaskRow key={t.id} text={t.text} done={!!log[t.id]} onToggle={() => onToggle(t.id)} />
        ))}
      </TaskGroup>

      <TaskGroup title="Study Blocks" icon={Timer} accent="var(--color-l)">
        {tasksBySlot(core, 'blocks').map((t) => (
          <TaskRow key={t.id} text={t.text} done={!!log[t.id]} onToggle={() => onToggle(t.id)} />
        ))}
      </TaskGroup>

      <TaskGroup title="Night Review" icon={Sunset} accent="var(--color-light)">
        {tasksBySlot(core, 'night').map((t) => (
          <TaskRow key={t.id} text={t.text} done={!!log[t.id]} onToggle={() => onToggle(t.id)} />
        ))}
      </TaskGroup>

      {tasksBySlot(core, 'weekly').length > 0 && (
        <TaskGroup title="Weekly" icon={Timer} accent="var(--color-peak)">
          {tasksBySlot(core, 'weekly').map((t) => (
            <TaskRow key={t.id} text={t.text} done={!!log[t.id]} onToggle={() => onToggle(t.id)} />
          ))}
        </TaskGroup>
      )}

      {tasksBySlot(core, 'monthly').length > 0 && (
        <TaskGroup title="Monthly" icon={Timer} accent="var(--color-peak)">
          {tasksBySlot(core, 'monthly').map((t) => (
            <TaskRow key={t.id} text={t.text} done={!!log[t.id]} onToggle={() => onToggle(t.id)} />
          ))}
        </TaskGroup>
      )}

      {bonus.length > 0 && (
        <TaskGroup title={`Bonus (optional today) · ${bonus.length}`} icon={Timer} accent="var(--color-muted)">
          {bonus.map((t) => (
            <TaskRow key={t.id} text={t.text} done={!!log[t.id]} onToggle={() => onToggle(t.id)} dim />
          ))}
        </TaskGroup>
      )}

      {dayNumber % 7 === 0 && (
        <TaskGroup title="Sunday Mock Test Protocol" icon={Siren} accent="var(--color-danger)">
          {MOCK_TEST_PROTOCOL.map((item) => (
            <TaskRow key={item.id} text={item.text} done={!!mockLog[item.id]} onToggle={() => onToggleProtocol('mock', item.id)} />
          ))}
        </TaskGroup>
      )}
    </div>
  );
}

function TaskGroup({
  title,
  icon: Icon,
  accent,
  children,
}: {
  title: string;
  icon: typeof Sunrise;
  accent: string;
  children: React.ReactNode;
}) {
  const arr = Array.isArray(children) ? children : [children];
  if (arr.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={14} color={accent} />
        <p className="font-mono text-[11px] tracking-widest" style={{ color: accent }}>
          {title.toUpperCase()}
        </p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TaskRow({ text, done, onToggle, dim }: { text: string; done: boolean; onToggle: () => void; dim?: boolean }) {
  return (
    <label
      className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
      style={{
        borderColor: done ? 'var(--color-success)' : 'var(--color-border)',
        backgroundColor: done ? 'rgba(124,217,146,0.06)' : 'var(--color-panel)',
        opacity: dim && !done ? 0.55 : 1,
      }}
    >
      <input type="checkbox" className="task-check mt-0.5" checked={done} onChange={onToggle} />
      <span className={`text-sm leading-snug ${done ? 'text-muted line-through' : ''}`}>{text}</span>
    </label>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[11px] tracking-widest text-muted">HUMAN OS</p>
      <h1 className="mt-1 font-display text-2xl font-bold">L × Light × JEE</h1>
      <p className="mt-3 max-w-xs text-sm text-muted">
        90 din. 30 levels. 130+ habits, ek-ek karke build honge. Aaj se tumhara Day 1 shuru hota hai.
      </p>
      <button
        onClick={onStart}
        className="mt-8 rounded-full px-8 py-3 font-display text-sm font-bold text-bg"
        style={{ backgroundColor: 'var(--color-light)' }}
      >
        Mission Start — Day 1
      </button>
    </div>
  );
}

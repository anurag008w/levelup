import { Flame } from 'lucide-react';
import { LEVELS } from '../data/curriculum';
import type { AppState } from '../types';
import {
  computeHabitScore,
  computeHabitStreak,
  computeOverallStreak,
  getCumulativeHabits,
  getCurrentDayNumber,
  getLevelStatus,
} from '../lib/engine';

export default function ProgressScreen({ state, today }: { state: AppState; today: string }) {
  if (!state.startDateISO) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-6 text-center text-muted">
        <p className="mt-16 text-sm">Mission shuru karo Today tab se — progress yahin dikhega.</p>
      </div>
    );
  }

  const dayNumber = getCurrentDayNumber(state, today);
  const habits = getCumulativeHabits(dayNumber);
  const overallStreak = computeOverallStreak(state, today);
  const clearedCount = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'cleared').length;
  const recoveryCount = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'needs-recovery').length;

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="mb-5">
        <p className="font-mono text-[11px] tracking-widest text-muted">PROGRESS</p>
        <h1 className="font-display text-lg font-bold">Habit Scores & Streaks</h1>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <Stat label="Day Streak" value={String(overallStreak)} icon={<Flame size={14} color="var(--color-light)" />} />
        <Stat label="Levels Cleared" value={String(clearedCount)} />
        <Stat label="Needs Recovery" value={String(recoveryCount)} warn={recoveryCount > 0} />
      </div>

      <p className="mb-2 font-mono text-[11px] tracking-widest text-muted">HABIT SCORES (7-day)</p>
      <div className="space-y-2">
        {habits.map((h) => {
          const score = computeHabitScore(h.id, state, today);
          const streak = computeHabitStreak(h.id, state, today);
          return (
            <div key={h.id} className="rounded-xl border p-3.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{h.name}</p>
                <div className="flex items-center gap-2">
                  {streak > 0 && (
                    <span className="flex items-center gap-1 font-mono text-[11px] text-light">
                      <Flame size={11} /> {streak}
                    </span>
                  )}
                  <span className="font-mono text-xs" style={{ color: scoreColor(score) }}>
                    {score === null ? '—' : `${score}%`}
                  </span>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-grid)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${score ?? 0}%`, backgroundColor: scoreColor(score) }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, icon, warn }: { label: string; value: string; icon?: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-xl border p-3 text-center" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <div className="flex items-center justify-center gap-1">
        {icon}
        <span className="font-display text-lg font-bold" style={{ color: warn ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted">{label}</p>
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--color-muted)';
  if (score >= 80) return 'var(--color-success)';
  if (score >= 50) return 'var(--color-light)';
  return 'var(--color-danger)';
}

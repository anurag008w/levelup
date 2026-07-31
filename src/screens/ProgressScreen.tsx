import { Activity, Brain, Flame, Medal, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
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
import ScreenHeader from '../components/ui/ScreenHeader';
import Stat from '../components/ui/Stat';
import SectionHeader from '../components/ui/SectionHeader';
import ProgressBar from '../components/ui/ProgressBar';
import EmptyState from '../components/ui/EmptyState';

type Tier = 'strong' | 'building' | 'weak';

export default function ProgressScreen({ state, today }: { state: AppState; today: string }) {
  if (!state.startDateISO) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="PROGRESS" title="Habit Scores & Streaks" />
        <EmptyState
          icon={<Activity size={28} color="var(--color-muted)" />}
          title="Mission shuru nahi hua"
          hint="Today tab se Day 1 shuru karo — progress, streaks aur scores yahin dikhenge."
        />
      </div>
    );
  }

  const dayNumber = getCurrentDayNumber(state, today);
  const habits = getCumulativeHabits(dayNumber);
  const overallStreak = computeOverallStreak(state, today);
  const clearedCount = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'cleared').length;
  const recoveryCount = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'needs-recovery').length;
  const activeLevel = LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd);

  const withScores = habits
    .map((h) => ({ habit: h, score: computeHabitScore(h.id, state, today), streak: computeHabitStreak(h.id, state, today) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const tierOf = (score: number | null): Tier => {
    if (score === null) return 'building';
    if (score >= 70) return 'strong';
    if (score >= 40) return 'building';
    return 'weak';
  };

  const grouped: Record<Tier, typeof withScores> = { strong: [], building: [], weak: [] };
  for (const item of withScores) grouped[tierOf(item.score)].push(item);

  const latest = [...state.summaries].sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="PROGRESS"
        title="Habit Scores & Streaks"
        subtitle={activeLevel ? `Abhi: ${activeLevel.title}` : undefined}
        right={
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-1.5">
            <Flame size={14} color="var(--color-light)" />
            <span className="font-mono text-xs font-semibold">{overallStreak}</span>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="Day Streak" value={overallStreak} icon={<Flame size={14} color="var(--color-light)" />} accent="var(--color-light)" />
        <Stat label="Levels Cleared" value={clearedCount} icon={<Trophy size={14} color="var(--color-l)" />} accent="var(--color-l)" />
        <Stat
          label="Needs Recovery"
          value={recoveryCount}
          icon={<Medal size={14} color={recoveryCount > 0 ? 'var(--color-danger)' : 'var(--color-muted)'} />}
          accent={recoveryCount > 0 ? 'var(--color-danger)' : 'var(--color-text)'}
        />
      </div>

      {latest && (
        <div className="card mb-5 p-4">
          <SectionHeader
            icon={<Activity size={14} color="var(--color-l)" />}
            accent="var(--color-l)"
            title="Latest Day Snapshot"
            meta={latest.dateISO}
          />
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-border bg-bg p-2">
              <p className="font-display text-lg font-bold" style={{ color: 'var(--color-l)' }}>{latest.productivityScore}%</p>
              <p className="text-[10px] text-muted">Productivity</p>
            </div>
            <div className="rounded-lg border border-border bg-bg p-2">
              <p className="font-display text-lg font-bold" style={{ color: 'var(--color-peak)' }}>{latest.thinkingScore}%</p>
              <p className="text-[10px] text-muted">Thinking</p>
            </div>
          </div>
          {latest.aiObservations.length > 0 && (
            <p className="mt-3 border-l-2 pl-2.5 text-xs leading-relaxed text-muted" style={{ borderColor: 'var(--color-l-dim)' }}>
              {latest.aiObservations[0]}
            </p>
          )}
        </div>
      )}

      {habits.length === 0 && (
        <EmptyState icon={<Brain size={28} color="var(--color-muted)" />} title="Abhi koi habit unlock nahi hui" hint="Levels complete karte jaoge toh habits unlock hoti jayengi." />
      )}

      <TierSection title="Strong" accent="var(--color-success)" icon={<TrendingUp size={14} color="var(--color-success)" />} items={grouped.strong} />
      <TierSection title="Building" accent="var(--color-light)" icon={<TrendingDown size={14} color="var(--color-light)" />} items={grouped.building} />
      <TierSection title="Needs Work" accent="var(--color-danger)" icon={<TrendingDown size={14} color="var(--color-danger)" />} items={grouped.weak} />
    </div>
  );
}

function TierSection({ title, accent, icon, items }: { title: string; accent: string; icon: React.ReactNode; items: Array<{ habit: { id: string; name: string }; score: number | null; streak: number }> }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <SectionHeader icon={icon} accent={accent} title={title} meta={`${items.length}`} />
      <div className="space-y-2">
        {items.map(({ habit, score, streak }) => (
          <div key={habit.id} className="card p-3.5 transition-colors hover:border-grid">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{habit.name}</p>
              <div className="flex shrink-0 items-center gap-2">
                {streak > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-light">
                    <Flame size={11} /> {streak}
                  </span>
                )}
                <span className="font-mono text-xs font-semibold" style={{ color: scoreColor(score) }}>
                  {score === null ? '—' : `${score}%`}
                </span>
              </div>
            </div>
            <div className="mt-2">
              <ProgressBar value={score ?? 0} color={scoreColor(score)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--color-muted)';
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-light)';
  return 'var(--color-danger)';
}

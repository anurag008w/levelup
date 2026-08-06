import { useState } from 'react';
import { Activity, Brain, Flame, Medal, TrendingDown, TrendingUp, Trophy, Zap } from 'lucide-react';
import { LEVELS } from '../data/curriculum';
import type { AppState } from '../types';
import {
  computeHabitScore,
  computeHabitStreak,
  computeOverallStreak,
  getCurrentDayNumber,
  getLevelStatus,
} from '../lib/engine';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import Stat from '../components/ui/Stat';
import SectionHeader from '../components/ui/SectionHeader';
import ProgressBar from '../components/ui/ProgressBar';
import EmptyState from '../components/ui/EmptyState';

type Tier = 'strong' | 'building' | 'weak';

const XP_PER_TASK = 10;
const XP_PER_LEVEL = 250;

export default function ProgressScreen({ state, today }: { state: AppState; today: string }) {
  const [trendView, setTrendView] = useState<'weekly' | 'monthly'>('weekly');

  if (!state.startDateISO) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="PROGRESS" title="Progress" />
        <EmptyState
          icon={<Activity size={28} color="var(--color-muted)" />}
          title="Mission shuru nahi hua"
          hint="Today tab se Day 1 shuru karo — progress, streaks aur scores yahin dikhenge."
        />
      </div>
    );
  }

  const dayNumber = getCurrentDayNumber(state, today);
  // Merged (seed + custom) habits so user-created habits also score/streak here.
  const habits = container.habitBank.getAllHabits().filter((h) => h.dayStart <= dayNumber);
  const overallStreak = computeOverallStreak(state, today);
  const clearedCount = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'cleared').length;
  const recoveryCount = LEVELS.filter((l) => l.authored && getLevelStatus(l, state, dayNumber) === 'needs-recovery').length;
  const activeLevel = LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd);

  // ---- Derived metrics ----
  const dayInfos = buildDayInfos(state, state.startDateISO, today);
  const totalDone = dayInfos.reduce((acc, d) => acc + d.done, 0);
  const xp = totalDone * XP_PER_TASK;
  const xpLevel = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;
  const activeDays = dayInfos.filter((d) => d.done > 0).length;
  const consistency = dayInfos.length > 0 ? Math.round((activeDays / dayInfos.length) * 100) : 0;

  // ---- Habit tiers ----
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

  const best = withScores.find((i) => (i.score ?? -1) >= 0);
  const worst = [...withScores].reverse().find((i) => i.score !== null);

  const latest = [...state.summaries].sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];

  const achievements = [
    { ok: dayNumber >= 7, label: 'Week 1 done' },
    { ok: overallStreak >= 7, label: '7-day streak' },
    { ok: clearedCount >= 1, label: 'First level cleared' },
    { ok: consistency >= 70, label: '70%+ consistency' },
    { ok: xp >= 500, label: '500 XP' },
  ];

  const motivation =
    consistency >= 70
      ? 'Strong momentum — tumhare habits solid ho rahe hain.'
      : consistency >= 40
        ? 'Momentum build ho raha hai — chhote consistent steps kaam karte hain.'
        : 'Abhi jaldi hai — aaj ka ek chhota win bhi streak ko restart karta hai.';

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="PROGRESS"
        title="Progress"
        subtitle={activeLevel ? `Abhi: ${activeLevel.title}` : undefined}
        right={<StreakPill streak={overallStreak} />}
      />

      {/* XP + consistency hero */}
      <div className="gradient-border mb-4 rounded-2xl p-px" data-tone="gold">
        <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">TOTAL XP</p>
              <p className="mt-0.5 font-display text-3xl font-bold tracking-tight text-gold">{xp.toLocaleString('en-IN')}</p>
              <p className="mt-0.5 text-xs text-muted">
                Level {xpLevel} · {XP_PER_LEVEL - xpIntoLevel} XP to next
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">CONSISTENCY</p>
              <p className="mt-0.5 font-display text-3xl font-bold tracking-tight text-l">{consistency}%</p>
              <p className="mt-0.5 text-xs text-muted">
                {activeDays}/{dayInfos.length} active days
              </p>
            </div>
          </div>
          <div className="mt-3">
            <ProgressBar value={(xpIntoLevel / XP_PER_LEVEL) * 100} color="var(--color-gold)" height={8} />
          </div>
        </div>
      </div>

      <div className="stat-strip mb-4">
        <Stat label="Day Streak" value={overallStreak} icon={<Flame size={14} color="var(--color-light)" />} accent="var(--color-light)" />
        <Stat label="Levels Cleared" value={clearedCount} icon={<Trophy size={14} color="var(--color-l)" />} accent="var(--color-l)" />
        <Stat
          label="Needs Recovery"
          value={recoveryCount}
          icon={<Medal size={14} color={recoveryCount > 0 ? 'var(--color-danger)' : 'var(--color-muted)'} />}
          accent={recoveryCount > 0 ? 'var(--color-danger)' : 'var(--color-text)'}
        />
      </div>

      {/* Heatmap */}
      <div className="card mb-4 p-4">
        <SectionHeader icon={<Flame size={14} color="var(--color-light)" />} accent="var(--color-light)" title="Last 60 Days" meta={`${activeDays} active`} />
        <ActivityGrid dayInfos={dayInfos.slice(-60)} />
        <Legend />
      </div>

      {/* Weekly / Monthly chart */}
      <div className="card mb-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionHeader
            icon={trendView === 'weekly' ? <Activity size={14} color="var(--color-l)" /> : <Zap size={14} color="var(--color-peak)" />}
            accent={trendView === 'weekly' ? 'var(--color-l)' : 'var(--color-peak)'}
            title="Activity Trends"
            meta={trendView === 'weekly' ? 'last 8 weeks' : monthLabel(today)}
          />
          <div className="segment shrink-0" role="group" aria-label="Chart period">
            <button type="button" className="segment-btn" aria-pressed={trendView === 'weekly'} onClick={() => setTrendView('weekly')}>
              Weekly
            </button>
            <button type="button" className="segment-btn" aria-pressed={trendView === 'monthly'} onClick={() => setTrendView('monthly')}>
              Monthly
            </button>
          </div>
        </div>
        <div className="mt-3">
          {trendView === 'weekly' ? <WeeklyChart dayInfos={dayInfos} /> : <MonthlyChart dayInfos={dayInfos} today={today} />}
        </div>
      </div>

      {/* Insights */}
      <div className="card mb-5 p-4">
        <SectionHeader icon={<Brain size={14} color="var(--color-peak)" />} accent="var(--color-peak)" title="Insights" />
        <div className="space-y-2.5 text-sm">
          {best && (
            <p className="flex items-start gap-2 leading-relaxed text-muted">
              <TrendingUp size={15} color="var(--color-success)" className="mt-0.5 shrink-0" />
              <span>
                Strongest habit: <span className="font-semibold text-text">{best.habit.name}</span> ({best.score}%)
              </span>
            </p>
          )}
          {worst && (
            <p className="flex items-start gap-2 leading-relaxed text-muted">
              <TrendingDown size={15} color="var(--color-danger)" className="mt-0.5 shrink-0" />
              <span>
                Weakest habit: <span className="font-semibold text-text">{worst.habit.name}</span> ({worst.score}%) — ek chhota revision slot add karo.
              </span>
            </p>
          )}
          <p className="flex items-start gap-2 leading-relaxed text-muted">
            <Zap size={15} color="var(--color-light)" className="mt-0.5 shrink-0" />
            <span>{motivation}</span>
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {achievements.map((a) => (
            <span
              key={a.label}
              className="badge"
              style={{
                backgroundColor: a.ok ? 'rgba(163,19,19,0.14)' : 'var(--color-panel-raised)',
                color: a.ok ? 'var(--color-success)' : 'var(--color-muted-dim)',
                border: `1px solid ${a.ok ? 'rgba(163,19,19,0.35)' : 'var(--color-border)'}`,
              }}
            >
              {a.ok ? '✓' : '•'} {a.label}
            </span>
          ))}
        </div>

        {latest && (
          <>
            <div className="divider my-4" />
            <SectionHeader icon={<Activity size={14} color="var(--color-l)" />} accent="var(--color-l)" title="Latest Day Snapshot" meta={latest.dateISO} />
            <div className="mt-2 grid grid-cols-2 gap-2.5 text-center">
              <div className="rounded-xl border border-border bg-bg p-3">
                <p className="font-display text-xl font-bold" style={{ color: 'var(--color-l)' }}>{latest.productivityScore}%</p>
                <p className="text-[11px] text-muted">Productivity</p>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3">
                <p className="font-display text-xl font-bold" style={{ color: 'var(--color-peak)' }}>{latest.thinkingScore}%</p>
                <p className="text-[11px] text-muted">Thinking</p>
              </div>
            </div>
            {latest.aiObservations.length > 0 && (
              <p className="mt-3 border-l-2 pl-2.5 text-sm leading-relaxed text-muted" style={{ borderColor: 'var(--color-l-dim)' }}>
                {latest.aiObservations[0]}
              </p>
            )}
          </>
        )}
      </div>


      {habits.length === 0 && (
        <EmptyState icon={<Brain size={28} color="var(--color-muted)" />} title="Abhi koi habit unlock nahi hui" hint="Levels complete karte jaoge toh habits unlock hoti jayengi." />
      )}

      <TierSection title="Strong" accent="var(--color-success)" icon={<TrendingUp size={14} color="var(--color-success)" />} items={grouped.strong} />
      <TierSection title="Building" accent="var(--color-light)" icon={<Zap size={14} color="var(--color-light)" />} items={grouped.building} />
      <TierSection title="Needs Work" accent="var(--color-danger)" icon={<TrendingDown size={14} color="var(--color-danger)" />} items={grouped.weak} />
    </div>
  );
}

function StreakPill({ streak }: { streak: number }) {
  const active = streak > 0;
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5"
      style={{ borderColor: active ? 'rgba(239,233,223,0.45)' : 'var(--color-border)', backgroundColor: active ? 'rgba(239,233,223,0.08)' : 'var(--color-panel)' }}
    >
      <Flame size={15} color={active ? 'var(--color-light)' : 'var(--color-muted-dim)'} className={active ? 'pulse-dot' : ''} />
      <span className="font-mono text-sm font-bold" style={{ color: active ? 'var(--color-light)' : 'var(--color-muted)' }}>{streak}</span>
    </div>
  );
}

/* ---------------- data helpers ---------------- */

interface DayInfo {
  iso: string;
  offset: number;
  done: number;
}

function isoFor(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDayInfos(state: AppState, startISO: string, todayISO: string): DayInfo[] {
  const out: DayInfo[] = [];
  // Pure UTC iteration so `iso` keys match the planner's UTC taskLogs keys.
  const d = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${todayISO}T00:00:00Z`);
  let offset = 1;
  while (d.getTime() <= end.getTime()) {
    const iso = isoFor(d);
    const log = state.taskLogs[iso] ?? {};
    const done = Object.values(log).filter(Boolean).length;
    out.push({ iso, offset, done });
    d.setUTCDate(d.getUTCDate() + 1);
    offset += 1;
  }
  return out;
}

function intensity(done: number): number {
  if (done <= 0) return 0;
  if (done <= 2) return 1;
  if (done <= 5) return 2;
  return 3;
}

function cellColor(level: number): string {
  switch (level) {
    case 3:
      return 'var(--color-l)';
    case 2:
      return 'rgba(163,19,19,0.55)';
    case 1:
      return 'rgba(163,19,19,0.28)';
    default:
      return 'var(--color-grid)';
  }
}

/* ---------------- chart components ---------------- */

function ActivityGrid({ dayInfos }: { dayInfos: DayInfo[] }) {
  const cells = dayInfos.length > 0 ? dayInfos : [];
  return (
    <div>
      <div className="grid grid-cols-10 gap-1.5" role="img" aria-label="Daily activity for the last 60 days">
        {cells.map((d) => (
          <div
            key={d.iso}
            title={`${d.iso}: ${d.done} task${d.done === 1 ? '' : 's'} done`}
            className="h-6 rounded-md transition-transform hover:scale-110"
            style={{ backgroundColor: cellColor(intensity(d.done)) }}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-dim">{cells.length > 0 ? `${cells[0].iso} → ${cells[cells.length - 1].iso}` : ''}</p>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-dim">
      <span>Less</span>
      {[0, 1, 2, 3].map((l) => (
        <span key={l} className="h-3 w-3 rounded" style={{ backgroundColor: cellColor(l) }} />
      ))}
      <span>More</span>
    </div>
  );
}

function WeeklyChart({ dayInfos }: { dayInfos: DayInfo[] }) {
  const maxWeek = dayInfos.length > 0 ? Math.ceil(dayInfos[dayInfos.length - 1].offset / 7) : 0;
  const weeks: Array<{ week: number; active: number; total: number }> = [];
  for (let k = Math.max(1, maxWeek - 7); k <= maxWeek; k++) {
    const items = dayInfos.filter((d) => Math.ceil(d.offset / 7) === k);
    weeks.push({ week: k, active: items.filter((d) => d.done > 0).length, total: items.length });
  }

  return (
    <div>
      <div className="flex h-28 items-end gap-2">
        {weeks.map((w, i) => {
          const pct = w.total > 0 ? (w.active / w.total) * 100 : 0;
          return (
            <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <div
                className="bar-grow w-full max-w-6 rounded-md"
                style={{
                  height: `${Math.max(pct, 4)}%`,
                  backgroundColor: pct >= 60 ? 'var(--color-l)' : pct >= 30 ? 'rgba(163,19,19,0.5)' : 'var(--color-grid)',
                  animationDelay: `${i * 70}ms`,
                }}
              />
              <span className="font-mono text-[9px] text-muted-dim">W{w.week}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-dim">Active days per week (up to 7)</p>
    </div>
  );
}

function MonthlyChart({ dayInfos, today }: { dayInfos: DayInfo[]; today: string }) {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 0)).getUTCDate();
  const maxDone = Math.max(1, ...dayInfos.map((d) => d.done));
  const cells: Array<{ day: number; done: number; isSunday: boolean }> = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const dd = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), i));
    const info = dayInfos.find((d) => d.iso === isoFor(dd));
    cells.push({ day: i, done: info?.done ?? 0, isSunday: dd.getUTCDay() === 0 });
  }

  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {cells.map((c, i) => {
          const h = Math.max((c.done / maxDone) * 100, c.done > 0 ? 8 : 3);
          return (
            <div
              key={c.day}
              className="bar-grow flex-1 rounded-t-sm"
              style={{
                height: `${h}%`,
                backgroundColor: c.done > 0 ? 'var(--color-peak)' : 'var(--color-grid)',
                opacity: c.done > 0 ? 1 : 0.7,
                animationDelay: `${i * 12}ms`,
              }}
              title={`Day ${c.day}: ${c.done} tasks`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-muted-dim">
        <span>1</span>
        <span>10</span>
        <span>20</span>
        <span>{daysInMonth}</span>
      </div>
    </div>
  );
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function TierSection({ title, accent, icon, items }: { title: string; accent: string; icon: React.ReactNode; items: Array<{ habit: { id: string; name: string }; score: number | null; streak: number }> }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <SectionHeader icon={icon} accent={accent} title={title} meta={`${items.length}`} />
      <div className="space-y-2.5">
        {items.map(({ habit, score, streak }) => (
          <div key={habit.id} className="card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{habit.name}</p>
              <div className="flex shrink-0 items-center gap-2">
                {streak > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-light">
                    <Flame size={11} /> {streak}
                  </span>
                )}
                <span className="font-mono text-sm font-semibold" style={{ color: scoreColor(score) }}>
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

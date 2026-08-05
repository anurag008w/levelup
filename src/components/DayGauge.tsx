import { useEffect, useState } from 'react';

interface Props {
  dayNumber: number;
  totalDays: number;
  todayPct: number;
  levelCode: string;
}

/**
 * Hero gauge for the Today tab.
 *
 * BIG ring  → today's completion % (fills/spins the moment a task is marked
 *             done — the "alive" motion the user sees).
 * Inner ring → journey position (day/totalDays) — slow, silver.
 * 30 outer ticks → level boundaries; the ones behind the current day light up.
 *
 * Every task completion also fires a short blood-red ripple so the gauge feels
 * responsive instead of static.
 */
export default function DayGauge({ dayNumber, totalDays, todayPct, levelCode }: Props) {
  const size = 230;
  const stroke = 14;
  const c = size / 2;
  const r = 96;
  const ringC = 2 * Math.PI * r;
  const journeyFrac = Math.min(1, dayNumber / totalDays);
  const innerR = 71;
  const innerC = 2 * Math.PI * innerR;

  // Restart the ripple whenever today's progress moves (task completed).
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    setPulse((p) => p + 1);
  }, [todayPct]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`Day ${dayNumber} of ${totalDays}, ${todayPct}% of today's plan complete`}
      >
        {/* base ring */}
        <circle cx={c} cy={c} r={r} stroke="var(--color-grid)" strokeWidth={stroke} fill="none" />
        {/* BIG today ring — moves when tasks are marked done */}
        <circle
          cx={c}
          cy={c}
          r={r}
          stroke="url(#todayGradient)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={ringC}
          strokeDashoffset={ringC * (1 - todayPct / 100)}
          strokeLinecap="round"
          style={{ opacity: 0.92, transition: 'stroke-dashoffset 0.7s var(--ease-emphasized)' }}
        />
        {/* level boundary ticks (journey) */}
        {Array.from({ length: 30 }, (_, i) => {
          const angle = (i / 30) * 2 * Math.PI;
          const inner = r + stroke / 2 + 4;
          const outer = inner + 5;
          const passed = i / 30 <= journeyFrac;
          return (
            <line
              key={i}
              x1={c + inner * Math.cos(angle)}
              y1={c + inner * Math.sin(angle)}
              x2={c + outer * Math.cos(angle)}
              y2={c + outer * Math.sin(angle)}
              stroke={passed ? 'var(--color-l)' : 'var(--color-border-strong)'}
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          );
        })}
        {/* inner journey ring — silver, subtle */}
        <circle cx={c} cy={c} r={innerR} stroke="var(--color-grid)" strokeWidth={7} fill="none" />
        <circle
          cx={c}
          cy={c}
          r={innerR}
          stroke="var(--color-light)"
          strokeWidth={7}
          fill="none"
          strokeDasharray={innerC}
          strokeDashoffset={innerC * (1 - journeyFrac)}
          strokeLinecap="round"
          style={{ opacity: 0.55, transition: 'stroke-dashoffset 0.8s var(--ease-emphasized)' }}
        />
        <defs>
          <linearGradient id="todayGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-blood)" />
            <stop offset="45%" stopColor="var(--color-l)" />
            <stop offset="100%" stopColor="var(--color-blood-bright)" />
          </linearGradient>
        </defs>
      </svg>
      {/* Completion ripple — restarts on every task toggle */}
      {pulse > 0 && <div key={pulse} className="gauge-pulse-glow" aria-hidden="true" />}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="eyebrow">DAY</span>
        <span className="mt-1 font-display text-5xl font-bold leading-none tracking-tight">
          {dayNumber}
          <span className="text-xl font-semibold text-muted">/{totalDays}</span>
        </span>
        <span className="mt-2.5 rounded-full border border-border bg-panel-raised px-3 py-1 font-mono text-xs font-semibold tracking-widest text-light">
          {levelCode}
        </span>
        <span className="mt-2.5 font-mono text-sm font-semibold text-l">{todayPct}%</span>
      </div>
    </div>
  );
}

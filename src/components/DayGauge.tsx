interface Props {
  dayNumber: number;
  totalDays: number;
  todayPct: number;
  levelCode: string;
}

export default function DayGauge({ dayNumber, totalDays, todayPct, levelCode }: Props) {
  const size = 152;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const journeyFrac = Math.min(1, dayNumber / totalDays);
  const innerR = r - stroke - 7;
  const innerC = 2 * Math.PI * innerR;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Day ${dayNumber} of ${totalDays}, ${todayPct}% complete today`}>
        {/* level boundary ticks */}
        {Array.from({ length: 30 }, (_, i) => {
          const angle = (i / 30) * 2 * Math.PI;
          const inner = r + stroke / 2 + 4;
          const outer = inner + 4;
          const passed = i / 30 <= journeyFrac;
          return (
            <line
              key={i}
              x1={size / 2 + inner * Math.cos(angle)}
              y1={size / 2 + inner * Math.sin(angle)}
              x2={size / 2 + outer * Math.cos(angle)}
              y2={size / 2 + outer * Math.sin(angle)}
              stroke={passed ? 'var(--color-l)' : 'var(--color-border-strong)'}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}
        {/* base ring */}
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-grid)" strokeWidth={stroke} fill="none" />
        {/* journey progress (90 days) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#journeyGradient)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - journeyFrac * c}
          strokeLinecap="round"
          style={{ opacity: 0.9, transition: 'stroke-dashoffset 0.8s var(--ease-emphasized)' }}
        />
        {/* inner today ring */}
        <circle cx={size / 2} cy={size / 2} r={innerR} stroke="var(--color-grid)" strokeWidth={6} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={innerR}
          stroke="var(--color-l)"
          strokeWidth={6}
          fill="none"
          strokeDasharray={innerC}
          strokeDashoffset={innerC * (1 - todayPct / 100)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s var(--ease-emphasized)' }}
        />
        <defs>
          <linearGradient id="journeyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-l)" />
            <stop offset="60%" stopColor="var(--color-l)" />
            <stop offset="100%" stopColor="var(--color-light)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="eyebrow">DAY</span>
        <span className="mt-0.5 font-display text-3xl font-bold leading-none tracking-tight">
          {dayNumber}
          <span className="text-base font-semibold text-muted">/{totalDays}</span>
        </span>
        <span className="mt-1.5 rounded-full border border-border bg-panel-raised px-2 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-light">
          {levelCode}
        </span>
        <span className="mt-1.5 font-mono text-[11px] font-semibold text-l">{todayPct}%</span>
      </div>
    </div>
  );
}

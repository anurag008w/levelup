interface Props {
  dayNumber: number;
  totalDays: number;
  todayPct: number;
  levelCode: string;
}

export default function DayGauge({ dayNumber, totalDays, todayPct, levelCode }: Props) {
  const size = 176;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const journeyFrac = Math.min(1, dayNumber / totalDays);
  const ticks = Array.from({ length: 30 }, (_, i) => i); // one tick per level

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* tick marks per level */}
        {ticks.map((i) => {
          const angle = (i / ticks.length) * 360 * (Math.PI / 180);
          const inner = r + stroke / 2 + 3;
          const outer = inner + 5;
          const x1 = size / 2 + inner * Math.cos(angle);
          const y1 = size / 2 + inner * Math.sin(angle);
          const x2 = size / 2 + outer * Math.cos(angle);
          const y2 = size / 2 + outer * Math.sin(angle);
          const passed = i / ticks.length <= journeyFrac;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={passed ? 'var(--color-light)' : 'var(--color-border)'}
              strokeWidth={1.5}
            />
          );
        })}
        {/* base ring */}
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-grid)" strokeWidth={stroke} fill="none" />
        {/* journey progress ring (90 days) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--color-light)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - journeyFrac * c}
          strokeLinecap="round"
          style={{ opacity: 0.35, transition: 'stroke-dashoffset 0.6s ease' }}
        />
        {/* today's completion ring, inner accent */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r - stroke - 2}
          stroke="var(--color-grid)"
          strokeWidth={6}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r - stroke - 2}
          stroke="var(--color-l)"
          strokeWidth={6}
          fill="none"
          strokeDasharray={2 * Math.PI * (r - stroke - 2)}
          strokeDashoffset={2 * Math.PI * (r - stroke - 2) * (1 - todayPct / 100)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-[10px] tracking-widest text-muted">DAY</span>
        <span className="font-display text-3xl font-bold leading-none">
          {dayNumber}
          <span className="text-base text-muted">/{totalDays}</span>
        </span>
        <span className="mt-1 font-mono text-[10px] tracking-widest text-light">{levelCode}</span>
        <span className="mt-1 rounded-full bg-grid px-2 py-0.5 font-mono text-[10px] font-semibold text-l">
          {todayPct}% done
        </span>
      </div>
    </div>
  );
}

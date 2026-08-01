export default function Stat({
  label,
  value,
  icon,
  accent = 'var(--color-text)',
  hint,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 text-center">
      {icon && <span className="opacity-90">{icon}</span>}
      <span className="font-display text-xl font-bold leading-none" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-[11px] leading-tight text-muted">{label}</span>
      {hint && <span className="text-[10px] text-muted-dim">{hint}</span>}
    </div>
  );
}

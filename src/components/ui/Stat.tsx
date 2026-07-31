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
    <div className="card flex flex-col items-center justify-center gap-0.5 px-2 py-3 text-center">
      {icon && <span className="mb-0.5">{icon}</span>}
      <span className="font-display text-xl font-bold leading-none" style={{ color: accent }}>
        {value}
      </span>
      <span className="mt-1 text-[10px] leading-tight text-muted">{label}</span>
      {hint && <span className="text-[9px] text-muted/70">{hint}</span>}
    </div>
  );
}

export default function SectionHeader({
  icon,
  accent,
  title,
  meta,
}: {
  icon?: React.ReactNode;
  accent: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {icon && <span className="shrink-0">{icon}</span>}
      <p className="font-mono text-[11px] font-semibold tracking-[0.14em] uppercase" style={{ color: accent }}>
        {title}
      </p>
      {meta && <span className="ml-auto text-[11px] text-muted">{meta}</span>}
    </div>
  );
}

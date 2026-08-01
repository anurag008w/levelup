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
    <div className="mb-2.5 flex items-center gap-2">
      {icon && <span className="shrink-0">{icon}</span>}
      <p className="section-label" style={{ color: accent }}>
        {title}
      </p>
      {meta && <span className="ml-auto text-xs font-medium text-muted">{meta}</span>}
    </div>
  );
}

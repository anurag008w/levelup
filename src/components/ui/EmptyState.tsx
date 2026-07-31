export default function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <span className="opacity-70">{icon}</span>}
      <p className="text-sm font-semibold text-muted">{title}</p>
      {hint && <p className="max-w-[260px] text-xs leading-relaxed text-muted/80">{hint}</p>}
    </div>
  );
}

export default function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      {icon && (
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-panel-raised text-muted">
          {icon}
        </span>
      )}
      <p className="font-display text-base font-semibold text-text">{title}</p>
      {hint && <p className="max-w-[260px] text-sm leading-relaxed text-muted">{hint}</p>}
      {action}
    </div>
  );
}

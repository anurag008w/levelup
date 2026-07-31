export default function ProgressBar({
  value,
  color = 'var(--color-l)',
  track = 'var(--color-grid)',
  height = 6,
}: {
  value: number;
  color?: string;
  track?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ backgroundColor: track, height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}

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
      className="progress-track"
      style={{ backgroundColor: track, height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="progress-bar"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}

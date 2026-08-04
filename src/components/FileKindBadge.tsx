import { fileKindOf } from '../lib/file-kind';

/** Colored tile with the type-appropriate icon (PDF → red, image → violet…). */
export default function FileKindBadge({
  name,
  mimeType,
  size = 'md',
}: {
  name: string;
  mimeType?: string;
  size?: 'sm' | 'md';
}) {
  const kind = fileKindOf(name, mimeType);
  const iconSize = size === 'sm' ? 13 : 16;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${kind.tile} ${
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
      }`}
    >
      <kind.Icon size={iconSize} className={kind.fg} />
    </span>
  );
}

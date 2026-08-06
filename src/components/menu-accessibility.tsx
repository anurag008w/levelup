import { useRef } from 'react';

/**
 * Visually hidden button that opens the same context menu a long-press/right
 * click would. Reports the open position from its own bounding rect.
 */
export function MoreButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (rect: DOMRect) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="sr-only"
      aria-label={label}
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onOpen(rect);
      }}
    >
      More actions
    </button>
  );
}

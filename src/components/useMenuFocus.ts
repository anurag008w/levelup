import { useEffect, useRef } from 'react';

/** While `open` is true: focus the first menu item and close on Escape. */
export function useMenuFocus(open: boolean, onClose: () => void) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return { menuRef };
}

import type { Phase } from '../types';

export function phaseAccent(color: Phase['color']): string {
  switch (color) {
    case 'l':
      return 'var(--color-l)';
    case 'light':
      return 'var(--color-light)';
    case 'peak':
      return 'var(--color-peak)';
    default:
      return 'var(--color-success)';
  }
}

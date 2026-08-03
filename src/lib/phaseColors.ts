import type { Phase } from '../types';

export function phaseAccent(color: Phase['color']): string {
  switch (color) {
    case 'l':
      return '#8a9a5b';
    case 'light':
      return '#c9a227';
    case 'peak':
      return '#c9a227';
    default:
      return '#8a9a5b';
  }
}

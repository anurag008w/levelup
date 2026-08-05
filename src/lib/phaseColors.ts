import type { Phase } from '../types';

export function phaseAccent(color: Phase['color']): string {
  switch (color) {
    case 'l':
      return '#a31313';
    case 'light':
      return '#efe9df';
    case 'peak':
      return '#efe9df';
    default:
      return '#a31313';
  }
}

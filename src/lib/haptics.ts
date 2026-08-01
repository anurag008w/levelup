/** Lightweight haptic feedback for touch interactions.
 *  Uses the Web Vibration API when available (Android); no-ops elsewhere. */

export function haptic(pattern: number | number[] = 12) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* not supported — ignore */
  }
}

export function hapticSuccess() {
  haptic([12, 40, 24]);
}

export function hapticError() {
  haptic([60, 50, 60]);
}

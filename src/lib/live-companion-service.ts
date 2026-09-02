import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface NativeLiveCompanion {
  start(): Promise<void>;
  stop(): Promise<void>;
  armLiveCall(): Promise<void>;
  markCallConnected(): Promise<void>;
  enterPiP(): Promise<void>;
  isLiveCallInterrupted(): Promise<{ interrupted: boolean; attempted: boolean }>;
  clearLiveCallInterrupted(): Promise<void>;
  addListener(eventName: 'pipModeChanged', listener: (data: { inPictureInPicture: boolean }) => void): Promise<PluginListenerHandle>;
}
const LiveCompanion = registerPlugin<NativeLiveCompanion>('LiveCompanion');

/** Explicit native foreground-service ownership for an active Live call. */
export async function startLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.start();
}

/**
 * Arm PiP + foreground service as soon as the live overlay opens (before the
 * call connects) so a Home/Recents press during the connecting window still
 * enters PiP instead of silently failing — the exact bug the PR fixes.
 * Idempotent: calling it again while already armed is a harmless no-op.
 */
export async function armLiveCall(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.armLiveCall();
}

/** Relinquish foreground-service ownership. */
export async function stopLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.stop();
}

/** Enter Picture-in-Picture mode — mic + audio continue in background. */
export async function enterPictureInPicture(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try { await LiveCompanion.enterPiP(); } catch { /* noop */ }
}

/**
 * Promote the persisted lifecycle ARMED → CONNECTED once the Gemini session
 * commits (review 8 / P1). Called by the overlay at its startup commit point so
 * that a later process death surfaces the "previous live call was interrupted"
 * recovery UX only for calls that had actually connected — a kill mid-startup
 * is reported as an attempted call instead.
 */
export async function markLiveCallConnected(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.markCallConnected();
}

/**
 * Process-death recovery: returns true when a previous Live call had reached
 * CONNECTED and was killed by the system (Activity/OEM kill) before an explicit
 * hangup — native persists the lifecycle ARMED → CONNECTED and clears it only
 * on explicit hangup. This is DETECTION/UX, not session recovery: the session
 * itself lives in the process/WebView and a kill ends it in place.
 */
export async function isLiveCallInterrupted(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { interrupted } = await LiveCompanion.isLiveCallInterrupted();
    return interrupted;
  } catch (err) {
    console.warn('[LiveCompanion] isLiveCallInterrupted failed:', err);
    return false;
  }
}

/** Dismiss the "last call was interrupted" banner (user acknowledged). */
export async function clearLiveCallInterrupted(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LiveCompanion.clearLiveCallInterrupted();
  } catch (err) {
    console.warn('[LiveCompanion] clearLiveCallInterrupted failed:', err);
  }
}

/** Listen for PiP mode changes (enter/exit). Returns cleanup function. */
export function onPiPModeChanged(listener: (inPiP: boolean) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let cancelled = false;
  let handle: PluginListenerHandle | null = null;
  void LiveCompanion.addListener('pipModeChanged', ({ inPictureInPicture }) => {
    if (!cancelled) listener(inPictureInPicture);
  }).then((h) => {
    if (cancelled && handle === h) void h.remove();
    else handle = h;
  });
  return () => {
    cancelled = true;
    if (handle) { void handle.remove(); handle = null; }
  };
}

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface NativeLiveCompanion {
  start(): Promise<void>;
  stop(): Promise<void>;
  armLiveCall(): Promise<void>;
  enterPiP(): Promise<void>;
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

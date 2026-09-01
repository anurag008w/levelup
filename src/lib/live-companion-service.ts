import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface NativeLiveCompanion {
  start(): Promise<void>;
  stop(): Promise<void>;
  enterPiP(): Promise<void>;
  addListener(eventName: 'pipModeChanged', listener: (data: { inPictureInPicture: boolean }) => void): Promise<PluginListenerHandle>;
}
const LiveCompanion = registerPlugin<NativeLiveCompanion>('LiveCompanion');

/** Explicit native foreground-service ownership for an active Live call. */
export async function startLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.start();
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

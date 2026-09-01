import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeLiveCompanion { start(): Promise<void>; stop(): Promise<void>; }
const LiveCompanion = registerPlugin<NativeLiveCompanion>('LiveCompanion');

/** Explicit native foreground-service ownership for an active Live call. */
export async function startLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.start();
}
export async function stopLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.stop();
}

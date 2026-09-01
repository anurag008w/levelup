import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

interface NativeLiveCompanion {
  start(): Promise<void>;
  stop(): Promise<void>;
  disconnect(): Promise<void>;
  updateNotification(options: { history: string[] }): Promise<void>;
  addListener(eventName: 'notificationReply', listener: (data: { text: string }) => void): Promise<PluginListenerHandle>;
}
const LiveCompanion = registerPlugin<NativeLiveCompanion>('LiveCompanion');

/** Explicit native foreground-service ownership for an active Live call. */
export async function startLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.start();
}

/** Relinquish foreground-service ownership (the notification shade disappears). */
export async function stopLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) await LiveCompanion.stop();
}

/** Drop any retained bridge state after a call is fully torn down. */
export async function disconnectLiveCompanionService(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try { await LiveCompanion.disconnect(); } catch { /* noop */ }
  }
}

/**
 * Push the latest (trimmed) conversation into the live-call notification so it
 * behaves like a chat you can read and reply to from the shade.
 *
 * @param history oldest-first lines, each prefixed "U:" (user) / "A:" (assistant).
 */
export async function updateLiveCompanionNotification(history: string[]): Promise<void> {
  if (!Capacitor.isNativePlatform() || history.length === 0) return;
  try {
    await LiveCompanion.updateNotification({ history });
  } catch {
    // Notification refresh is best-effort; a live call that can't refresh its
    // shade must never crash the session.
  }
}

/**
 * Register a listener for quick-replies typed into the live-call notification.
 * Returns an async unsubscribe function (the underlying Capacitor handle is
 * acquired asynchronously, exactly like the other native listeners).
 */
export function onLiveCompanionNotificationReply(
  listener: (text: string) => void,
): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let cancelled = false;
  let handle: PluginListenerHandle | null = null;
  void LiveCompanion.addListener('notificationReply', ({ text }) => {
    if (!cancelled) listener(text);
  }).then((h) => {
    if (cancelled && handle === h) void h.remove();
    else handle = h;
  });
  return () => {
    cancelled = true;
    if (handle) { void handle.remove(); handle = null; }
  };
}

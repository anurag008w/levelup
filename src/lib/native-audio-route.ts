import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { LiveAudioRoute } from '../core/domain/live-types';

interface AudioRouteNative {
  setRoute(options: { route: string }): Promise<{ route: string; deviceName?: string; deviceType?: string }>;
  resetRoute(): Promise<void>;
  getAvailableRoutes(): Promise<{ speaker: boolean; earpiece: boolean; bluetooth: boolean }>;
  requestAudioFocus(): Promise<{ granted: boolean; status: 'granted' | 'delayed' | 'failed' }>;
  addListener(eventName: 'audioFocusChange', listenerFunc: (event: { focusChange: number }) => void): Promise<PluginListenerHandle>;
}

/** Subscribe to real Android focus changes for the lifetime of a call. */
export async function addNativeAudioFocusListener(listener: (focusChange: number) => void): Promise<PluginListenerHandle | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await AudioRoute.addListener('audioFocusChange', event => listener(event.focusChange));
  } catch (err) {
    console.warn('[AudioRoute] Failed to subscribe to audio focus:', err);
    return null;
  }
}

const AudioRoute = registerPlugin<AudioRouteNative>('AudioRoute');

/**
 * True on Android/iOS (where the plugin is real). On web the route/focus APIs
 * are graceful no-ops, so callers distinguish "native refused this route"
 * (treat as a hard failure → fallback/abort) from "web, nothing to do"
 * (accept silently instead of breaking browser calls).
 */
export function isNativeAudioPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Switch Android system audio route between Loudspeaker, Earpiece, and Bluetooth headset.
 * On browser/web, this is a graceful no-op.
 */
export async function setNativeAudioRoute(route: LiveAudioRoute): Promise<{ route: string; deviceName?: string; deviceType?: string } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await AudioRoute.setRoute({ route });
  } catch (err) {
    console.warn('[AudioRoute] Failed to set route:', err);
    return null;
  }
}

/**
 * Reset audio routing back to normal media state when a call finishes.
 */
export async function resetNativeAudioRoute(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AudioRoute.resetRoute();
  } catch (err) {
    console.warn('[AudioRoute] Failed to reset route:', err);
  }
}

/**
 * Acquire Android voice-communication focus for the duration of a Live call.
 * Review-9 P1.11 (documented decision): AUDIOFOCUS_REQUEST_DELAYED is treated
 * as a STARTUP FAILURE (returns false), never collapsed into ambiguous boolean
 * behavior — a delayed grant arrives with no deterministic timing, so for a
 * live session we reject immediately and let the caller surface a clear error /
 * fall back to the permission modal, which re-requests from a clean slate. We
 * deliberately do NOT implement a pending-delay resume state: the added async
 * complexity is not worth it for the rare delayed-grant case, and a rejected
 * call is always retryable by the user.
 */
export async function requestNativeCallAudioFocus(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const result = await AudioRoute.requestAudioFocus();
    return result.granted;
  } catch (err) {
    console.warn('[AudioRoute] Failed to acquire call audio focus:', err);
    return false;
  }
}

/**
 * Query available audio routes (e.g. detect if bluetooth headset or earpiece is present).
 */
export async function getAvailableNativeAudioRoutes(): Promise<{ speaker: boolean; earpiece: boolean; bluetooth: boolean } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await AudioRoute.getAvailableRoutes();
  } catch (err) {
    console.warn('[AudioRoute] Failed to get available routes:', err);
    return null;
  }
}

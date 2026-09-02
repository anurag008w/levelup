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

/** Acquire Android voice-communication focus for the duration of a Live call. */
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

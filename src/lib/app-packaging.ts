/**
 * App packaging identity — resolves which Android package is actually running.
 *
 * Stable and Beta ship the same JS bundle but different Android applicationIds
 * (`com.anurag.levelup` vs `com.anurag.levelup.beta`). Package-dependent
 * intents — FileProvider content URIs, notification-settings extras and
 * `package:` deep links — must point at the REAL installed id, otherwise Beta
 * would open Stable's installer/settings or hit a missing authority. Identity
 * is therefore derived from the OS at runtime (`App.getInfo()`, which reads the
 * installed package's id/name) instead of hard-coding the stable id.
 *
 * Web preview and unit tests run outside a native package — they fall back to
 * the stable identity, which keeps existing behaviour and test expectations.
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export const STABLE_PACKAGE_ID = 'com.anurag.levelup';
export const BETA_PACKAGE_ID = 'com.anurag.levelup.beta';
export const STABLE_APP_NAME = 'LevelUp';
export const BETA_APP_NAME = 'LevelUp Beta';

let cachedId: string | null = null;
let cachedName: string | null = null;

/** Best-known installed package id (stable fallback until the native probe). */
export function getAppId(): string {
  return cachedId ?? STABLE_PACKAGE_ID;
}

/** Best-known display name for the installed app. */
export function getAppName(): string {
  return cachedName ?? (getAppId() === BETA_PACKAGE_ID ? BETA_APP_NAME : STABLE_APP_NAME);
}

/** True when the currently installed build is the isolated Beta flavor. */
export function isBetaApp(): boolean {
  return getAppId() === BETA_PACKAGE_ID;
}

/**
 * Loads the real installed package id/name from the OS (per-flavor) and caches
 * it. Non-native contexts (web preview / unit tests) keep the stable identity.
 * Safe to call many times — the native probe runs once.
 */
export async function resolveAppId(): Promise<string> {
  if (cachedId) return cachedId;
  if (!Capacitor.isNativePlatform()) return STABLE_PACKAGE_ID;
  try {
    const info = await App.getInfo();
    const id = info.id?.trim() || STABLE_PACKAGE_ID;
    cachedId = id;
    cachedName = info.name?.trim() || (id === BETA_PACKAGE_ID ? BETA_APP_NAME : STABLE_APP_NAME);
    return id;
  } catch {
    // Native probe fail — fall back to the stable identity.
    return STABLE_PACKAGE_ID;
  }
}
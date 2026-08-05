/**
 * Background & battery permissions wrapper.
 *
 * Android OEMs (Xiaomi, Oppo, Vivo, OnePlus, Samsung...) background apps ko
 * aggressive kill karte hain. Bina battery-optimization exemption aur autostart
 * allowlist ke app ka process mar jata hai — isliye AI-reply notifications
 * background mein nahi aati aur notification replies drop ho jate hain.
 *
 * Ye module native `BackgroundPermission` plugin (MainActivity mein registered)
 * ko wrap karta hai. Web pe no-op — browser builds ke liye status null hota hai.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface BackgroundPermissionStatus {
  /** App battery optimization whitelist pe hai ya nahi. */
  batteryWhitelisted: boolean;
  /** Build.MANUFACTURER (Xiaomi, samsung, ...). */
  manufacturer: string;
  /** Kya device pe hume OEM autostart settings screen ka pata hai. */
  autostartSupported: boolean;
  /** Resolve hue autostart screen ka package (null agar supported nahi). */
  autostartPackage: string | null;
}

interface BackgroundPermissionNative {
  getStatus(): Promise<BackgroundPermissionStatus>;
  openBatterySettings(): Promise<{ opened: boolean; fallback?: boolean; reason?: string }>;
  openAutostartSettings(): Promise<{ opened: boolean; fallback?: boolean; reason?: string }>;
}

const Native = registerPlugin<BackgroundPermissionNative>('BackgroundPermission');

export async function getBackgroundPermissionStatus(): Promise<BackgroundPermissionStatus | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await Native.getStatus();
  } catch {
    return null;
  }
}

/** System "ignore battery optimizations" dialog/settings kholta hai. */
export async function openBatterySettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const res = await Native.openBatterySettings();
    return res.opened;
  } catch {
    return false;
  }
}

/** OEM autostart settings kholta hai (fallback: app details page). */
export async function openAutostartSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const res = await Native.openAutostartSettings();
    return res.opened;
  } catch {
    return false;
  }
}

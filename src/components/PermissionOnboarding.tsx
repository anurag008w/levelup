import { useCallback, useEffect, useState } from 'react';
import { BatteryCharging, Bell, Check, ExternalLink, Rocket, X } from 'lucide-react';
import { App } from '@capacitor/app';
import {
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionStatus,
} from '../lib/notifications';
import {
  getBackgroundPermissionStatus,
  openAutostartSettings,
  openBatterySettings,
  type BackgroundPermissionStatus,
} from '../lib/background-permission';
import { haptic } from '../lib/haptics';

/**
 * Login ke turant baad dikhne wala permissions onboarding popup (Android).
 *
 * Sirf wahi steps dikhte hain jo device pe missing hain:
 *   1. Notifications — system dialog se permission (AI replies ke alerts)
 *   2. Battery optimization — system request (background mein replies aayein)
 *   3. Autostart — OEM settings (Xiaomi/Oppo/Vivo... pe process survive kare)
 *
 * Har step pe valid reason diya gaya hai taaki user ko pata ho kyun maanga
 * ja raha hai. Har system screen se wapas aane pe status refresh hota hai.
 * Web pe ye component render hi nahi hota (App.tsx native check karta hai).
 */
export default function PermissionOnboarding({ onDone }: { onDone: () => void }) {
  const [perm, setPerm] = useState<NotificationPermissionStatus>('prompt');
  const [bg, setBg] = useState<BackgroundPermissionStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const [p, b] = await Promise.all([getNotificationPermission(), getBackgroundPermissionStatus()]);
    setPerm(p);
    setBg(b);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // System settings (battery/autostart) se wapas aane pe status refresh karo.
  useEffect(() => {
    let listener: { remove: () => void } | null = null;
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh();
    }).then((l) => {
      listener = l;
    });
    return () => {
      void listener?.remove();
    };
  }, [refresh]);

  async function allowNotifications() {
    if (busy) return;
    haptic();
    setBusy('notif');
    setMessage('');
    try {
      const next = await requestNotificationPermission();
      setPerm(next);
      if (next === 'granted') setMessage('Notifications chalu — Misa ke replies ka alert milega.');
      else if (next === 'denied') setMessage('Permission denied — system settings se manually ON karni hogi.');
    } finally {
      setBusy(null);
    }
  }

  async function handleBattery() {
    if (busy) return;
    haptic();
    setBusy('battery');
    setMessage('');
    const opened = await openBatterySettings();
    if (!opened) setMessage('Battery settings nahi khul paye — Settings → Apps → LevelUp → Battery se karo.');
    setBusy(null);
  }

  async function handleAutostart() {
    if (busy) return;
    haptic();
    setBusy('autostart');
    setMessage('');
    const opened = await openAutostartSettings();
    if (!opened) setMessage('Autostart settings nahi khul paye — Settings → Apps → LevelUp → Autostart se karo.');
    setBusy(null);
  }

  const notifDone = perm === 'granted';
  const batteryDone = !!bg?.batteryWhitelisted;

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center sm:items-center sm:p-5">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => onDone()} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Permissions setup" className="gradient-border w-full max-w-sm rounded-t-2xl rounded-b-none p-px sm:rounded-2xl">
        <div className="rounded-t-[calc(var(--radius-2xl)-1px)] rounded-b-none bg-panel p-5 sm:rounded-[calc(var(--radius-2xl)-1px)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-lg font-bold leading-tight">Setup to chahiye</p>
              <p className="mt-0.5 text-xs leading-snug text-muted">
                Background mein bhi Misa ka reply aaye — iske liye 3 chhote permissions, ~1 minute.
              </p>
            </div>
            <button type="button" onClick={() => onDone()} aria-label="Close" className="icon-btn">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2.5">
            {/* 1 — Notifications */}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-panel-raised p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-l/10 text-l">
                {notifDone ? <Check size={18} /> : <Bell size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Notifications</p>
                <p className="text-[11px] leading-snug text-muted">Naya AI reply aate hi alert milega — app band ho to bhi.</p>
              </div>
              {notifDone ? (
                <span className="badge" style={{ backgroundColor: 'rgba(163,19,19,0.12)', color: 'var(--color-l)' }}>
                  Done
                </span>
              ) : (
                <button type="button" onClick={() => void allowNotifications()} disabled={busy !== null} className="btn btn-primary min-h-9 shrink-0 gap-1.5 px-3 text-xs">
                  {busy === 'notif' ? <span className="spinner" aria-hidden="true" /> : <Bell size={13} />}
                  Allow
                </button>
              )}
            </div>

            {/* 2 — Battery optimization */}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-panel-raised p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-l/10 text-l">
                {batteryDone ? <Check size={18} /> : <BatteryCharging size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Battery permission</p>
                <p className="text-[11px] leading-snug text-muted">Battery saver app ko background mein nahi marega — replies deliver ho sakein.</p>
              </div>
              {batteryDone ? (
                <span className="badge" style={{ backgroundColor: 'rgba(163,19,19,0.12)', color: 'var(--color-l)' }}>
                  Done
                </span>
              ) : (
                <button type="button" onClick={() => void handleBattery()} disabled={busy !== null} className="btn btn-ghost min-h-9 shrink-0 gap-1.5 px-3 text-xs">
                  <ExternalLink size={13} /> Open
                </button>
              )}
            </div>

            {/* 3 — Autostart (sirf jab OEM settings pata ho) */}
            {!!bg?.autostartSupported && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-panel-raised p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-l/10 text-l">
                  <Rocket size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Autostart allow</p>
                  <p className="text-[11px] leading-snug text-muted">Phone restart ya swipe-away ke baad bhi notifications kaam karein.</p>
                </div>
                <button type="button" onClick={() => void handleAutostart()} disabled={busy !== null} className="btn btn-ghost min-h-9 shrink-0 gap-1.5 px-3 text-xs">
                  <ExternalLink size={13} /> Open
                </button>
              </div>
            )}
          </div>

          {message && (
            <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: 'rgba(163,19,19,0.13)', color: 'var(--color-l)' }}>
              {message}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-snug text-muted-dim">
              {notifDone && batteryDone ? 'Sab set hai — ab Misa ready hai.' : 'Koi bhi step skip kar sakte ho — baad mein system Settings se kar lena.'}
            </p>
            <button type="button" onClick={() => onDone()} className="btn btn-primary min-h-10 shrink-0 px-5 text-xs font-bold">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

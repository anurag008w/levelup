/**
 * Notifications service — native (Capacitor LocalNotifications) + web (Notification API).
 *
 * Native APK (Android 8+ se latest tak) ke liye LocalNotifications plugin use hota hai:
 *  - Android 13+ pe runtime POST_NOTIFICATIONS popup (plugin khud request karta hai)
 *  - Android 8-12 pe permission bina popup ke mil jaati hai (manifest permission)
 * Web/preview ke liye browser Notification API ka fallback hai.
 *
 * Preference persistentStorage me rehti hai (Android pe app update ke baad bhi survive karti hai).
 */
import { Capacitor, type PermissionState } from '@capacitor/core';
import { LocalNotifications, type PendingLocalNotificationSchema } from '@capacitor/local-notifications';
import { IntentLauncher, ActivityAction } from '@capgo/capacitor-intent-launcher';
import { persistentStorage } from '../infra/storage/persistent-storage';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** Web pe notification unsupported kyun hai — isse UI targeted message dikha sakta hai. */
export type NotificationUnsupportedReason = 'insecure' | 'api' | 'webview';

/** Notification action se reply/click handle karne wala listener type. */
export interface NotificationActionPayload {
  actionId: string;
  inputValue?: string;
  sessionId?: string;
}

/** LevelUp ka Android package (capacitor.config.ts ke appId se match karna chahiye). */
const APP_PACKAGE = 'com.anurag.levelup';
/** persistentStorage key — notifications ON/OFF. */
const PREF_KEY = 'notifications';
/** Android NotificationManager ka id 32-bit int hota hai — isi liye modulo. */
const ANDROID_ID_MAX = 2_147_483_647;
/** Android 8+ notification channel — HIGH importance = heads-up + sound. */
const CHANNEL_ID = 'levelup-ai-replies';
/** Notification action type — inline reply + open chat actions. */
const ACTION_TYPE_ID = 'levelup-ai-reply';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Web/browser pe notifications supported hain ya nahi — saath me reason bhi.
 * Browser Notification API sirf secure context (HTTPS/localhost) me expose
 * hota hai; http://192.168.x.x:5173 jaise LAN IP pe `Notification` exist hi
 * nahi karta, isliye wahan toggle disable ho jata hai.
 */
export function getNotificationSupport(): { supported: boolean; reason?: NotificationUnsupportedReason } {
  if (isNativePlatform()) return { supported: true };
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { supported: false, reason: 'api' };
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) return { supported: false, reason: 'insecure' };
  if (!('Notification' in window)) return { supported: false, reason: 'api' };
  return { supported: true };
}

export function isNotificationSupported(): boolean {
  return getNotificationSupport().supported;
}

/**
 * Android 8+ (API 26) pe notification channel banana zaroori hai — bina HIGH
 * importance channel ke notification bas notification-drawer me chupke aa sakta
 * hai (koi sound/heads-up nahi). Idempotent — sirf tab banata hai jab pehle se
 * na ho.
 */
export async function ensureNotificationChannel(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { channels } = await LocalNotifications.listChannels();
    if (channels.some((c) => c.id === CHANNEL_ID)) return;
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'AI replies',
      description: 'Misa ke naye replies ke alerts',
      importance: 5, // IMPORTANCE_HIGH — sound + heads-up banner
      visibility: 1, // VISIBILITY_PUBLIC — lock screen pe bhi dikhe
    });
  } catch {
    // channel banana best-effort hai — plugin ka default channel hamesha hota hai
  }
}

function mapPermission(state: PermissionState): NotificationPermissionStatus {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    default:
      return 'prompt';
  }
}

/**
 * Current permission — bina popup ke. Abhi status puchta hai.
 */
export async function getNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (isNativePlatform()) {
    try {
      const res = await LocalNotifications.checkPermissions();
      return mapPermission(res.display);
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Permission request — system popup (Android 13+ runtime dialog / browser dialog).
 * User gesture ke andar call karna chahiye.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (isNativePlatform()) {
    try {
      const res = await LocalNotifications.requestPermissions();
      return mapPermission(res.display);
    } catch {
      return 'denied';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') return 'granted';
    if (result === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'denied';
  }
}

/**
 * App ki notification settings kholta hai (Android). Agar user ne deny kar diya ho
 * (Android 13+ me "don't ask again"), to isi se wapas chalu kar sakta hai.
 * Web pe kuch nahi khulta — false return hota hai.
 */
export async function openNotificationSettings(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    await IntentLauncher.startActivityAsync({
      action: ActivityAction.APP_NOTIFICATION_SETTINGS,
      extra: { 'android.provider.extra.APP_PACKAGE': APP_PACKAGE },
    });
    return true;
  } catch {
    // Purane Android / kuch OEMs me app-specific notification settings intent fail ho sakta hai —
    // fallback: app details page (wahan Notifications option hota hai).
    try {
      await IntentLauncher.startActivityAsync({
        action: ActivityAction.APPLICATION_DETAILS_SETTINGS,
        data: `package:${APP_PACKAGE}`,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/** Kya user ne notifications ON ki hain (toggle preference). */
export async function getNotificationPreference(): Promise<boolean> {
  try {
    const val = await persistentStorage.get<boolean>(PREF_KEY);
    return val === true;
  } catch {
    return false;
  }
}

/** Toggle preference save karta hai. */
export async function setNotificationPreference(enabled: boolean): Promise<void> {
  try {
    await persistentStorage.set(PREF_KEY, enabled);
  } catch {
    // storage quota errors ko chup karte hain — notification preference critical nahi
  }
}

/**
 * Maps a string (like sessionId) to a deterministic positive 32-bit integer for Android notifications.
 * Same sessionId -> same notification ID -> updates existing chat notification instead of cluttering!
 */
function sessionToNotificationId(sessionId?: string): number {
  if (!sessionId) return 1001;
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash << 5) - hash + sessionId.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % (ANDROID_ID_MAX - 1000)) + 1;
}

/**
 * AI reply aane par notification dikhata hai — sirf tab jab:
 *  - preference ON ho, aur
 *  - permission granted ho.
 * Native me LocalNotifications.schedule; web me browser Notification.
 * Same sessionId -> updates existing notification for that chat session (WhatsApp style).
 */
export async function notifyAiReply(title: string, body: string, sessionId?: string): Promise<void> {
  if (!isNotificationSupported()) return;
  try {
    if (!(await getNotificationPreference())) return;
  } catch {
    return;
  }
  const perm = await getNotificationPermission();
  if (perm !== 'granted') return;

  const notificationId = sessionToNotificationId(sessionId);
  const tag = sessionId ? `levelup-chat-${sessionId}` : 'levelup-ai';

  if (isNativePlatform()) {
    try {
      await ensureNotificationChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notificationId,
            title,
            // Collapsed (single-line) view ke liye short body — Android khud
            // ellipsize kar deta hai agar lamba ho.
            body,
            // largeBody = BigTextStyle — expand/swipe-down karne par poora
            // (multi-line) message dikhta hai instead of cut-off single line.
            largeBody: body,
            summaryText: title,
            channelId: CHANNEL_ID,
            // Reply/Open actions + session id — tap/reply se app usi chat pe khule.
            actionTypeId: ACTION_TYPE_ID,
            extra: { sessionId },
          },
        ],
      });
    } catch {
      // koi UI error nahi — notification best-effort hai
    }
    return;
  }

  // Web fallback — sirf jab app tab background me ho (active chat me disturb na ho).
  if (typeof document !== 'undefined' && document.hidden) {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(title, { body, tag, icon: '/favicon.svg' });
          return;
        }
      }
      const n = new Notification(title, { body, tag });
      setTimeout(() => n.close(), 10_000);
    } catch {
      // ignore
    }
  }
}

/**
 * Manual "Test notification" — Settings me button se turant verify karne ke liye,
 * bina AI reply ka wait kiye. User ne khud click kiya hai isliye web pe tab
 * visible ho tab bhi dikhata hai (document.hidden check bypass).
 */
export async function notifyTest(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (!(await getNotificationPreference())) return false;
  const perm = await getNotificationPermission();
  if (perm !== 'granted') return false;
  try {
    if (isNativePlatform()) {
      await ensureNotificationChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % ANDROID_ID_MAX),
            title: 'LevelUp',
            body: 'Test notification — sab chalu hai! ✅',
            channelId: CHANNEL_ID,
            actionTypeId: ACTION_TYPE_ID,
            extra: { sessionId: undefined },
          },
        ],
      });
      return true;
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification('LevelUp', { body: 'Test notification — sab chalu hai! ✅', icon: '/favicon.svg', tag: 'levelup-test' });
        return true;
      }
    }
    new Notification('LevelUp', { body: 'Test notification — sab chalu hai! ✅' });
    return true;
  } catch {
    return false;
  }
}

/**
 * AI-reply notifications ke actions register karta hai (native): inline "Reply"
 * (RemoteInput — notification se hi jawab) + "Open chat". Schedule se pehle
 * ek baar register hona chahiye, isliye app start pe call hota hai.
 */
export async function registerNotificationActions(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: ACTION_TYPE_ID,
          actions: [
            { id: 'reply', title: 'Reply', input: true, inputPlaceholder: 'Misa ko likho…', inputButtonTitle: 'Send' },
            { id: 'open', title: 'Open chat' },
          ],
        },
      ],
    });
  } catch {
    // action register fail ho to bhi notification dikhegi — sirf reply/open buttons nahi
  }
}

/**
 * Native notification tap/reply listener. App background/locked me notification
 * pe action (reply/open/tap) karne par ye callback fire hota hai — sessionId
 * notification ke `extra` se aata hai. Web pe kuch register nahi hota.
 */
export async function onNotificationAction(
  handler: (action: NotificationActionPayload) => void,
): Promise<() => void> {
  if (!isNativePlatform()) return () => {};
  try {
    const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (res) => {
      const notification = res.notification as PendingLocalNotificationSchema | undefined;
      const extra = notification?.extra && typeof notification.extra === 'object' ? (notification.extra as { sessionId?: string }) : {};
      handler({ actionId: res.actionId, inputValue: res.inputValue, sessionId: extra.sessionId });
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}

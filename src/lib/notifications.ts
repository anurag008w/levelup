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
import { App } from '@capacitor/app';
import { LocalNotifications, type PendingLocalNotificationSchema } from '@capacitor/local-notifications';
import { IntentLauncher, ActivityAction } from '@capgo/capacitor-intent-launcher';
import { container } from '../di/container';
import { persistentStorage } from '../infra/storage/persistent-storage';
import { loadSession } from './auth';
import { resolveAppId } from './app-packaging';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** One bubble of the AI reply, for the native MessagingStyle conversation expand. */
export interface NotificationBubble {
  text: string;
  /** Unix ms timestamp when the bubble lands — default: fire moment. */
  at?: number;
  /** Kaun bhej raha hai — 'ai' (Misa) ya 'user' (username). Default: 'ai'. */
  sender?: 'ai' | 'user';
}

/** Web pe notification unsupported kyun hai — isse UI targeted message dikha sakta hai. */
export type NotificationUnsupportedReason = 'insecure' | 'api' | 'webview';

/** Notification action se reply/click handle karne wala listener type. */
export interface NotificationActionPayload {
  actionId: string;
  inputValue?: string;
  sessionId?: string;
}

/** persistentStorage key — notifications ON/OFF. */
const PREF_KEY = 'notifications';
/** Android NotificationManager ka id 32-bit int hota hai — isi liye modulo. */
const ANDROID_ID_MAX = 2_147_483_647;
/** Android 8+ notification channel — HIGH importance = heads-up + sound. */
const CHANNEL_ID = 'levelup-ai-replies';
/** Notification action type — inline reply + open chat actions. */
const ACTION_TYPE_ID = 'levelup-ai-reply';

/**
 * Whether the Chat tab is currently the active (visible) tab — set by App.tsx
 * whenever the user switches tabs. Combined with document visibility it lets
 * notifyAiReply skip alerts while the user is already watching the chat, so a
 * reply landing right in front of them never double-fires as a notification.
 * The flag is deliberately module-level (not per-session): while the user is
 * on the Chat tab no chat's reply should interrupt them.
 */
let chatTabActive = false;

export function setChatTabActive(active: boolean): void {
  chatTabActive = active;
}

export function isChatTabActive(): boolean {
  return chatTabActive;
}

/**
 * App foreground/background tracking. Android WebView background me JS timers
 * ko throttle/pause kar deta hai — isliye `setTimeout`-based notification
 * delays kabhi nahi chalti jab app background me ho. Is flag se hum background
 * ko detect karke native OS-level scheduling (`schedule.at`) use kar sakte
 * hain, jo timers par depend nahi karta.
 */
let appActive = true;

export function isAppActive(): boolean {
  return appActive;
}

/** App ke foreground/background state ko track karta hai. App start pe ek baar call karo. */
export function trackAppState(): void {
  if (typeof document !== 'undefined') {
    const syncFromVisibility = () => {
      appActive = !document.hidden;
    };
    document.addEventListener('visibilitychange', syncFromVisibility);
    syncFromVisibility();
  }
  if (isNativePlatform()) {
    try {
      App.addListener('appStateChange', ({ isActive }) => {
        appActive = isActive;
      });
    } catch {
      // visibilitychange fallback kafi hai
    }
  }
}

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
  // Per-flavor package id — settings intents must resolve the installed build
  // (Stable: com.anurag.levelup, Beta: com.anurag.levelup.beta).
  const appPkg = await resolveAppId();
  try {
    await IntentLauncher.startActivityAsync({
      action: ActivityAction.APP_NOTIFICATION_SETTINGS,
      extra: { 'android.provider.extra.APP_PACKAGE': appPkg },
    });
    return true;
  } catch {
    // Purane Android / kuch OEMs me app-specific notification settings intent fail ho sakta hai —
    // fallback: app details page (wahan Notifications option hota hai).
    try {
      await IntentLauncher.startActivityAsync({
        action: ActivityAction.APPLICATION_DETAILS_SETTINGS,
        data: `package:${appPkg}`,
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
 *
 * `body` (collapsed/heads-up text) aur optional `largeBody` (expandable full
 * text). Bubble reveal ke liye `body` = latest bubble rakho — Android collapsed
 * view multi-paragraph text ka pehla line hi dikhata hai, isliye cumulative
 * text ko body rakhne par har popup me pehla bubble hi dikhta hai. `largeBody`
 * (BigTextStyle) = poora reply so far, expand karne pe poora dikhta hai.
 *
 * `delayMs` (optional): notification ko itne milliseconds baad dikhao. Chat UI
 * reply ko bubble-by-bubble reveal karta hai (pehla bubble 3s baad, phir har
 * paragraph ke beech 3–8s) — doSend/reply-flow har bubble ke reveal moment pe
 * isse call karte hain (caller JS timer se, delayMs=0 → turant show/merge,
 * same sessionId = same notification id = purana merge). Ye fire-time approach
 * zaroori hai: OS-level pre-scheduling (delayMs>0) same id ke multiple pending
 * alarms ko plugin cancel kar deta hai, isliye sirf aakhri fire hota aur
 * bubble reveal kabhi dikhta nahi.
 *
 * BACKGROUND (native): Capacitor `KeepRunning` default true hai — WebView
 * background me JS timers pause nahi karta, isliye caller ke setTimeout-based
 * bubble updates app minimized/locked hone par bhi fire hote hain. Sirf jab
 * screen lambe time off ho (Doze) to timers throttle ho sakte hain; isliye
 * single delayed notifications ke liye OS-level absolute-time scheduling
 * (schedule.at + allowWhileIdle) — lock screen / Doze me bhi fire — ek option
 * rehta hai. Note: schedule.at same id ke andar previous pending schedule ko
 * cancel kar deta hai, isliye isse bubble-sequence ke liye use mat karo.
 */
export async function notifyAiReply(
  title: string,
  body: string,
  sessionId?: string,
  delayMs = 0,
  force = false,
  largeBody?: string,
  messages?: NotificationBubble[],
): Promise<void> {
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
  // Collapsed/heads-up body = `body`; expandable BigText = `largeBody` (ya body,
  // agar alag na diya ho). Bubble updates body me latest paragraph rakhte hain,
  // taaki har popup current message dikhaye (aur hamesha first bubble na).
  const expanded = largeBody ?? body;
  // Native patch ko MessagingStyle ke liye conversation chahiye (`messages`).
  // Siraf jab bubbles diye hain tab `extra` me jaata hai — nahi diye to payload
  // pehle jaisa hi rehta hai (existing behavior untouched). `userName` = phone
  // owner (MessagingStyle ka "user") — AI ke messages "Misa" se aate hain,
  // user ke apne messages owner name se. Owner name: login username pehle,
  // warna Settings > Profile ka naam; dono na ho to native title fallback.
  const extra: Record<string, unknown> = {};
  if (sessionId) extra.sessionId = sessionId;
  if (messages && messages.length > 0) {
    extra.messages = messages.map((m) => ({ text: m.text, at: m.at ?? Date.now(), sender: m.sender ?? 'ai' }));
    const ownerName = loadSession()?.username || container.store.get().userProfile?.name?.trim() || undefined;
    if (ownerName) extra.userName = ownerName;
  }

  // Background + delayed notification: JS timers throttled hote hain, isliye
  // setTimeout se kabhi fire nahi hogi. OS ko absolute time de do — Android
  // isse alarm ki tarah schedule karta hai aur app background/locked ho tab
  // bhi dikhata hai.
  //
  // `force` bhi isi path ko trigger karta hai: notification-actions.ts reply
  // flow me send complete hote hi app minimize ho jaati hai, isliye wahan bhi
  // JS timers fire hone ki guarantee nahi — chahe appActive is moment galat
  // "true" hi kyu na dikhe (Activity-resume race). force = "user definitely
  // nahi dekh raha", isliye OS-level scheduling hamesha safe hai.
  if (isNativePlatform() && (force || !appActive) && delayMs > 0) {
    try {
      await ensureNotificationChannel();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notificationId,
            title,
            body,
            largeBody: expanded,
            summaryText: title,
            channelId: CHANNEL_ID,
            actionTypeId: ACTION_TYPE_ID,
            extra,
            schedule: { at: new Date(Date.now() + delayMs), allowWhileIdle: true },
          },
        ],
      });
    } catch {
      // koi UI error nahi — notification best-effort hai
    }
    return;
  }

  const fire = async () => {
    // Chat tab active + app foreground = user is already watching the reply
    // bubble-by-bubble — don't push a notification on top of it. Jab app
    // background me ho (appActive false) to hamesha aati hai, kyunki user chat
    // nahi dekh raha. Ye check fire-time pe hota hai, isliye agar user reveal
    // ke beech me tab switch kare to agle bubbles ki notifications turant
    // chalu ho jaati hain.
    //
    // `force` isi check ko bypass karta hai — notification-actions.ts se
    // reply karne par Android us Activity ko launch/resume kar deta hai
    // (RemoteInput deliver karne ke liye), isliye appActive turant true ho
    // jaata hai, aur agar app pehle se chat tab pe tha to chatTabActive bhi
    // true rehta hai — bilkul "user dekh raha hai" jaisa lagta hai, jabki
    // user notification shade me tha aur reply ke baad app phir minimize ho
    // jaati hai. Us case me ye check hamesha AI ka reply-notification skip
    // kar deta tha. force=true caller ko batata hai ki "user definitely nahi
    // dekh raha" — sirf notification-actions.ts isse use karta hai.
    if (!force && chatTabActive && appActive) return;

    if (isNativePlatform()) {
      try {
        await ensureNotificationChannel();
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notificationId,
              title,
              // Collapsed (single-line) view ke liye body — Android khud
              // ellipsize kar deta hai agar lamba ho.
              body,
              // largeBody = BigTextStyle — expand/swipe-down karne par poora
              // (multi-line) message dikhta hai instead of cut-off single line.
              largeBody: expanded,
              summaryText: title,
              channelId: CHANNEL_ID,
              // Reply/Open actions + session id — tap/reply se app usi chat pe khule.
              actionTypeId: ACTION_TYPE_ID,
              extra,
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
          navigator.serviceWorker
            .getRegistration()
            .then((reg) => {
              if (reg) {
                void reg.showNotification(title, { body, tag, icon: '/favicon.svg' });
              } else if (typeof Notification !== 'undefined') {
                const n = new Notification(title, { body, tag });
                setTimeout(() => n.close(), 10_000);
              }
            })
            .catch(() => {});
          return;
        }
        if (typeof Notification !== 'undefined') {
          const n = new Notification(title, { body, tag });
          setTimeout(() => n.close(), 10_000);
        }
      } catch {
        // ignore
      }
    }
  };

  if (delayMs > 0) {
    setTimeout(() => void fire(), delayMs);
  } else {
    void fire();
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

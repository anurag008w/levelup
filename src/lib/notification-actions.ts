/**
 * Notification actions ka glue — native notification se app tak.
 *
 * Setup app start pe ek baar hota hai (`setupNotificationActions`):
 *  - "Reply" action (Android inline reply) → user ka text seedha usi chat
 *    session me send hota hai (container.chat.send) — app background/locked
 *    ho tab bhi.
 *
 *    Reply ka native path (stock plugin) Activity launch karta hai
 *    (PendingIntent.getActivity) — OS requirement hai taaki RemoteInput
 *    reliably deliver ho. Ye INTENTIONAL hai: Activity launch se WebView
 *    resume/init hota hai, jisse reply hamesha JS tak pahunchta hai aur AI ka
 *    HTTP call complete ho pata hai. Broadcast path (notification action ko
 *    Activity launch kiye bina JS bridge ko dena) rejected hai — background me
 *    WebView ready na ho to reply kabhi JS tak nahi pahunchta aur "Sending" pe
 *    atak jaata hai.
 *
 *    Minimize policy: app UI khula nahi rehna chahiye — user notification
 *    shade se reply kar raha hai. Isliye send shuru karte hi chhota grace
 *    (REPLY_GRACE_MS) dekar app turant minimize ho jaati hai (~1s). Capacitor
 *    default `KeepRunning=true` hai, isliye WebView background me JS timers aur
 *    fetch-streams continue karta hai — send minimize ke BAAD bhi complete hota
 *    hai. (Pehle "minimize karne se send freeze ho jaata hai" maana jaata tha;
 *    v0605/0606 ka stuck asli me broadcast path ki headless delivery ka issue
 *    tha, minimize ka nahi.)
 *
 *    Note: "reply se pehle app already foreground thi" wala check (`isAppActive`)
 *    reliable nahi hai — reply action Activity ko launch/resume kar deta hai,
 *    isliye handler chalta hai to app hamesha "active" dikhti hai (chahe process
 *    cold-start hua ho ya background se aaya ho). Isliye minimize unconditional
 *    hai: notification reply ka matlab hi hai ki user app UI me nahi hai.
 *
 *    Isi wajah se AI ka reply-notification bhi `notifyAiReply(..., force: true)`
 *    se bheja jaata hai — normal flow me notifyAiReply appActive+chatTabActive
 *    dono true hone par notification skip kar deta hai ("user already dekh raha
 *    hai"), par yahan wo dono galat-se true dikh sakte hain (upar wala note
 *    dekho), jisse reply-notification hi kabhi na aata — force isko bypass
 *    karta hai taaki reply hamesha notification pe aaye.
 *
 *    Reply notification bubble-by-bubble aati hai, bilkul chat UI jaisa reveal
 *    schedule (pehla bubble 3s, phir har paragraph ke beech 3–8s). HAR bubble
 *    apne reveal moment pe JS timer se fire hota hai (delayMs=0 → turant
 *    show/update, same sessionId = same id = merge). OS-level pre-scheduling
 *    (schedule.at) yahan use nahi hota — Android plugin same id ke pending
 *    alarms cancel kar deta hai, isliye pehle se schedule kiye steps me se sirf
 *    aakhri fire hota tha (poora reply, total delay ke baad — bubble reveal
 *    kabhi dikhta hi nahi tha).
 *
 *  - Tap / "Open chat" action → `levelup:open-chat` event dispatch hota hai,
 *    jise App.tsx sunke Chat tab khol deta hai aur usi session pe le jaata hai.
 *
 * Web pe ye module no-op hai (browser notifications inline reply support nahi
 * karte) — native APK ka real flow yahi hai.
 */
import { App } from '@capacitor/app';
import { container } from '../di/container';
import { buildNotificationSteps, computeRevealSchedule, splitReplyIntoBubbles } from '../features/chat/message-segments';
import { isNativePlatform, notifyAiReply, onNotificationAction, registerNotificationActions, trackAppState } from './notifications';

let setup = false;

/**
 * Reply events ka duplicate guard. Stock Activity-launch flow me reply ek
 * baar aata hai, par cold-start edge cases me same reply do baar aa sakta
 * hai (BridgeActivity.onCreate ka onNewIntent(getIntent()) + OS ka alag
 * onNewIntent delivery). Dono ka sessionId+inputValue same hota hai. Isse
 * message/AI-reply 2 baar na bheje jayein — 30s window ke andar duplicate
 * silently skip.
 */
const dedupeWindowMs = 30_000;
const seenReplies = new Map<string, number>();

/**
 * Reply aane par send shuru karte hi app ko minimize karne se pehle ka chhota
 * grace — AI request ko WebView se dispatch hone ka mauka. Iske baad app turant
 * background ho jaati hai (~1s); KeepRunning=true (Capacitor default) ki wajah
 * se send aur bubble timers background me chalte rahte hain.
 */
export const REPLY_GRACE_MS = 600;

function isDuplicateReply(sessionId: string, inputValue: string): boolean {
  const key = `${sessionId}:${inputValue.trim()}`;
  const now = Date.now();
  const last = seenReplies.get(key);
  // Purane keys hata do taaki map unbounded na bade.
  for (const [oldKey, at] of seenReplies) {
    if (now - at > dedupeWindowMs) seenReplies.delete(oldKey);
  }
  if (last !== undefined && now - last < dedupeWindowMs) {
    return true;
  }
  seenReplies.set(key, now);
  return false;
}

async function minimizeIfNative(): Promise<void> {
  if (isNativePlatform()) {
    try {
      await App.minimizeApp();
    } catch {
      // Android-only API — fail ho to bhi silently ignore karo
    }
  }
}

export function setupNotificationActions(): void {
  if (setup) return;
  setup = true;
  trackAppState();
  void registerNotificationActions();
  void onNotificationAction(({ actionId, inputValue, sessionId }) => {
    if (!sessionId) return;

    if (actionId === 'tap' || actionId === 'open') {
      window.dispatchEvent(new CustomEvent('levelup:open-chat', { detail: { sessionId } }));
      return;
    }

    if (actionId === 'reply' && inputValue && inputValue.trim()) {
      if (isDuplicateReply(sessionId, inputValue)) {
        return;
      }
      void (async () => {
        try {
          // Send turant shuru karo, phir request dispatch hone ke liye chhota
          // grace dekar app turant minimize — user notification shade se reply
          // kar raha hai, app UI khula nahi rehna chahiye. Capacitor
          // KeepRunning=true (default) → background WebView JS timers +
          // fetch-streams continue karte hain, isliye send minimize ke baad
          // bhi complete hota hai.
          const sendPromise = container.chat.send(sessionId, inputValue.trim());
          await new Promise((resolve) => setTimeout(resolve, REPLY_GRACE_MS));
          await minimizeIfNative();

          const assistant = await sendPromise;
          // Reply ko bhi chat UI jaisa hi reveal schedule mile: pehla bubble 3s
          // thinking pause ke baad, phir har paragraph ke beech 3–8s — poora
          // reply ek saath turant nahi, delay ke saath.
          const bubbles = splitReplyIntoBubbles(assistant.content);
          const schedule = computeRevealSchedule(bubbles.length);
          if (bubbles.length > 0) {
            // HAR bubble apne reveal moment pe JS timer se fire hota hai
            // (delayMs=0 + force=true → turant show/update, same sessionId =
            // same notification id = purana merge hoke update hota hai), bilkul
            // ChatScreen ke normal flow jaisa. OS-level pre-scheduling yahan
            // kaam nahi karta — Android plugin same id ke pending alarms cancel
            // kar deta hai, isliye pehle se schedule kiye steps me se sirf aakhri
            // fire hota (poora reply, total reveal delay ke baad) aur bubble
            // reveal kabhi dikhta nahi.
            //
            // Body = latest bubble (collapsed/heads-up — warna Android har
            // popup me cumulative text ka pehla line dikhata, "pehla message
            // har popup me" wala bug), largeBody = poora reply so far, messages
            // = native MessagingStyle expand ke liye (scrollable, full-length).
            for (const step of buildNotificationSteps(bubbles, schedule)) {
              setTimeout(() => void notifyAiReply('Misa', step.latest || 'Naya AI reply aaya', sessionId, 0, true, step.text, step.messages), step.delayMs);
            }
          } else {
            // Koi visible bubble nahi (sirf whitespace reply) — ek turant notification.
            void notifyAiReply('Misa', assistant.content.trim() || 'Naya AI reply aaya', sessionId, 0, true);
          }
        } catch {
          // session delete ho gaya ya AI off — chup rehna, koi error nahi dikhana
        } finally {
          // Chat UI agar khula ho to refresh ho jaye.
          window.dispatchEvent(new Event('levelup:chat-updated'));
        }
      })();
    }
  });
}

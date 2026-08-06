/**
 * Notification actions ka glue — native notification se app tak.
 *
 * Setup app start pe ek baar hota hai (`setupNotificationActions`):
 *  - "Reply" action (Android inline reply) → user ka text seedha usi chat
 *    session me send hota hai (container.chat.send) — app background/locked
 *    ho tab bhi.
 *
 *    Reply ka native path (patched plugin) ab broadcast-based hai:
 *      primary → NotificationActionReceiver (broadcast) reply ko JS bridge ko
 *               deta hai bina app ko foreground me laaye. App ka process alive
 *               ho to yehi hota hai — screen nahi khulti.
 *      fallback → process dead hone par receiver reply ko persist karta hai
 *               (agla open flush karega) AUR same intent se Activity launch
 *               try karta hai — launch allowed ho to reply TURANT JS tak
 *               pahunchta hai (purana working path), phir app turant wapas
 *               minimize ho jaati hai taaki visually app "khuli" na lage.
 *
 *    In dono paths se same reply 2 baar aaya to bhi sirf ek baar send hota
 *    hai — `dedupeReply` same sessionId+inputValue ko 30s window me ignore
 *    karta hai (cold-start pe persist-flush + Activity intent dono event
 *    bhejte hain).
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
 *  - Tap / "Open chat" action → `levelup:open-chat` event dispatch hota hai,
 *    jise App.tsx sunke Chat tab khol deta hai aur usi session pe le jaata hai.
 *
 * Web pe ye module no-op hai (browser notifications inline reply support nahi
 * karte) — native APK ka real flow yahi hai.
 */
import { App } from '@capacitor/app';
import { container } from '../di/container';
import { computeRevealSchedule, splitReplyIntoBubbles, totalRevealDelay } from '../features/chat/message-segments';
import { isNativePlatform, notifyAiReply, onNotificationAction, registerNotificationActions, trackAppState } from './notifications';

let setup = false;

/**
 * Reply events ka duplicate guard. Patched broadcast flow (process alive) se
 * ek baar event aata hai, par process-dead fallback me same reply 2 baar aa
 * sakta hai: (1) persist flush (load()) aur (2) Activity intent
 * (handleOnNewIntent). Dono ka sessionId+inputValue same hota hai. Isse
 * message/AI-reply 2 baar na bheje jayein — 30s window ke andar duplicate
 * silently skip.
 */
const dedupeWindowMs = 30_000;
const seenReplies = new Map<string, number>();

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
        // Screen ko kam se kam time ke liye khula rakho: reply action Android
        // ko Activity launch karni padti hai (OS requirement — RemoteInput ko
        // reliably deliver karne ke liye), isliye app UI flash hoti hai. User
        // notification shade se reply kar raha hai — app UI dikhane ki koi
        // zaroorat nahi. Turant minimize kar do, phir reply background me
        // process ho.
        await minimizeIfNative();
        try {
          const assistant = await container.chat.send(sessionId, inputValue.trim());
          const replyBody = assistant.content.trim() || 'Naya AI reply aaya';
          // Reply ko bhi chat UI jaisa hi reveal schedule mile: pehla bubble
          // 3s thinking pause ke baad, phir har paragraph ke beech 3–8s —
          // poora reply ek saath turant nahi, delay ke saath. Jab app
          // minimized/background ho, notifyAiReply is delay ko OS-level
          // (schedule.at) pe schedule karta hai — JS timers throttle hone par
          // bhi reply notification fire hoti hai.
          const bubbles = splitReplyIntoBubbles(assistant.content);
          const schedule = computeRevealSchedule(bubbles.length);
          const delayMs = bubbles.length > 0 ? totalRevealDelay(schedule) : 0;
          // force=true: Activity-resume ke baad appActive/chatTabActive dono
          // "true" dikh sakte hain (comment below), jo default guard ko galat
          // trigger karke reply-notification hi skip kara deta — force isse
          // bypass karta hai taaki reply hamesha notification pe aaye.
          void notifyAiReply('Misa', replyBody, sessionId, delayMs, true);
        } catch {
          // session delete ho gaya ya AI off — chup rehna, koi error nahi dikhana
        } finally {
          // Chat UI agar khula ho to refresh ho jaye.
          window.dispatchEvent(new Event('levelup:chat-updated'));
          // Double safety — upar minimize already ho chuka hai (turant), par
          // agar kisi wajah se fail hua ho to yahan pakka kar do.
          await minimizeIfNative();
        }
      })();
    }
  });
}

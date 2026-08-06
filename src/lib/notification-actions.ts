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
 *    resume/init hota hai, jisse AI ka HTTP call (chat.send) kisi paused/
 *    frozen WebView me phansne ke bajaye complete ho pata hai. Broadcast
 *    path (notification action ko Activity launch kiye bina JS bridge ko
 *    dena) isi liye rejected hai — background me WebView JS pause ho sakta
 *    hai aur phir reply "Sending" pe atak jaata hai (kabhi complete nahi
 *    hota). Reply process hone ke baad app hamesha wapas minimize ho jaati
 *    hai, taaki visually app "khuli" na mehsoos ho.
 *
 *    IMPORTANT: minimize ko kabhi bhi `chat.send` se PEHLE mat karo —
 *    Activity/WebView background ho jaane par AI HTTP call resolve nahi hota
 *    aur reply hamesha "Sending" pe stuck rehta hai. Pehle send poora karo,
 *    phir minimize (finally me).
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
 *    karta hai taaki reply hamesha notification pe aaye. Delay ke saath reply
 *    notification hamesha OS-level schedule.at pe jaati hai (force flag),
 *    kyunki send complete hone ke turant baad app minimize ho jaati hai aur
 *    JS timers fire hone ki guarantee nahi.
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
          // NO minimize yahan — pehle send poora karo. Reply action Activity
          // ko launch/resume kar chuka hai (stock plugin), isliye WebView alive
          // hai aur AI HTTP call resolve ho sakta hai. Agar yahan turant
          // minimize kar diya to WebView background/frozen ho jata hai aur
          // chat.send kabhi resolve nahi hota — reply hamesha "Sending" pe
          // atak jaata hai. Minimize sirf finally me (send complete hone ke
          // baad) hota hai.
          const assistant = await container.chat.send(sessionId, inputValue.trim());
          // Reply ko bhi chat UI jaisa hi reveal schedule mile: pehla bubble
          // 3s thinking pause ke baad, phir har paragraph ke beech 3–8s —
          // poora reply ek saath turant nahi, delay ke saath. Wohi schedule
          // notification ko bhi jaata hai (buildNotificationSteps — ek step
          // har bubble ke reveal moment pe, merged text ke saath), bilkul
          // ChatScreen ke normal flow jaisa. Jab app minimized/background ho,
          // notifyAiReply is delay ko OS-level (schedule.at) pe schedule
          // karta hai — JS timers throttle hone par bhi reply notification
          // fire hoti hai.
          const bubbles = splitReplyIntoBubbles(assistant.content);
          const schedule = computeRevealSchedule(bubbles.length);
          // force=true: Activity-resume ke baad appActive/chatTabActive dono
          // "true" dikh sakte hain (comment below), jo default guard ko galat
          // trigger karke reply-notification hi skip kara deta — force isse
          // bypass karta hai. Force ke saath delay hamesha OS-level schedule.at
          // hota hai, kyunki send ke baad app turant minimize ho jaati hai —
          // setTimeout-based delivery guarantee nahi hoti.
          for (const step of buildNotificationSteps(bubbles, schedule)) {
            void notifyAiReply('Misa', step.text || 'Naya AI reply aaya', sessionId, step.delayMs, true);
          }
        } catch {
          // session delete ho gaya ya AI off — chup rehna, koi error nahi dikhana
        } finally {
          // Chat UI agar khula ho to refresh ho jaye.
          window.dispatchEvent(new Event('levelup:chat-updated'));
          // Reply action Activity ko launch/resume kar chuka hai (user ab bhi
          // notification shade se interact kar raha tha, app UI me nahi) —
          // hamesha wapas minimize karo.
          await minimizeIfNative();
        }
      })();
    }
  });
}

/**
 * Notification actions ka glue — native notification se app tak.
 *
 * Setup app start pe ek baar hota hai (`setupNotificationActions`):
 *  - "Reply" action (Android inline reply) → user ka text seedha usi chat
 *    session me send hota hai (container.chat.send) — app background/locked
 *    ho tab bhi. Android RemoteInput ko reliably deliver karne ke liye ye
 *    Activity launch karta hai (OS requirement — bina Activity ke background
 *    broadcast se bridge/webview zyada tar guaranteed available nahi hota,
 *    khaaskar jab process pehle se kill ho chuka ho — isi wajah se reply
 *    "Sending" pe atak jaata tha aur kabhi complete nahi hota tha). Reply
 *    process hone ke baad app hamesha wapas minimize ho jaati hai, taaki
 *    visually app "khuli" na mehsoos ho.
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
import { isNativePlatform, notifyAiReply, onNotificationAction, registerNotificationActions, trackAppState } from './notifications';

let setup = false;

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
      void (async () => {
        try {
          const assistant = await container.chat.send(sessionId, inputValue.trim());
          // Poora reply notification me jaata hai — largeBody (BigTextStyle)
          // expand karke poora message dikhata hai, chahe kitna bhi bada ho.
          const replyBody = assistant.content.trim() || 'Naya AI reply aaya';
          // Title = "Misa" (sender), body = poora reply. Reply/open actions
          // same sessionId se hi kaam karte hain — title/body se independent.
          // force=true: is Activity-resume ke baad appActive/chatTabActive
          // dono "true" dikh sakte hain (neeche wala comment dekho), jo
          // notifyAiReply ke default guard ko galat trigger karke reply-
          // notification hi skip kara deta — force isse bypass karta hai.
          void notifyAiReply('Misa', replyBody, sessionId, 0, true);
        } catch {
          // session delete ho gaya ya AI off — chup rehna, koi error nahi dikhana
        } finally {
          // Chat UI agar khula ho to refresh ho jaye.
          window.dispatchEvent(new Event('levelup:chat-updated'));
          // App hamesha wapas minimize — reply action Activity ko launch/resume
          // kar chuka hai, isliye user ab notification se interact kar raha tha,
          // app UI me nahi. (isAppActive yahan hamesha true hota hai, isliye wo
          // check unreliable hai.)
          if (isNativePlatform()) {
            try {
              await App.minimizeApp();
            } catch {
              // Android-only API — fail ho to bhi silently ignore karo
            }
          }
        }
      })();
    }
  });
}

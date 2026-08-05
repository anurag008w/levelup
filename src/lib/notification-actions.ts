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
 *    process hone ke turant baad agar app pehle se foreground me nahi thi to
 *    hum use wapas minimize kar dete hain, taaki visually app "khuli" na
 *    mehsoos ho.
 *  - Tap / "Open chat" action → `levelup:open-chat` event dispatch hota hai,
 *    jise App.tsx sunke Chat tab khol deta hai aur usi session pe le jaata hai.
 *
 * Web pe ye module no-op hai (browser notifications inline reply support nahi
 * karte) — native APK ka real flow yahi hai.
 */
import { App } from '@capacitor/app';
import { container } from '../di/container';
import { isAppActive, isNativePlatform, notifyAiReply, onNotificationAction, registerNotificationActions, trackAppState } from './notifications';

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
      // Reply se pehle app already foreground me thi ya nahi — isi se decide
      // hota hai ki process ke baad minimize karna hai ya nahi (agar user
      // pehle se app use kar raha tha to use yahan se yank nahi karna).
      const wasActive = isAppActive();
      void (async () => {
        try {
          const assistant = await container.chat.send(sessionId, inputValue.trim());
          // Poora reply notification me jaata hai — largeBody (BigTextStyle)
          // expand karke poora message dikhata hai, chahe kitna bhi bada ho.
          const replyBody = assistant.content.trim() || 'Naya AI reply aaya';
          // Title = "Misa" (sender), body = poora reply. Reply/open actions
          // same sessionId se hi kaam karte hain — title/body se independent.
          void notifyAiReply('Misa', replyBody, sessionId);
        } catch {
          // session delete ho gaya ya AI off — chup rehna, koi error nahi dikhana
        } finally {
          // Chat UI agar khula ho to refresh ho jaye.
          window.dispatchEvent(new Event('levelup:chat-updated'));
          // App reply se pehle background/locked thi — process hone ke baad
          // wapas minimize taaki user ko UI na dikhe (jaisa pehle intent tha).
          if (!wasActive && isNativePlatform()) {
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

/**
 * Notification actions ka glue — native notification se app tak.
 *
 * Setup app start pe ek baar hota hai (`setupNotificationActions`):
 *  - "Reply" action (Android inline reply) → user ka text seedha usi chat
 *    session me send hota hai (container.chat.send) — app background/locked
 *    ho tab bhi, bina UI ke.
 *  - Tap / "Open chat" action → `levelup:open-chat` event dispatch hota hai,
 *    jise App.tsx sunke Chat tab khol deta hai aur usi session pe le jaata hai.
 *
 * Web pe ye module no-op hai (browser notifications inline reply support nahi
 * karte) — native APK ka real flow yahi hai.
 */
import { container } from '../di/container';
import { notifyAiReply, onNotificationAction, registerNotificationActions } from './notifications';

let setup = false;

export function setupNotificationActions(): void {
  if (setup) return;
  setup = true;
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
          // Poora reply notification me jaata hai (largeBody expand karke dikhega) —
          // 140 char ka purana hard cut yahan se hata diya, ab sirf ek generous
          // safety limit hai taaki notification bahut zyada bada na ho jaaye.
          const preview = assistant.content.replace(/\s+/g, ' ').trim().slice(0, 1000);
          const sessionTitle = container.chat.getSession(sessionId)?.title || 'Chat';
          // Reply notification se aaya — answer phir se notification me do taaki
          // user bina app khole hi AI ka jawab dekh sake. WhatsApp jaisa split:
          // title = chat ka naam, body = "Misa: message".
          void notifyAiReply(sessionTitle, `Misa: ${preview || 'Naya AI reply aaya'}`, sessionId);
        } catch {
          // session delete ho gaya ya AI off — chup rehna, koi error nahi dikhana
        } finally {
          // User ko usi chat pe le jao taaki exchange dikhe.
          window.dispatchEvent(new CustomEvent('levelup:open-chat', { detail: { sessionId } }));
          window.dispatchEvent(new Event('levelup:chat-updated'));
        }
      })();
    }
  });
}

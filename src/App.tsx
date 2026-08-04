import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import TabBar, { type Tab } from './components/TabBar';
import TodayScreen from './screens/TodayScreen';
import LoginScreen from './screens/LoginScreen';
import { useAppState } from './lib/useAppState';
import { clearSession, ensureV1Base, loadSession, saveSession, type AuthSession } from './lib/auth';
import { container } from './di/container';
import { setupNotificationActions } from './lib/notification-actions';
import { setChatTabActive } from './lib/notifications';
import ScreenSkeleton from './components/ScreenSkeleton';

const LevelsScreen = lazy(() => import('./screens/LevelsScreen'));
const ProgressScreen = lazy(() => import('./screens/ProgressScreen'));
const ReviewScreen = lazy(() => import('./screens/ReviewScreen'));
const TaskBankScreen = lazy(() => import('./screens/TaskBankScreen'));
const AISettingsScreen = lazy(() => import('./screens/AISettingsScreen'));
const UpdatesScreen = lazy(() => import('./screens/UpdatesScreen'));
const ChatScreen = lazy(() => import('./screens/ChatScreen'));

const pageSpring = { type: 'tween', duration: 0.32, ease: [0.2, 0, 0, 1] } as const;

export default function App() {
  const { state, today, update, refresh, resetAll, adminUnlocked, unlockAdmin, lockAdmin, setAdminDay } = useAppState();
  const [tab, setTab] = useState<Tab>('today');
  // Once the user has opened the coach, keep it mounted across tab switches so
  // an in-flight AI stream survives (a fresh chat reply must not die just
  // because the user peeked at another tab). Hidden screens keep running.
  const [chatVisited, setChatVisited] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());
  const [guest, setGuest] = useState(() => localStorage.getItem('levelup:guest') === 'true');
  // Notification tap/reply se aaya target session — ChatScreen isse activeId
  // bana leta hai aur App value clear kar deta hai (onTargetConsumed).
  const [targetChatSessionId, setTargetChatSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'chat') setChatVisited(true);
  }, [tab]);

  // Tell the notifications service whether the user is looking at the Chat
  // tab, so AI-reply alerts are suppressed while the chat is the active tab
  // (they fire again as soon as the user switches to any other tab or the app
  // goes to the background).
  useEffect(() => {
    setChatTabActive(tab === 'chat');
  }, [tab]);

  // Notification actions (native): inline reply / tap → chat kholo.
  // Listen `levelup:open-chat` from notification-actions and jump to Chat tab.
  useEffect(() => {
    setupNotificationActions();
    const onOpenChat = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string }>).detail;
      if (!detail?.sessionId) return;
      setTargetChatSessionId(detail.sessionId);
      setChatVisited(true);
      setTab('chat');
    };
    window.addEventListener('levelup:open-chat', onOpenChat);
    return () => window.removeEventListener('levelup:open-chat', onOpenChat);
  }, []);

  // Auto-wire the app's DEFAULT (hidden) provider to the logged-in server:
  // baseUrl = server/v1, apiKey = the user's own sk- key, so the gateway can
  // enforce per-user quotas. The provider stays hidden — no visible card, no
  // URL or key anywhere in the UI. Runs on login and on restart (self-healing).
  useEffect(() => {
    if (!session) return;
    container.providerSettings.configureServerAuth(ensureV1Base(session.serverUrl), session.apiKey);
    container.syncCoordinator.attach(session);
  }, [session]);

  function handleLoggedIn(next: AuthSession) {
    saveSession(next);
    localStorage.removeItem('levelup:guest');
    setGuest(false);
    setSession(next);
    setTab('today');
  }

  // Guest (skipped login): app runs fully offline — data stays in localStorage,
  // no server model, no sync. Server auth is disabled so nothing leaks.
  function handleGuestMode() {
    container.providerSettings.disableServerAuth();
    localStorage.setItem('levelup:guest', 'true');
    setGuest(true);
    setTab('today');
  }

  function handleLogout() {
    container.syncCoordinator.detach();
    clearSession();
    localStorage.removeItem('levelup:guest');
    setSession(null);
    setGuest(false);
    setTab('today');
  }

  // App-start login gate: levelup content only appears after authentication
  // (or after the user explicitly skips into offline/guest mode).
  if (!session && !guest) {
    return <LoginScreen onLoggedIn={handleLoggedIn} onSkip={handleGuestMode} />;
  }

  function renderScreen() {
    switch (tab) {
      case 'today':
        return (
          <TodayScreen
            state={state}
            today={today}
            update={update}
            adminUnlocked={adminUnlocked}
            onUnlockAdmin={unlockAdmin}
            onLockAdmin={lockAdmin}
            onSetAdminDay={setAdminDay}
          />
        );
      case 'levels':
        return <LevelsScreen state={state} today={today} update={update} />;
      case 'progress':
        return <ProgressScreen state={state} today={today} />;
      case 'review':
        return (
          <ReviewScreen state={state} today={today} update={update} resetAll={resetAll} />
        );
      case 'task-bank':
        return <TaskBankScreen state={state} update={update} />;
      case 'ai':
        return <AISettingsScreen state={state} update={update} session={session} onLogout={handleLogout} />;
      case 'updates':
        return <UpdatesScreen />;
      case 'chat':
        // Rendered separately below so it never unmounts on tab switch.
        return null;
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <AnimatePresence mode="wait" initial={false}>
        {tab !== 'chat' && (
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={pageSpring}
          >
            <Suspense fallback={<ScreenSkeleton />}>{renderScreen()}</Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      {(chatVisited || tab === 'chat') && (
        <div style={{ display: tab === 'chat' ? undefined : 'none' }} aria-hidden={tab !== 'chat'}>
          <ChatScreen
            targetSessionId={targetChatSessionId}
            onTargetConsumed={() => setTargetChatSessionId(null)}
          />
        </div>
      )}
      <TabBar
        active={tab}
        state={state}
        update={update}
        onChange={(next) => {
          if (next !== tab) {
            refresh();
            setTab(next);
          }
        }}
      />
    </div>
  );
}

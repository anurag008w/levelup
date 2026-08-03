import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import TabBar, { type Tab } from './components/TabBar';
import TodayScreen from './screens/TodayScreen';
import LoginScreen from './screens/LoginScreen';
import { useAppState } from './lib/useAppState';
import { buildServerProvider, clearSession, loadSession, saveSession, type AuthSession } from './lib/auth';
import ScreenSkeleton from './components/ScreenSkeleton';

const LevelsScreen = lazy(() => import('./screens/LevelsScreen'));
const ProgressScreen = lazy(() => import('./screens/ProgressScreen'));
const ReviewScreen = lazy(() => import('./screens/ReviewScreen'));
const TaskBankScreen = lazy(() => import('./screens/TaskBankScreen'));
const AISettingsScreen = lazy(() => import('./screens/AISettingsScreen'));
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

  useEffect(() => {
    if (tab === 'chat') setChatVisited(true);
  }, [tab]);

  // Auto-wire the server provider ("My Server") after login: the app's chat
  // routes through the gateway with the user's own sk- key, so the server can
  // enforce per-user quotas. Self-healing on restart — a removed provider is
  // re-created as long as a session exists.
  useEffect(() => {
    if (!session) return;
    update((s) => {
      const provider = buildServerProvider(session);
      const existing = s.aiSettings.providers.rotator;
      if (existing && existing.baseUrl === provider.baseUrl && existing.apiKey === provider.apiKey && existing.enabled) {
        return s;
      }
      return {
        ...s,
        aiSettings: {
          ...s.aiSettings,
          aiEnabled: true,
          activeProviderId: 'rotator',
          providers: { ...s.aiSettings.providers, rotator: provider },
        },
      };
    });
  }, [session]);

  function handleLoggedIn(next: AuthSession) {
    saveSession(next);
    setSession(next);
    setTab('today');
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    setTab('today');
  }

  // App-start login gate: levelup content only appears after authentication.
  if (!session) {
    return <LoginScreen onLoggedIn={handleLoggedIn} />;
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
          <ChatScreen />
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

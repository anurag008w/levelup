import { Suspense, lazy, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import TabBar, { type Tab } from './components/TabBar';
import TodayScreen from './screens/TodayScreen';
import { useAppState } from './lib/useAppState';
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
        return <LevelsScreen state={state} today={today} />;
      case 'progress':
        return <ProgressScreen state={state} today={today} />;
      case 'review':
        return (
          <ReviewScreen state={state} today={today} update={update} resetAll={resetAll} />
        );
      case 'task-bank':
        return <TaskBankScreen state={state} update={update} />;
      case 'ai':
        return <AISettingsScreen state={state} update={update} />;
      case 'chat':
        return <ChatScreen />;
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={pageSpring}
        >
          <Suspense fallback={<ScreenSkeleton />}>{renderScreen()}</Suspense>
        </motion.div>
      </AnimatePresence>
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

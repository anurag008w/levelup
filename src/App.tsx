import { useState } from 'react';
import TabBar, { type Tab } from './components/TabBar';
import TodayScreen from './screens/TodayScreen';
import LevelsScreen from './screens/LevelsScreen';
import ProgressScreen from './screens/ProgressScreen';
import ReviewScreen from './screens/ReviewScreen';
import AISettingsScreen from './screens/AISettingsScreen';
import ChatScreen from './screens/ChatScreen';
import TaskBankScreen from './screens/TaskBankScreen';
import { useAppState } from './lib/useAppState';

export default function App() {
  const { state, today, update, refresh, resetAll } = useAppState();
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className="min-h-screen bg-bg text-text">
      {tab === 'today' && <TodayScreen state={state} today={today} update={update} />}
      {tab === 'levels' && <LevelsScreen state={state} today={today} />}
      {tab === 'progress' && <ProgressScreen state={state} today={today} />}
      {tab === 'review' && <ReviewScreen state={state} today={today} update={update} resetAll={resetAll} />}
      {tab === 'task-bank' && <TaskBankScreen state={state} update={update} />}
      {tab === 'ai' && <AISettingsScreen state={state} update={update} />}
      {tab === 'chat' && <ChatScreen />}
      <TabBar
        active={tab}
        onChange={(next) => {
          refresh();
          setTab(next);
        }}
      />
    </div>
  );
}

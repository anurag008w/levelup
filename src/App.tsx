import { useState } from 'react';
import TabBar, { type Tab } from './components/TabBar';
import TodayScreen from './screens/TodayScreen';
import LevelsScreen from './screens/LevelsScreen';
import ProgressScreen from './screens/ProgressScreen';
import ReviewScreen from './screens/ReviewScreen';
import { useAppState } from './lib/useAppState';

export default function App() {
  const { state, today, update, resetAll } = useAppState();
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className="min-h-screen bg-bg text-text">
      {tab === 'today' && <TodayScreen state={state} today={today} update={update} />}
      {tab === 'levels' && <LevelsScreen state={state} today={today} />}
      {tab === 'progress' && <ProgressScreen state={state} today={today} />}
      {tab === 'review' && <ReviewScreen state={state} today={today} update={update} resetAll={resetAll} />}
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}

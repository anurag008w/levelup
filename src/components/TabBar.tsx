import { motion } from 'framer-motion';
import { Bot, CalendarCheck, LayoutList, LineChart, ListTodo, MessageCircle, NotebookPen } from 'lucide-react';

export type Tab = 'today' | 'levels' | 'progress' | 'review' | 'task-bank' | 'ai' | 'chat';

const TABS: { id: Tab; label: string; icon: typeof CalendarCheck }[] = [
  { id: 'today', label: 'Today', icon: CalendarCheck },
  { id: 'levels', label: 'Levels', icon: LayoutList },
  { id: 'progress', label: 'Progress', icon: LineChart },
  { id: 'review', label: 'Review', icon: NotebookPen },
  { id: 'task-bank', label: 'Tasks', icon: ListTodo },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'ai', label: 'AI', icon: Bot },
];

const TAB_PCT = 100 / TABS.length;
const pillSpring = { type: 'spring', stiffness: 480, damping: 38, mass: 0.9 } as const;

export default function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.id === active));

  return (
    <nav
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Primary"
    >
      <div className="relative mx-auto flex max-w-[27.5rem] items-stretch px-1" style={{ height: '4rem' }}>
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl"
          initial={false}
          animate={{ left: `${activeIndex * TAB_PCT}%`, width: `${TAB_PCT}%` }}
          transition={pillSpring}
          style={{
            top: '0.375rem',
            bottom: '0.375rem',
            backgroundColor: 'rgba(79,209,197,0.13)',
            border: '1px solid rgba(79,209,197,0.32)',
            boxShadow: '0 0 0 1px rgba(79,209,197,0.04)',
          }}
        />
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
              className="relative z-10 flex flex-1 items-center justify-center"
              style={{ minHeight: '3rem' }}
            >
              <span className="flex flex-col items-center gap-1">
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.5 : 2}
                  style={{
                    color: isActive ? 'var(--color-l)' : 'var(--color-muted)',
                    transition: 'color 0.2s ease',
                  }}
                />
                <span
                  className="text-[10.5px] font-medium leading-none tracking-wide"
                  style={{
                    color: isActive ? 'var(--color-text)' : 'var(--color-muted)',
                    transition: 'color 0.2s ease',
                  }}
                >
                  {label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

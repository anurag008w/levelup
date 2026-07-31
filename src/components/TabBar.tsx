import { Bot, CalendarCheck, LayoutList, LineChart, ListTodo, MessageCircle, NotebookPen } from 'lucide-react';

export type Tab = 'today' | 'levels' | 'progress' | 'review' | 'task-bank' | 'ai' | 'chat';

const TABS: { id: Tab; label: string; icon: typeof CalendarCheck }[] = [
  { id: 'today', label: 'Today', icon: CalendarCheck },
  { id: 'levels', label: 'Levels', icon: LayoutList },
  { id: 'progress', label: 'Progress', icon: LineChart },
  { id: 'review', label: 'Review', icon: NotebookPen },
  { id: 'task-bank', label: 'Tasks', icon: ListTodo },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
];

export default function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-panel/90 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={isActive ? 'page' : undefined}
              className="group relative flex flex-1 flex-col items-center gap-1 px-0.5 py-2.5 transition-colors"
            >
              <span
                className="flex h-7 w-12 items-center justify-center rounded-full transition-all duration-200"
                style={{
                  backgroundColor: isActive ? 'rgba(79,209,197,0.14)' : 'transparent',
                }}
              >
                <Icon
                  size={19}
                  strokeWidth={isActive ? 2.4 : 2}
                  style={{
                    color: isActive ? 'var(--color-l)' : 'var(--color-muted)',
                    transition: 'color 0.2s ease',
                  }}
                />
              </span>
              <span
                className="font-mono text-[9px] tracking-wide transition-colors"
                style={{ color: isActive ? 'var(--color-text)' : 'var(--color-muted)' }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

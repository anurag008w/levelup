import { CalendarCheck, LayoutList, LineChart, NotebookPen } from 'lucide-react';

export type Tab = 'today' | 'levels' | 'progress' | 'review';

const TABS: { id: Tab; label: string; icon: typeof CalendarCheck }[] = [
  { id: 'today', label: 'Today', icon: CalendarCheck },
  { id: 'levels', label: 'Levels', icon: LayoutList },
  { id: 'progress', label: 'Progress', icon: LineChart },
  { id: 'review', label: 'Review', icon: NotebookPen },
];

export default function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 border-t border-border bg-panel/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors"
            >
              <Icon size={20} strokeWidth={2} color={isActive ? 'var(--color-light)' : 'var(--color-muted)'} />
              <span
                className="font-mono text-[10px] tracking-wide"
                style={{ color: isActive ? 'var(--color-light)' : 'var(--color-muted)' }}
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

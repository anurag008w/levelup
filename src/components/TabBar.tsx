import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarCheck, LayoutList, LineChart, ListTodo, Menu, MessageCircle, NotebookPen, Settings, X } from 'lucide-react';

export type Tab = 'today' | 'levels' | 'progress' | 'review' | 'task-bank' | 'ai' | 'chat';

const TABS: { id: Tab; label: string; hint: string; icon: typeof CalendarCheck }[] = [
  { id: 'today', label: 'Today', hint: 'Daily mission', icon: CalendarCheck },
  { id: 'levels', label: 'Levels', hint: 'Growth map', icon: LayoutList },
  { id: 'progress', label: 'Progress', hint: 'Analytics', icon: LineChart },
  { id: 'review', label: 'Review', hint: 'Reflect', icon: NotebookPen },
  { id: 'task-bank', label: 'Tasks', hint: 'Bank', icon: ListTodo },
  { id: 'chat', label: 'AI Coach', hint: 'Doubts & maths', icon: MessageCircle },
  { id: 'ai', label: 'Settings', hint: 'App & AI', icon: Settings },
];

const sidebarSpring = { type: 'tween', duration: 0.32, ease: [0.2, 0, 0, 1] } as const;
const SWIPE_EDGE_PX = 32;
const SWIPE_DISTANCE_PX = 64;

export default function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const [handleVisible, setHandleVisible] = useState(true);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let frame = 0;

    function updateHandleVisibility() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        setHandleVisible(scrollTop < 72);
        frame = 0;
      });
    }

    updateHandleVisibility();
    window.addEventListener('scroll', updateHandleVisibility, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateHandleVisibility);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch) return;
      touchStart.current = { x: touch.clientX, y: touch.clientY };
    }

    function onTouchEnd(event: TouchEvent) {
      const start = touchStart.current;
      const touch = event.changedTouches[0];
      touchStart.current = null;
      if (!start || !touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = Math.abs(touch.clientY - start.y);
      const startedAtEdge = start.x <= SWIPE_EDGE_PX;
      const isIntentionalRightSwipe = deltaX >= SWIPE_DISTANCE_PX && deltaY < 72;
      if (!open && startedAtEdge && isIntentionalRightSwipe) setOpen(true);
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [open]);

  function selectTab(next: Tab) {
    onChange(next);
    setOpen(false);
  }

  const activeTab = TABS.find((item) => item.id === active) ?? TABS[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="nav-handle"
        aria-label="Open navigation menu"
        aria-expanded={open}
        data-visible={open || handleVisible}
      >
        <Menu size={20} />
        <span className="nav-handle-label">{activeTab.label}</span>
      </button>

      <div className="swipe-edge" aria-hidden="true" />

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              className="nav-scrim"
              aria-label="Close navigation menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.nav
              className="side-nav"
              aria-label="Primary"
              initial={{ x: '-105%' }}
              animate={{ x: 0 }}
              exit={{ x: '-105%' }}
              transition={sidebarSpring}
            >
              <div className="side-nav-head">
                <div>
                  <p className="eyebrow">LevelUp</p>
                  <h2 className="font-display text-xl font-bold">Navigation</h2>
                </div>
                <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close navigation menu">
                  <X size={18} />
                </button>
              </div>

              <div className="side-nav-list">
                {TABS.map(({ id, label, hint, icon: Icon }) => {
                  const isActive = active === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectTab(id)}
                      aria-current={isActive ? 'page' : undefined}
                      className="side-nav-item"
                    >
                      <span className="side-nav-icon" data-active={isActive}>
                        <Icon size={19} strokeWidth={isActive ? 2.6 : 2} />
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block truncate font-display text-[15px] font-bold">{label}</span>
                        <span className="block truncate text-xs text-muted">{hint}</span>
                      </span>
                      {isActive && <motion.span layoutId="side-nav-dot" className="side-nav-dot" />}
                    </button>
                  );
                })}
              </div>

              <div className="side-nav-foot">
                <p className="text-xs leading-relaxed text-muted">Swipe right from the left edge anytime to bring this sidebar back.</p>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

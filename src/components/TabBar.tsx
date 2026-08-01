import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, CalendarCheck, ChevronRight, LayoutList, LineChart, ListTodo, MessageCircle, NotebookPen, PanelLeft, Settings, User, X } from 'lucide-react';
import type { AppState, UserProfile } from '../types';

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

interface TabBarProps {
  active: Tab;
  state: AppState;
  onChange: (t: Tab) => void;
  update: (fn: (s: AppState) => AppState) => void;
}

export default function TabBar({ active, state, onChange, update }: TabBarProps) {
  const [open, setOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<'profile' | 'memory' | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (settingsPanel) setSettingsPanel(null);
      else setOpen(false);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsPanel]);

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

  const profile = state.userProfile;
  const memoryItems = [...state.memory.summaries, ...state.memory.entries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 24);

  function updateProfile(field: keyof UserProfile, value: string) {
    update((s) => ({
      ...s,
      userProfile: {
        ...s.userProfile,
        [field]: value,
      },
    }));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="nav-handle"
        aria-label="Open navigation menu"
        aria-expanded={open}
        data-visible
      >
        <PanelLeft size={19} strokeWidth={2.15} />
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
                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Settings</p>
                <button type="button" className="side-nav-settings-row" onClick={() => setSettingsPanel('profile')}>
                  <span className="side-nav-icon compact"><User size={15} /></span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold text-text">Profile</span>
                    <span className="block truncate text-xs text-muted">AI personalization context</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button type="button" className="side-nav-settings-row" onClick={() => setSettingsPanel('memory')}>
                  <span className="side-nav-icon compact"><Brain size={15} /></span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold text-text">Memory</span>
                    <span className="block truncate text-xs text-muted">{state.memory.entries.length + state.memory.summaries.length} saved items</span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>

        {settingsPanel && (
          <SettingsModal title={settingsPanel === 'profile' ? 'User profile' : 'AI memory'} onClose={() => setSettingsPanel(null)}>
            {settingsPanel === 'profile' ? (
              <div className="space-y-4">
                <div className="settings-modal-hero">
                  <span className="settings-modal-avatar"><User size={20} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-text">{profile.name || 'User profile'}</p>
                    <p className="text-sm text-muted">AI personalization context</p>
                  </div>
                </div>
                <div className="grid gap-3">
                  <ProfileField label="Name" value={profile.name} onChange={(value) => updateProfile('name', value)} placeholder="Your name" />
                  <ProfileField label="Class / level" value={profile.classLevel} onChange={(value) => updateProfile('classLevel', value)} placeholder="Class 11, dropper..." />
                  <ProfileField label="Exam target" value={profile.examTarget} onChange={(value) => updateProfile('examTarget', value)} placeholder="JEE Main, Advanced..." />
                  <ProfileField label="Study style" value={profile.studyStyle} onChange={(value) => updateProfile('studyStyle', value)} placeholder="Short drills, deep work..." />
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Notes</span>
                    <textarea
                      value={profile.notes}
                      onChange={(e) => updateProfile('notes', e.target.value)}
                      className="field min-h-28 resize-none text-sm"
                      placeholder="Anything Divya should remember while coaching."
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-border bg-panel-raised p-3">
                  <p className="text-sm font-semibold text-text">Saved coaching memory</p>
                  <span className="font-mono text-[10px] text-muted">{state.memory.entries.length + state.memory.summaries.length} items</span>
                </div>
                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                  {memoryItems.length > 0 ? (
                    memoryItems.map((entry) => (
                      <article key={entry.id} className="rounded-lg border border-border bg-panel-raised p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="badge">{entry.type}</span>
                          <span className="font-mono text-[10px] text-muted">{new Date(entry.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm leading-relaxed text-muted">{entry.content}</p>
                      </article>
                    ))
                  ) : (
                    <p className="rounded-lg border border-border bg-panel-raised p-4 text-sm leading-relaxed text-muted">No memory entries yet.</p>
                  )}
                </div>
              </div>
            )}
          </SettingsModal>
        )}
    </>
  );
}

function ProfileField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="field min-h-9 py-1.5 text-xs" placeholder={placeholder} />
    </label>
  );
}


function SettingsModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="settings-modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="settings-modal-scrim" aria-label="Close settings popup" onClick={onClose} />
      <motion.section
        className="settings-modal"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: 'tween', duration: 0.18, ease: [0.2, 0, 0, 1] }}
      >
        <header className="settings-modal-head">
          <div>
            <p className="eyebrow">Settings</p>
            <h2 className="font-display text-xl font-bold text-text">{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings popup"><X size={18} /></button>
        </header>
        <div className="settings-modal-body">{children}</div>
      </motion.section>
    </div>
  );
}

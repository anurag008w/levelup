import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, GraduationCap, Lightbulb, ListChecks, Lock, Sparkles, Unlock } from 'lucide-react';
import { LEVELS, PHASES } from '../data/curriculum';
import type { AppState } from '../types';
import { getCurrentDayNumber, getHabitsByLevel, getLevelStatus, getTasksByLevel, type LevelStatus } from '../lib/engine';
import { phaseAccent } from '../lib/phaseColors';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';

export default function LevelsScreen({ state, today }: { state: AppState; today: string }) {
  const dayNumber = getCurrentDayNumber(state, today);
  const currentLevelId = LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd)?.id ?? null;
  // Sirf current level default open — baaki collapsed.
  const [openId, setOpenId] = useState<number | null>(currentLevelId);

  const clearedAll = LEVELS.filter((l) => getLevelStatus(l, state, dayNumber) === 'cleared').length;

  function toggle(id: number) {
    haptic(8);
    setOpenId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="screen fade-up">
      <div className="mb-4">
        <SectionHeader
          icon={<ListChecks size={15} color="var(--color-l)" />}
          accent="var(--color-l)"
          title="JEE Block"
          meta={`${clearedAll}/${LEVELS.length}`}
        />
      </div>

      <div className="relative space-y-2.5">
        {/* timeline track */}
        <div className="absolute bottom-4 left-[3px] top-3 w-[2px] rounded-full bg-grid" aria-hidden="true" />

        {LEVELS.map((level) => {
          const status = getLevelStatus(level, state, dayNumber);
          const isOpen = openId === level.id;
          const phase = PHASES.find((p) => p.id === level.phase);
          const accent = phaseAccent(phase?.color ?? 'core');
          const levelHabits = level.authored ? getHabitsByLevel(level.id) : [];
          const levelTasks = level.authored ? getTasksByLevel(level.id) : [];
          const activeNow = status === 'active';
          const clearedLevel = status === 'cleared';

          return (
            <div key={level.id} className="relative">
              <span
                className={`absolute left-[-3px] top-4 z-10 h-3.5 w-3.5 rounded-full border-2 transition-all ${activeNow ? 'pulse-dot' : ''}`}
                style={{
                  borderColor: statusColor(status),
                  backgroundColor: clearedLevel || activeNow ? statusColor(status) : 'var(--color-bg)',
                }}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => toggle(level.id)}
                aria-expanded={isOpen}
                className="card card-press w-full p-3.5 text-left transition-colors"
                style={{
                  borderColor: activeNow ? 'rgba(245,179,103,0.5)' : clearedLevel ? 'rgba(52,211,153,0.3)' : 'var(--color-border)',
                  backgroundColor: activeNow ? 'rgba(245,179,103,0.05)' : clearedLevel ? 'rgba(52,211,153,0.04)' : undefined,
                  opacity: status === 'locked' ? 0.55 : 1,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] tracking-widest text-muted">
                      LVL-{String(level.id).padStart(2, '0')} · DAYS {level.dayStart}–{level.dayEnd}
                    </p>
                    <p className="mt-0.5 truncate font-display text-[15px] font-bold tracking-tight">{level.title}</p>
                  </div>
                  <StatusBadge status={status} />
                </div>

                {phase && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="chip" style={{ color: accent, borderColor: `${accent}44`, backgroundColor: `${accent}14` }}>
                      {phase.title}
                    </span>
                  </div>
                )}

                {clearedLevel && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="badge" style={{ backgroundColor: 'rgba(52,211,153,0.14)', color: 'var(--color-success)' }}>
                      <Sparkles size={10} /> Level cleared
                    </span>
                  </div>
                )}

                {level.authored && levelHabits.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {levelHabits.slice(0, 3).map((h) => (
                      <span key={h.id} className="chip">
                        {h.name}
                      </span>
                    ))}
                    {levelHabits.length > 3 && <span className="chip">+{levelHabits.length - 3}</span>}
                  </div>
                )}

                <div className="mt-2.5 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    {isOpen ? 'Collapse' : 'Details dekho'}
                  </span>
                  {activeNow && (
                    <span className="flex items-center gap-1 font-mono text-[10px] font-semibold text-light">
                      <Clock3 size={11} /> In progress
                    </span>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="card mt-2.5 p-4 text-sm slide-up" style={{ backgroundColor: 'var(--color-panel-raised)' }}>
                  {!level.authored ? (
                    <p className="text-muted">Ye level ka poora content agle update mein add hoga.</p>
                  ) : (
                    <>
                      <DetailBlock title="New Habits" icon={<GraduationCap size={15} color="var(--color-l)" />}>
                        <ul className="space-y-2">
                          {levelHabits.map((h) => (
                            <li key={h.id} className="text-muted">
                              <span className="font-semibold text-text">{h.name}</span>
                              <span className="text-xs"> · {h.timeRequired}</span>
                              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{h.criteria}</p>
                            </li>
                          ))}
                        </ul>
                      </DetailBlock>
                      <DetailBlock title="Daily Tasks" icon={<ListChecks size={15} color="var(--color-light)" />}>
                        <ul className="list-disc space-y-1.5 pl-5 text-muted">
                          {levelTasks.map((t) => (
                            <li key={t.id} className="leading-relaxed">{t.text}</li>
                          ))}
                        </ul>
                      </DetailBlock>
                      <DetailBlock title="Pass & Unlock" icon={<Unlock size={15} color="var(--color-peak)" />}>
                        <p className="leading-relaxed text-muted">{level.passCriteria}</p>
                        <p className="mt-1.5 leading-relaxed text-muted">{level.unlockCondition}</p>
                      </DetailBlock>
                      {level.commonMistakes.length > 0 && (
                        <DetailBlock title="Common Mistakes" icon={<AlertTriangle size={15} color="var(--color-danger)" />}>
                          <ul className="list-disc space-y-1.5 pl-5 text-muted">
                            {level.commonMistakes.map((m, i) => (
                              <li key={i} className="leading-relaxed">{m}</li>
                            ))}
                          </ul>
                        </DetailBlock>
                      )}
                      <DetailBlock title="JEE Benefit" icon={<Lightbulb size={15} color="var(--color-light)" />}>
                        <p className="leading-relaxed text-muted">{level.jeeBenefit}</p>
                      </DetailBlock>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailBlock({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 flex items-center gap-1.5 font-display text-[13px] font-bold">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function statusColor(status: LevelStatus): string {
  switch (status) {
    case 'cleared':
      return 'var(--color-success)';
    case 'active':
      return 'var(--color-light)';
    case 'needs-recovery':
      return 'var(--color-danger)';
    default:
      return 'var(--color-border-strong)';
  }
}

function StatusBadge({ status }: { status: LevelStatus }) {
  const color = statusColor(status);
  switch (status) {
    case 'cleared':
      return (
        <span className="flex shrink-0 items-center gap-1">
          <CheckCircle2 size={20} color={color} />
        </span>
      );
    case 'active':
      return (
        <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold" style={{ borderColor: `${color}88`, color, backgroundColor: `${color}1a` }}>
          ACTIVE
        </span>
      );
    case 'needs-recovery':
      return (
        <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold" style={{ borderColor: `${color}88`, color, backgroundColor: `${color}1a` }}>
          RECOVER
        </span>
      );
    default:
      return <Lock size={16} color={color} className="shrink-0" />;
  }
}

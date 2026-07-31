import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, GraduationCap, Lightbulb, ListChecks, Lock, Unlock } from 'lucide-react';
import { LEVELS, PHASES } from '../data/curriculum';
import type { AppState } from '../types';
import { getCurrentDayNumber, getHabitsByLevel, getLevelStatus, getTasksByLevel, type LevelStatus } from '../lib/engine';
import { phaseAccent } from '../lib/phaseColors';
import ScreenHeader from '../components/ui/ScreenHeader';

export default function LevelsScreen({ state, today }: { state: AppState; today: string }) {
  const dayNumber = getCurrentDayNumber(state, today);
  const [openId, setOpenId] = useState<number | null>(() => {
    if (dayNumber <= 0) return null;
    return LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd)?.id ?? null;
  });

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="MISSION TIMELINE"
        title="30 Levels · 90 Days"
        subtitle="Har phase ka apna focus. Level clear karke agla unlock karo."
      />

      {PHASES.map((phase) => {
        const levels = LEVELS.filter((l) => l.phase === phase.id);
        const cleared = levels.filter((l) => getLevelStatus(l, state, dayNumber) === 'cleared').length;
        const accent = phaseAccent(phase.color);
        return (
          <div key={phase.id} className="mb-6">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold">{phase.title}</p>
                <p className="truncate text-[11px] text-muted">{phase.subtitle}</p>
              </div>
              <span className="chip font-mono">
                {cleared}/{levels.length}
              </span>
            </div>

            <div className="space-y-2 border-l pl-4" style={{ borderColor: 'var(--color-border)' }}>
              {levels.map((level) => {
                const status = getLevelStatus(level, state, dayNumber);
                const isOpen = openId === level.id;
                const levelHabits = level.authored ? getHabitsByLevel(level.id) : [];
                const levelTasks = level.authored ? getTasksByLevel(level.id) : [];
                const activeNow = status === 'active';
                return (
                  <div key={level.id} className="relative fade-up">
                    <div
                      className="absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full border-2"
                      style={{
                        borderColor: statusColor(status),
                        backgroundColor: status === 'cleared' ? statusColor(status) : 'var(--color-bg)',
                      }}
                    />
                    <button
                      onClick={() => setOpenId(isOpen ? null : level.id)}
                      className="w-full rounded-xl border p-3.5 text-left transition-all duration-200"
                      style={{
                        borderColor: activeNow ? 'var(--color-light-dim)' : 'var(--color-border)',
                        backgroundColor: activeNow ? 'rgba(242,166,90,0.05)' : 'var(--color-panel)',
                        opacity: status === 'locked' ? 0.6 : 1,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[10px] tracking-widest text-muted">
                            LVL-{String(level.id).padStart(2, '0')} · DAYS {level.dayStart}–{level.dayEnd}
                          </p>
                          <p className="mt-0.5 truncate font-display text-sm font-bold">{level.title}</p>
                        </div>
                        <StatusIcon status={status} />
                      </div>
                      {level.authored && levelHabits.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {levelHabits.slice(0, 3).map((h) => (
                            <span key={h.id} className="chip">
                              {h.name}
                            </span>
                          ))}
                          {levelHabits.length > 3 && (
                            <span className="chip">+{levelHabits.length - 3}</span>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[11px] text-muted">
                          <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          {isOpen ? 'Collapse' : 'Details dekho'}
                        </span>
                        {status === 'active' && (
                          <span className="flex items-center gap-1 font-mono text-[10px] text-light">
                            <Clock3 size={11} /> In progress
                          </span>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="mt-2 rounded-xl border border-border bg-panel-raised p-4 text-sm fade-up">
                        {!level.authored ? (
                          <p className="text-muted">Ye level ka poora content agle update mein add hoga.</p>
                        ) : (
                          <>
                            <DetailBlock title="New Habits" icon={<GraduationCap size={14} color="var(--color-l)" />}>
                              <ul className="space-y-1.5">
                                {levelHabits.map((h) => (
                                  <li key={h.id} className="text-muted">
                                    <span className="font-medium text-text">{h.name}</span>
                                    <span className="text-[11px]"> · {h.timeRequired}</span>
                                    <p className="mt-0.5 text-[12px] text-muted/90">{h.criteria}</p>
                                  </li>
                                ))}
                              </ul>
                            </DetailBlock>
                            <DetailBlock title="Daily Tasks" icon={<ListChecks size={14} color="var(--color-light)" />}>
                              <ul className="list-disc space-y-1 pl-4 text-muted">
                                {levelTasks.map((t) => (
                                  <li key={t.id}>{t.text}</li>
                                ))}
                              </ul>
                            </DetailBlock>
                            <DetailBlock title="Pass & Unlock" icon={<Unlock size={14} color="var(--color-peak)" />}>
                              <p className="text-muted">{level.passCriteria}</p>
                              <p className="mt-1 text-muted">{level.unlockCondition}</p>
                            </DetailBlock>
                            {level.commonMistakes.length > 0 && (
                              <DetailBlock title="Common Mistakes" icon={<AlertTriangle size={14} color="var(--color-danger)" />}>
                                <ul className="list-disc space-y-1 pl-4 text-muted">
                                  {level.commonMistakes.map((m, i) => (
                                    <li key={i}>{m}</li>
                                  ))}
                                </ul>
                              </DetailBlock>
                            )}
                            <DetailBlock title="JEE Benefit" icon={<Lightbulb size={14} color="var(--color-light)" />}>
                              <p className="text-muted">{level.jeeBenefit}</p>
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
      })}
    </div>
  );
}

function DetailBlock({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 flex items-center gap-1.5 font-display text-[12px] font-bold">
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
      return 'var(--color-border)';
  }
}

function StatusIcon({ status }: { status: LevelStatus }) {
  const color = statusColor(status);
  if (status === 'cleared') return <CheckCircle2 size={18} color={color} />;
  if (status === 'active') return <Clock3 size={18} color={color} />;
  if (status === 'needs-recovery') return <AlertTriangle size={18} color={color} />;
  return <Lock size={16} color={color} />;
}

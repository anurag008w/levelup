import { useState } from 'react';
import { ChevronDown, Lock, CheckCircle2, AlertTriangle, Clock3 } from 'lucide-react';
import { LEVELS, PHASES } from '../data/curriculum';
import type { AppState } from '../types';
import { getCurrentDayNumber, getLevelStatus, type LevelStatus } from '../lib/engine';
import { phaseAccent } from '../lib/phaseColors';

export default function LevelsScreen({ state, today }: { state: AppState; today: string }) {
  const dayNumber = getCurrentDayNumber(state, today);
  const [openId, setOpenId] = useState<number | null>(dayNumber > 0 ? LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd)?.id ?? null : null);

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="mb-5">
        <p className="font-mono text-[11px] tracking-widest text-muted">MISSION TIMELINE</p>
        <h1 className="font-display text-lg font-bold">30 Levels · 90 Days</h1>
      </header>

      {PHASES.map((phase) => (
        <div key={phase.id} className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: phaseAccent(phase.color) }} />
            <div>
              <p className="font-display text-sm font-bold">{phase.title}</p>
              <p className="text-[11px] text-muted">{phase.subtitle}</p>
            </div>
          </div>

          <div className="space-y-2 border-l pl-4" style={{ borderColor: 'var(--color-border)' }}>
            {LEVELS.filter((l) => l.phase === phase.id).map((level) => {
              const status = getLevelStatus(level, state, dayNumber);
              const isOpen = openId === level.id;
              return (
                <div key={level.id} className="relative">
                  <div
                    className="absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full border-2"
                    style={{
                      borderColor: statusColor(status),
                      backgroundColor: status === 'cleared' ? statusColor(status) : 'var(--color-bg)',
                    }}
                  />
                  <button
                    onClick={() => setOpenId(isOpen ? null : level.id)}
                    className="w-full rounded-xl border p-3.5 text-left"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
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
                    {level.authored && (
                      <p className="mt-2 flex flex-wrap gap-1.5">
                        {level.newHabits.map((h) => (
                          <span key={h.id} className="rounded-full border px-2 py-0.5 text-[10px] text-muted" style={{ borderColor: 'var(--color-border)' }}>
                            {h.name}
                          </span>
                        ))}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1 text-muted">
                      <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      <span className="text-[11px]">{isOpen ? 'Collapse' : 'Details dekho'}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="mt-2 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel-raised)' }}>
                      {!level.authored ? (
                        <p className="text-muted">Ye level ka poora content (tasks, criteria, mistakes, JEE benefit) agle update mein add hoga.</p>
                      ) : (
                        <>
                          <Section title="🎯 New Habits">
                            <ul className="space-y-1.5">
                              {level.newHabits.map((h) => (
                                <li key={h.id} className="text-muted">
                                  <span className="text-text font-medium">{h.name}</span> — {h.timeRequired}
                                  <br />
                                  <span className="text-[12px]">✅ {h.criteria}</span>
                                </li>
                              ))}
                            </ul>
                          </Section>
                          <Section title="📋 Daily Tasks">
                            <ul className="list-disc space-y-1 pl-4 text-muted">
                              {level.dailyTasks.map((t) => (
                                <li key={t.id}>{t.text}</li>
                              ))}
                            </ul>
                          </Section>
                          <Section title="🚀 Pass & Unlock">
                            <p className="text-muted">{level.passCriteria}</p>
                            <p className="mt-1 text-muted">{level.unlockCondition}</p>
                          </Section>
                          <Section title="⚠️ Common Mistakes">
                            <ul className="list-disc space-y-1 pl-4 text-muted">
                              {level.commonMistakes.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </Section>
                          <Section title="📈 JEE Benefit">
                            <p className="text-muted">{level.jeeBenefit}</p>
                          </Section>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1 font-display text-[12px] font-bold">{title}</p>
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

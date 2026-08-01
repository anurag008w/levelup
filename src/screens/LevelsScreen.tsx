import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, GraduationCap, Lightbulb, ListChecks, Lock, Sparkles, Unlock, Wand2, User } from 'lucide-react';
import { LEVELS, PHASES } from '../data/curriculum';
import type { AppState } from '../types';
import { getCurrentDayNumber, getHabitsByLevel, getLevelStatus, getTasksByLevel, type LevelStatus } from '../lib/engine';
import { phaseAccent } from '../lib/phaseColors';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';
import type { CustomPhase } from '../core/domain/state';

const BLOCK_TYPES: Record<string, { icon: string; color: string }> = {
  physics: { icon: '⚛️', color: '#4FC3F7' },
  chemistry: { icon: '🧪', color: '#81C784' },
  maths: { icon: '🔢', color: '#FFB74D' },
  revision: { icon: '📖', color: '#BA68C8' },
  mock: { icon: '🧠', color: '#EF5350' },
  concept: { icon: '💡', color: '#4DD0E1' },
  problem: { icon: '🔬', color: '#AED581' },
};

const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  easy: { bg: 'bg-green-500/15', text: 'text-green-400' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  hard: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  extreme: { bg: 'bg-red-500/15', text: 'text-red-400' },
};

export default function LevelsScreen({ state, today }: { state: AppState; today: string }) {
  const dayNumber = getCurrentDayNumber(state, today);
  const currentLevelId = LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd)?.id ?? null;
  
  const customBlocks = state.postJourney?.customPhases ?? [];
  const activeBlockId = state.postJourney?.activeCustomPhaseId;
  const currentBlock = customBlocks.find(b => dayNumber >= b.dayStart && dayNumber <= b.dayEnd);
  
  const defaultOpen: number | string | null = currentLevelId ?? currentBlock?.id ?? null;
  const [openId, setOpenId] = useState<number | string | null>(defaultOpen);

  const clearedAll = LEVELS.filter((l) => getLevelStatus(l, state, dayNumber) === 'cleared').length;

  function toggle(id: number | string) {
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
            <div key={`level-${level.id}`} className="relative">
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
                      <span key={h.id} className="chip">{h.name}</span>
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

        {customBlocks.map((block) => (
          <CustomBlockCard
            key={`block-${block.id}`}
            block={block}
            dayNumber={dayNumber}
            activeBlockId={activeBlockId}
            isOpen={openId === block.id}
            onToggle={() => toggle(block.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CustomBlockCard({
  block,
  dayNumber,
  activeBlockId,
  isOpen,
  onToggle,
}: {
  block: CustomPhase;
  dayNumber: number;
  activeBlockId: string | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isActive = block.id === activeBlockId;
  const isCurrentDay = dayNumber >= block.dayStart && dayNumber <= block.dayEnd;
  
  const blockTypeKey = Object.keys(BLOCK_TYPES).find(k => 
    block.habits.some(h => h.toLowerCase().includes(k)) || block.name.toLowerCase().includes(k)
  );
  const blockType = blockTypeKey ? BLOCK_TYPES[blockTypeKey] : { icon: '📋', color: '#9E9E9E' };
  const diffColors = DIFFICULTY_COLORS[block.difficulty] ?? DIFFICULTY_COLORS.medium;

  return (
    <div className="relative">
      <span
        className={`absolute left-[-3px] top-4 z-10 h-3.5 w-3.5 rounded-full border-2 transition-all ${isCurrentDay ? 'pulse-dot' : ''}`}
        style={{
          borderColor: isActive ? 'var(--color-l)' : 'var(--color-border)',
          backgroundColor: isActive || isCurrentDay ? 'var(--color-l)' : 'var(--color-bg)',
        }}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="card card-press w-full p-3.5 text-left transition-colors"
        style={{
          borderColor: isCurrentDay ? 'rgba(245,179,103,0.5)' : isActive ? 'rgba(79,209,197,0.5)' : 'var(--color-border)',
          backgroundColor: isCurrentDay ? 'rgba(245,179,103,0.05)' : isActive ? 'rgba(79,209,197,0.05)' : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '16px' }}>{blockType.icon}</span>
              <p className="font-mono text-[10px] tracking-widest text-muted">
                BLOCK · DAYS {block.dayStart}–{block.dayEnd}
              </p>
            </div>
            <p className="mt-0.5 truncate font-display text-[15px] font-bold tracking-tight">{block.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg px-2 py-1 text-xs font-medium ${diffColors.bg} ${diffColors.text}`}>
              {block.difficulty}
            </span>
            {isActive && (
              <span className="badge" style={{ backgroundColor: 'rgba(79,209,197,0.14)', color: 'var(--color-l)' }}>
                <Sparkles size={10} /> Active
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <span className="chip" style={{ color: 'var(--color-purple)', borderColor: 'rgba(156,39,176,0.44)', backgroundColor: 'rgba(156,39,176,0.14)' }}>
            {block.createdBy === 'ai' ? <><Wand2 size={10} className="mr-1" />AI Generated</> : <><User size={10} className="mr-1" />Custom</>}
          </span>
        </div>

        {block.habits.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {block.habits.slice(0, 3).map((habit, i) => (
              <span key={i} className="chip" style={{ borderColor: 'var(--color-l)44', color: 'var(--color-l)' }}>{habit}</span>
            ))}
            {block.habits.length > 3 && <span className="chip">+{block.habits.length - 3}</span>}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted">
            <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            {isOpen ? 'Collapse' : 'Details dekho'}
          </span>
          {isCurrentDay && !isActive && (
            <span className="flex items-center gap-1 font-mono text-[10px] font-semibold text-light">
              <Clock3 size={11} /> Current day
            </span>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="card mt-2.5 p-4 text-sm slide-up" style={{ backgroundColor: 'var(--color-panel-raised)' }}>
          <DetailBlock title="Description" icon={<Lightbulb size={15} color="var(--color-m)" />}>
            <p className="leading-relaxed text-muted">{block.description}</p>
          </DetailBlock>
          
          <DetailBlock title="Goals" icon={<Sparkles size={15} color="var(--color-l)" />}>
            <ul className="space-y-1.5">
              {block.goals.map((goal, i) => (
                <li key={i} className="flex items-start gap-2 text-muted">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-l" />
                  {goal}
                </li>
              ))}
            </ul>
          </DetailBlock>
          
          <DetailBlock title="Daily Habits" icon={<GraduationCap size={15} color="var(--color-l)" />}>
            <ul className="space-y-2">
              {block.habits.map((habit, i) => (
                <li key={i} className="text-muted">
                  <span className="font-semibold text-text">{habit}</span>
                </li>
              ))}
            </ul>
          </DetailBlock>

          <DetailBlock title="Block Info" icon={<ListChecks size={15} color="var(--color-light)" />}>
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              <span>📅 {block.dayEnd - block.dayStart + 1} days</span>
              <span>⚡ {block.difficulty}</span>
              <span>{block.createdBy === 'ai' ? '🤖 AI' : '👤 Custom'}</span>
            </div>
          </DetailBlock>
        </div>
      )}
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
    case 'cleared': return 'var(--color-success)';
    case 'active': return 'var(--color-light)';
    case 'needs-recovery': return 'var(--color-danger)';
    default: return 'var(--color-border-strong)';
  }
}

function StatusBadge({ status }: { status: LevelStatus }) {
  const color = statusColor(status);
  switch (status) {
    case 'cleared':
      return <span className="flex shrink-0 items-center gap-1"><CheckCircle2 size={20} color={color} /></span>;
    case 'active':
      return <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold" style={{ borderColor: `${color}88`, color, backgroundColor: `${color}1a` }}>ACTIVE</span>;
    case 'needs-recovery':
      return <span className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold" style={{ borderColor: `${color}88`, color, backgroundColor: `${color}1a` }}>RECOVER</span>;
    default:
      return <Lock size={16} color={color} className="shrink-0" />;
  }
}

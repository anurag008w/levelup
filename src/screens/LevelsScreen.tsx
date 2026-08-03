import { useRef, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, Download, GraduationCap,
  Lightbulb, ListChecks, Lock, Pencil, Plus, Sparkles, Trash2, Unlock, Upload, User, Wand2, X,
} from 'lucide-react';
import { LEVELS, PHASES } from '../data/curriculum';
import type { AppState } from '../types';
import type { CustomLevel, CustomPhase } from '../core/domain/state';
import type { Habit } from '../core/domain/habit';
import type { TaskBankEntry } from '../core/domain/task-bank';
import { getCurrentDayNumber, getLevelStatus, type LevelStatus } from '../lib/engine';
import { phaseAccent } from '../lib/phaseColors';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';
import { container } from '../di/container';
import { applyCurriculum, parseCurriculum, serializeCurriculum } from '../features/curriculum/curriculum';
import { parseHabitEntry } from '../features/task-bank/validation';

const BLOCK_TYPES: Record<string, { icon: string; color: string }> = {
  physics: { icon: '⚛️', color: 'var(--color-tag-physics)' },
  chemistry: { icon: '🧪', color: 'var(--color-tag-chemistry)' },
  maths: { icon: '🔢', color: 'var(--color-tag-maths)' },
  revision: { icon: '📖', color: 'var(--color-tag-revision)' },
  mock: { icon: '🧠', color: 'var(--color-tag-mock)' },
  concept: { icon: '💡', color: 'var(--color-tag-concept)' },
  problem: { icon: '🔬', color: 'var(--color-tag-problem)' },
};

const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  easy: { bg: 'bg-[var(--color-l)]/15', text: 'text-[var(--color-l)]' },
  medium: { bg: 'bg-[var(--color-light)]/15', text: 'text-[var(--color-light)]' },
  hard: { bg: 'bg-[var(--color-danger)]/15', text: 'text-[var(--color-danger)]' },
  extreme: { bg: 'bg-[var(--color-danger)]/25', text: 'text-[var(--color-danger)]' },
};

const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

interface HabitDraft {
  name: string;
  description: string;
  timeRequired: string;
  criteria: string;
  prerequisites: string;
  thinkingSkills: string;
  isCore: boolean;
}

interface BlockLevelDraft {
  id: string;
  title: string;
  dayStart: number;
  dayEnd: number;
}

interface BlockDraft {
  name: string;
  description: string;
  dayStart: number;
  difficulty: Difficulty;
  goals: string;
  habits: string;
  levelCount: number;
  daysPerLevel: number;
  levels: BlockLevelDraft[];
}

const EMPTY_HABIT_DRAFT: HabitDraft = {
  name: '',
  description: '',
  timeRequired: '15 min',
  criteria: '',
  prerequisites: '',
  thinkingSkills: 'focus',
  isCore: true,
};

export default function LevelsScreen({ state, today, update }: { state: AppState; today: string; update: (fn: (s: AppState) => AppState) => void }) {
  const dayNumber = getCurrentDayNumber(state, today);
  const currentLevelId = LEVELS.find((l) => dayNumber >= l.dayStart && dayNumber <= l.dayEnd)?.id ?? null;

  const customBlocks = state.postJourney?.customPhases ?? [];
  const activeBlockId = state.postJourney?.activeCustomPhaseId;
  const currentBlock = customBlocks.find((b) => dayNumber >= b.dayStart && dayNumber <= b.dayEnd);
  const editing = state.curriculumEditing;

  const defaultOpen: number | string | null = currentLevelId ?? currentBlock?.id ?? null;
  const [openId, setOpenId] = useState<number | string | null>(defaultOpen);

  const [notice, setNotice] = useState('');
  const [taskEdit, setTaskEdit] = useState<{ id: string; title: string; day: number; durationMin: number } | null>(null);
  const [habitForm, setHabitForm] = useState<{ levelId: number; editingId: string | null; draft: HabitDraft } | null>(null);
  const [blockForm, setBlockForm] = useState<{ editingId: string | null; draft: BlockDraft } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const clearedAll = LEVELS.filter((l) => getLevelStatus(l, state, dayNumber) === 'cleared').length;

  // Merged (seed + user) data — same sources the daily plan uses.
  const allHabits = container.habitBank.getAllHabits();
  const allTasks = container.taskBank.getAll();

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 3500);
  }

  function toggle(id: number | string) {
    haptic(8);
    setOpenId((prev) => (prev === id ? null : id));
  }

  // ---- Task inline editing ----

  function startTaskEdit(entry: TaskBankEntry) {
    setTaskEdit({ id: entry.id, title: entry.title, day: unlockDay(entry), durationMin: entry.estimatedDurationMin });
  }

  function saveTaskEdit() {
    if (!taskEdit) return;
    if (!taskEdit.title.trim()) {
      flash('Title khaali nahi ho sakta.');
      return;
    }
    const entry = container.taskBank.getById(taskEdit.id);
    if (!entry) return;
    update((s) => ({
      ...s,
      dynamicTaskBank: [
        ...s.dynamicTaskBank.filter((e) => e.id !== taskEdit.id),
        {
          ...entry,
          title: taskEdit.title.trim(),
          estimatedDurationMin: clampInt(taskEdit.durationMin, 5, 180),
          unlockConditions: [{ type: 'day-exact', day: clampInt(taskEdit.day, 1, MAX_CUSTOM_DAY) }],
          active: true,
        },
      ],
    }));
    setTaskEdit(null);
    flash('Task update ho gaya — daily plan mein reflect hoga.');
  }

  function deleteTask(entry: TaskBankEntry) {
    if (!window.confirm(`"${entry.title}" ye task curriculum se hat jayega. Confirm?`)) return;
    update((s) => {
      if (entry.legacy) {
        const inactive = { ...entry, active: false };
        return { ...s, dynamicTaskBank: [...s.dynamicTaskBank.filter((e) => e.id !== entry.id), inactive] };
      }
      return { ...s, dynamicTaskBank: s.dynamicTaskBank.filter((e) => e.id !== entry.id) };
    });
    flash('Task delete ho gaya.');
  }

  // ---- Habit CRUD ----

  function openAddHabit(levelId: number) {
    haptic();
    setHabitForm({ levelId, editingId: null, draft: EMPTY_HABIT_DRAFT });
    setOpenId(levelId);
  }

  function openEditHabit(habit: Habit) {
    haptic();
    setHabitForm({
      levelId: habit.levelId,
      editingId: habit.id,
      draft: {
        name: habit.name,
        description: habit.description ?? '',
        timeRequired: habit.timeRequired,
        criteria: habit.criteria,
        prerequisites: habit.prerequisites.join(', '),
        thinkingSkills: habit.thinkingSkills.join(', '),
        isCore: habit.isCore,
      },
    });
  }

  function saveHabit() {
    if (!habitForm) return;
    const level = LEVELS.find((l) => l.id === habitForm.levelId);
    if (!level) return;
    const draft = habitForm.draft;
    if (!draft.name.trim() || !draft.criteria.trim()) {
      flash('Habit ka naam aur criteria dono bharo.');
      return;
    }
    const habit: Habit = {
      id: habitForm.editingId ?? uid('h'),
      name: draft.name.trim(),
      description: draft.description.trim(),
      timeRequired: draft.timeRequired.trim() || '15 min',
      criteria: draft.criteria.trim(),
      phase: level.phase,
      levelId: level.id,
      dayStart: level.dayStart,
      prerequisites: splitList(draft.prerequisites),
      isCore: draft.isCore,
      thinkingSkills: splitList(draft.thinkingSkills) as Habit['thinkingSkills'],
      active: true,
    };
    try {
      parseHabitEntry(habit);
    } catch {
      flash('Habit ka data valid nahi hai — fields check karo.');
      return;
    }
    update((s) => ({
      ...s,
      customHabits: [...s.customHabits.filter((h) => h.id !== habit.id), habit],
    }));
    setHabitForm(null);
    flash(habitForm.editingId ? 'Habit update ho gaya.' : `Habit "${habit.name}" Level ${level.id} mein add ho gaya.`);
  }

  function deleteHabit(habit: Habit) {
    if (!window.confirm(`"${habit.name}" habit hat jayega. Confirm?`)) return;
    const isSeed = allHabits.some((h) => h.id === habit.id) && !state.customHabits.some((h) => h.id === habit.id && h.active !== false);
    update((s) => {
      if (isSeed) {
        // Hide a built-in habit via an inactive override (same as task deletion).
        return { ...s, customHabits: [...s.customHabits.filter((h) => h.id !== habit.id), { ...habit, active: false }] };
      }
      return { ...s, customHabits: s.customHabits.filter((h) => h.id !== habit.id) };
    });
    flash('Habit delete ho gaya.');
  }

  // ---- Custom block CRUD ----

  function nextBlockStart(): number {
    return Math.max(90, ...customBlocks.map((b) => b.dayEnd)) + 1;
  }

  function openAddBlock() {
    haptic();
    const start = nextBlockStart();
    const draft: BlockDraft = {
      name: '',
      description: '',
      dayStart: start,
      difficulty: 'medium',
      goals: '',
      habits: '',
      levelCount: 3,
      daysPerLevel: 5,
      levels: [],
    };
    draft.levels = generateLevels(draft.levelCount, draft.daysPerLevel, draft.dayStart, draft.name);
    setBlockForm({ editingId: null, draft });
  }

  function openEditBlock(block: CustomPhase) {
    haptic();
    const levels: BlockLevelDraft[] = (block.levels ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      dayStart: l.dayStart,
      dayEnd: l.dayEnd,
    }));
    setBlockForm({
      editingId: block.id,
      draft: {
        name: block.name,
        description: block.description,
        dayStart: block.dayStart,
        difficulty: block.difficulty,
        goals: block.goals.join(', '),
        habits: block.habits.join(', '),
        levelCount: Math.max(1, levels.length),
        daysPerLevel: 5,
        levels,
      },
    });
  }

  function saveBlock() {
    if (!blockForm) return;
    const draft = blockForm.draft;
    if (!draft.name.trim()) {
      flash('Block ka naam bharo.');
      return;
    }
    const rawLevels: BlockLevelDraft[] =
      draft.levels.length > 0
        ? draft.levels
        : [{ id: uid('lv'), title: draft.name.trim(), dayStart: clampInt(draft.dayStart, 1, 1095), dayEnd: clampInt(draft.dayStart, 1, 1095) }];
    const levels: CustomLevel[] = rawLevels
      .map((l) => {
        const dayStart = clampInt(l.dayStart, 1, 1095);
        return {
          id: l.id || uid('lv'),
          title: l.title.trim() || draft.name.trim(),
          dayStart,
          dayEnd: Math.max(dayStart, clampInt(l.dayEnd, 1, 1095)),
          goals: [],
          habits: [],
        };
      })
      .sort((a, b) => a.dayStart - b.dayStart || a.dayEnd - b.dayEnd);
    const dayStart = Math.min(...levels.map((l) => l.dayStart));
    const dayEnd = Math.max(...levels.map((l) => l.dayEnd));
    const block: CustomPhase = {
      id: blockForm.editingId ?? uid('block'),
      name: draft.name.trim(),
      description: draft.description.trim(),
      dayStart,
      dayEnd,
      goals: splitList(draft.goals),
      habits: splitList(draft.habits),
      difficulty: draft.difficulty,
      createdBy: 'user',
      createdAt: blockForm.editingId ? customBlocks.find((b) => b.id === blockForm.editingId)?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
      levels,
    };
    update((s) => {
      const next = blockForm.editingId ? s.postJourney.customPhases.map((b) => (b.id === blockForm.editingId ? block : b)) : [...s.postJourney.customPhases, block];
      next.sort((a, b) => a.dayStart - b.dayStart || a.dayEnd - b.dayEnd || a.name.localeCompare(b.name));
      return {
        ...s,
        postJourney: {
          ...s.postJourney,
          customPhases: next,
          extensionDays: recomputeExtensionDays(next),
          activeCustomPhaseId: blockForm.editingId ? s.postJourney.activeCustomPhaseId : block.id,
        },
      };
    });
    setBlockForm(null);
    flash(blockForm.editingId ? 'Block update ho gaya.' : `Block "${block.name}" (${levels.length} levels, Day ${dayStart}–${dayEnd}) add ho gaya.`);
  }

  function recomputeExtensionDays(blocks: CustomPhase[]): number {
    return Math.max(0, ...blocks.map((b) => b.dayEnd - 90));
  }

  function deleteBlock(block: CustomPhase) {
    if (!window.confirm(`"${block.name}" block delete ho jayega. Confirm?`)) return;
    update((s) => {
      const next = s.postJourney.customPhases.filter((b) => b.id !== block.id);
      return {
        ...s,
        postJourney: {
          ...s.postJourney,
          customPhases: next,
          activeCustomPhaseId: s.postJourney.activeCustomPhaseId === block.id ? null : s.postJourney.activeCustomPhaseId,
          extensionDays: recomputeExtensionDays(next),
        },
      };
    });
    flash('Block delete ho gaya.');
  }

  function addLevelToBlock(block: CustomPhase) {
    const levels = block.levels ?? [];
    const last = levels[levels.length - 1];
    const dayStart = last ? last.dayEnd + 1 : block.dayStart;
    const newLevel: CustomLevel = {
      id: uid('lv'),
      title: `${block.name} — Part ${levels.length + 1}`,
      dayStart,
      dayEnd: dayStart,
      goals: [],
      habits: [],
    };
    update((s) => {
      const next = s.postJourney.customPhases.map((b) =>
        b.id === block.id ? { ...b, levels: [...(b.levels ?? []), newLevel], dayEnd: Math.max(b.dayEnd, newLevel.dayEnd) } : b,
      );
      return {
        ...s,
        postJourney: { ...s.postJourney, customPhases: next, extensionDays: recomputeExtensionDays(next) },
      };
    });
    flash(`Level "${newLevel.title}" (Day ${dayStart}) add ho gaya — block edit se days badal sakte ho.`);
  }

  function deleteLevelOfBlock(block: CustomPhase, level: CustomLevel) {
    if (!window.confirm(`"${level.title}" level block se hat jayega. Confirm?`)) return;
    const remaining = (block.levels ?? []).filter((l) => l.id !== level.id);
    update((s) => {
      const next = s.postJourney.customPhases.map((b) =>
        b.id === block.id
          ? {
              ...b,
              levels: remaining,
              dayStart: remaining.length ? Math.min(...remaining.map((l) => l.dayStart)) : b.dayStart,
              dayEnd: remaining.length ? Math.max(...remaining.map((l) => l.dayEnd)) : b.dayStart,
            }
          : b,
      );
      return {
        ...s,
        postJourney: { ...s.postJourney, customPhases: next, extensionDays: recomputeExtensionDays(next) },
      };
    });
    flash('Level delete ho gaya.');
  }

  // ---- Import / export ----

  function exportCurriculum() {
    const json = serializeCurriculum(allTasks, allHabits, customBlocks);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `levelup-curriculum-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash('Curriculum file download ho gayi — isse edit karke dobara import kar sakte ho.');
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const report = parseCurriculum(String(reader.result ?? ''));
        const result = applyCurriculum(state, report);
        update(() => result.state);
        flash(result.summary);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Curriculum import fail ho gaya.');
      }
    };
    reader.onerror = () => flash('File padhne mein dikkat aayi.');
    reader.readAsText(file);
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

      {/* Curriculum toolbar (advanced controls — hide in read-only mode) */}
      {editing && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          <button type="button" className="btn btn-primary" onClick={openAddBlock}>
            <Plus size={16} /> Add Block
          </button>
          <button type="button" className="btn btn-ghost" onClick={exportCurriculum}>
            <Download size={16} /> Export
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => importRef.current?.click()}>
            <Upload size={16} /> Import
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={onImportFile} aria-label="Import curriculum JSON" />
        </div>
      )}

      {notice && (
        <div className="toast mb-4 fade-in" role="status">
          <Check size={15} color="var(--color-l)" />
          {notice}
        </div>
      )}

      {/* Block form (add / edit) */}
      {blockForm && <BlockForm form={blockForm} onChange={setBlockForm} onSave={saveBlock} onCancel={() => setBlockForm(null)} />}

      <div className="relative space-y-2.5">
        <div className="absolute bottom-4 left-[3px] top-3 w-[2px] rounded-full bg-grid" aria-hidden="true" />

        {LEVELS.map((level) => {
          const status = getLevelStatus(level, state, dayNumber);
          const isOpen = openId === level.id;
          const phase = PHASES.find((p) => p.id === level.phase);
          const accent = phaseAccent(phase?.color ?? 'core');
          const levelHabits = level.authored ? allHabits.filter((h) => h.levelId === level.id) : [];
          const levelTasks = level.authored ? allTasks.filter((t) => t.legacy?.levelId === level.id).sort((a, b) => slotRank(a) - slotRank(b) || (a.legacy?.order ?? 0) - (b.legacy?.order ?? 0)) : [];
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
                  borderColor: activeNow ? 'rgba(201,162,39,0.5)' : clearedLevel ? 'rgba(138,154,91,0.3)' : 'var(--color-border)',
                  backgroundColor: activeNow ? 'rgba(201,162,39,0.05)' : clearedLevel ? 'rgba(138,154,91,0.04)' : undefined,
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
                    <span className="badge" style={{ backgroundColor: 'rgba(138,154,91,0.14)', color: 'var(--color-success)' }}>
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
                      <DetailBlock
                        title="New Habits"
                        icon={<GraduationCap size={15} color="var(--color-l)" />}
                        action={
                          editing ? (
                            <button type="button" className="btn btn-soft btn-sm" onClick={() => openAddHabit(level.id)}>
                              <Plus size={14} /> Add
                            </button>
                          ) : undefined
                        }
                      >
                        {levelHabits.length === 0 ? (
                          <p className="text-muted">Is level mein abhi koi habit nahi hai. "Add" se nayi banao.</p>
                        ) : (
                          <ul className="space-y-2.5">
                            {levelHabits.map((h) => (
                              <li key={h.id}>
                                {habitForm?.levelId === level.id && habitForm.editingId === h.id ? (
                                  <HabitForm
                                    levelId={level.id}
                                    draft={habitForm.draft}
                                    editingId={h.id}
                                    onChange={(draft) => setHabitForm((f) => (f ? { ...f, draft } : f))}
                                    onSave={saveHabit}
                                    onCancel={() => setHabitForm(null)}
                                  />
                                ) : (
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-text">{h.name}</span>
                                          <span className="text-xs">· {h.timeRequired}</span>
                                          {!h.isCore && <span className="chip">bonus</span>}
                                        </div>
                                        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{h.criteria}</p>
                                      </div>
                                      {editing && (
                                        <div className="flex shrink-0 items-center gap-0.5">
                                          <button type="button" className="icon-btn" onClick={() => openEditHabit(h)} aria-label={`Edit ${h.name}`}>
                                            <Pencil size={15} />
                                          </button>
                                          <button type="button" className="icon-btn text-red-400/70 hover:bg-danger/10 hover:text-danger" onClick={() => deleteHabit(h)} aria-label={`Delete ${h.name}`}>
                                            <Trash2 size={15} />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {habitForm && habitForm.levelId === level.id && habitForm.editingId === null && (
                          <div className="mt-3">
                            <HabitForm
                              levelId={level.id}
                              draft={habitForm.draft}
                              editingId={null}
                              onChange={(draft) => setHabitForm((f) => (f ? { ...f, draft } : f))}
                              onSave={saveHabit}
                              onCancel={() => setHabitForm(null)}
                            />
                          </div>
                        )}
                      </DetailBlock>

                      <DetailBlock title="Daily Tasks" icon={<ListChecks size={15} color="var(--color-light)" />}>
                        {levelTasks.length === 0 ? (
                          <p className="text-muted">Is level ke liye koi task nahi.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {levelTasks.map((t) =>
                              taskEdit && taskEdit.id === t.id ? (
                                <li key={t.id} className="rounded-lg border border-border p-2">
                                  <input
                                    className="field mb-2"
                                    aria-label="Task title"
                                    value={taskEdit.title}
                                    onChange={(e) => setTaskEdit({ ...taskEdit, title: e.target.value })}
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      className="field"
                                      type="number"
                                      min={1}
                                      max={MAX_CUSTOM_DAY}
                                      aria-label="Day"
                                      value={taskEdit.day}
                                      onChange={(e) => setTaskEdit({ ...taskEdit, day: Number(e.target.value) || 1 })}
                                    />
                                    <input
                                      className="field"
                                      type="number"
                                      min={5}
                                      max={180}
                                      aria-label="Duration min"
                                      value={taskEdit.durationMin}
                                      onChange={(e) => setTaskEdit({ ...taskEdit, durationMin: Number(e.target.value) || 30 })}
                                    />
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    <button type="button" className="btn btn-primary btn-sm flex-1" onClick={saveTaskEdit}>
                                      <Check size={14} /> Save
                                    </button>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTaskEdit(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </li>
                              ) : (
                                <li key={t.id} className="flex items-start justify-between gap-2">
                                  <span className="leading-relaxed text-muted">
                                    <span className="font-mono text-[10px] text-muted-dim">{t.legacy?.slot ?? 'custom'} · </span>
                                    {t.title}
                                  </span>
                                  {editing && (
                                    <div className="flex shrink-0 items-center gap-0.5">
                                      <button type="button" className="icon-btn" onClick={() => startTaskEdit(t)} aria-label={`Edit task ${t.title}`}>
                                        <Pencil size={15} />
                                      </button>
                                      <button type="button" className="icon-btn text-red-400/70 hover:bg-danger/10 hover:text-danger" onClick={() => deleteTask(t)} aria-label={`Delete task ${t.title}`}>
                                        <Trash2 size={15} />
                                      </button>
                                    </div>
                                  )}
                                </li>
                              ),
                            )}
                          </ul>
                        )}
                        {editing && (
                          <p className="mt-2 text-[11px] text-muted-dim">
                            Task edit/delete yahan se bhi hota hai — Task Bank tab mein bhi same tasks milenge.
                          </p>
                        )}
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

        {customBlocks.map((block) =>
          block.levels && block.levels.length > 0 ? (
            <BlockGroup
              key={`block-${block.id}`}
              block={block}
              dayNumber={dayNumber}
              activeBlockId={activeBlockId}
              editing={editing}
              openHeaderId={openId === block.id}
              openLevelId={openId}
              onToggleHeader={() => toggle(block.id)}
              onToggleLevel={(levelId) => toggle(levelId)}
              onEdit={() => openEditBlock(block)}
              onDelete={() => deleteBlock(block)}
              onAddLevel={() => addLevelToBlock(block)}
              onDeleteLevel={(level) => deleteLevelOfBlock(block, level)}
            />
          ) : (
            <CustomBlockCard
              key={`block-${block.id}`}
              block={block}
              dayNumber={dayNumber}
              activeBlockId={activeBlockId}
              isOpen={openId === block.id}
              editing={editing}
              onToggle={() => toggle(block.id)}
              onEdit={() => openEditBlock(block)}
              onDelete={() => deleteBlock(block)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function BlockForm({
  form,
  onChange,
  onSave,
  onCancel,
}: {
  form: { editingId: string | null; draft: BlockDraft };
  onChange: (f: { editingId: string | null; draft: BlockDraft }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const d = form.draft;
  const isAdd = form.editingId === null;
  const set = (patch: Partial<BlockDraft>) => onChange({ ...form, draft: { ...d, ...patch } });

  // Add mode: level count / days / start regenerate the level list below.
  function setLevelParams(levelCount: number, daysPerLevel: number, dayStart: number) {
    const count = Math.max(1, Math.round(levelCount) || 1);
    const days = Math.max(1, Math.round(daysPerLevel) || 1);
    const start = Math.max(1, Math.round(dayStart) || 1);
    onChange({
      ...form,
      draft: {
        ...d,
        levelCount: count,
        daysPerLevel: days,
        dayStart: start,
        levels: generateLevels(count, days, start, d.name),
      },
    });
  }

  function setLevel(id: string, patch: Partial<BlockLevelDraft>) {
    set({ levels: d.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }

  function removeLevel(id: string) {
    set({ levels: d.levels.filter((l) => l.id !== id) });
  }

  function addLevel() {
    const last = d.levels[d.levels.length - 1];
    const dayStart = last ? last.dayEnd + 1 : Math.max(1, d.dayStart);
    set({
      levels: [
        ...d.levels,
        { id: uid('lv'), title: `${d.name.trim() || 'Level'} — Part ${d.levels.length + 1}`, dayStart, dayEnd: dayStart },
      ],
    });
  }

  return (
    <div className="card mb-4 p-4 text-sm slide-up" style={{ backgroundColor: 'var(--color-panel-raised)' }}>
      <p className="mb-3 font-display text-[15px] font-bold">{isAdd ? 'Naya block banao' : 'Block edit karo'}</p>
      <div className="space-y-2.5">
        <input className="field" placeholder="Block naam (e.g. Physics Deep-Dive)" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        <input className="field" placeholder="Description (optional)" value={d.description} onChange={(e) => set({ description: e.target.value })} />

        {isAdd && (
          <div className="grid grid-cols-3 gap-2.5">
            <label className="block">
              <span className="field-label">Kitne levels?</span>
              <input
                className="field"
                type="number"
                min={1}
                max={60}
                value={d.levelCount}
                onChange={(e) => setLevelParams(Number(e.target.value) || 1, d.daysPerLevel, d.dayStart)}
              />
            </label>
            <label className="block">
              <span className="field-label">Har level din</span>
              <input
                className="field"
                type="number"
                min={1}
                max={90}
                value={d.daysPerLevel}
                onChange={(e) => setLevelParams(d.levelCount, Number(e.target.value) || 1, d.dayStart)}
              />
            </label>
            <label className="block">
              <span className="field-label">Start day</span>
              <input
                className="field"
                type="number"
                min={1}
                max={1095}
                value={d.dayStart}
                onChange={(e) => setLevelParams(d.levelCount, d.daysPerLevel, Number(e.target.value) || 1)}
              />
            </label>
          </div>
        )}

        <label className="block">
          <span className="field-label">Difficulty</span>
          <select className="field" value={d.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty })}>
            {DIFFICULTIES.map((diff) => (
              <option key={diff} value={diff}>{diff}</option>
            ))}
          </select>
        </label>
        <input className="field" placeholder="Goals (comma se — e.g. Mechanics mastery, PYQs)" value={d.goals} onChange={(e) => set({ goals: e.target.value })} />
        <input className="field" placeholder="Habits (comma se — e.g. HCV Reading, Numericals)" value={d.habits} onChange={(e) => set({ habits: e.target.value })} />

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-bold text-l">Block ke levels</p>
            <button type="button" className="btn btn-soft btn-sm" onClick={addLevel}>
              <Plus size={14} /> Add level
            </button>
          </div>

          {d.levels.length === 0 ? (
            <p className="text-muted">Abhi koi level nahi — "Add level" se ek banao. Levels ke bina save karoge to 1 level khud ban jayega.</p>
          ) : (
            <ul className="space-y-2.5">
              {d.levels.map((l, i) => (
                <li key={l.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] tracking-widest text-muted">LEVEL {i + 1}</span>
                    <button type="button" className="icon-btn text-red-400/70 hover:bg-danger/10 hover:text-danger" onClick={() => removeLevel(l.id)} aria-label={`Remove level ${i + 1}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <input
                    className="field mt-2"
                    placeholder={`Level ${i + 1} ka naam`}
                    value={l.title}
                    onChange={(e) => setLevel(l.id, { title: e.target.value })}
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      className="field"
                      type="number"
                      min={1}
                      max={1095}
                      aria-label={`Level ${i + 1} start day`}
                      value={l.dayStart}
                      onChange={(e) => {
                        const dayStart = Number(e.target.value) || 1;
                        setLevel(l.id, { dayStart, dayEnd: Math.max(dayStart, l.dayEnd) });
                      }}
                    />
                    <input
                      className="field"
                      type="number"
                      min={l.dayStart}
                      max={1095}
                      aria-label={`Level ${i + 1} end day`}
                      value={l.dayEnd}
                      onChange={(e) => setLevel(l.id, { dayEnd: Number(e.target.value) || l.dayStart })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" className="btn btn-primary flex-1" onClick={onSave}>
            <Check size={15} /> {isAdd ? `Add block (${d.levels.length} levels)` : 'Save block'}
          </button>
          <button type="button" className="btn btn-ghost px-4" onClick={onCancel}>
            <X size={15} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function HabitForm({
  levelId,
  draft,
  editingId,
  onChange,
  onSave,
  onCancel,
}: {
  levelId: number;
  draft: HabitDraft;
  editingId: string | null;
  onChange: (draft: HabitDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<HabitDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-[13px] font-bold text-l">{editingId ? 'Habit edit' : 'Nayi habit'}</p>
      <div className="space-y-2">
        <input className="field" placeholder="Habit naam (e.g. Formula Revision)" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <input className="field" placeholder="Description (optional)" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="field" placeholder="Time (e.g. 15 min)" value={draft.timeRequired} onChange={(e) => set({ timeRequired: e.target.value })} />
          <input className="field" placeholder="Prerequisites (comma)" value={draft.prerequisites} onChange={(e) => set({ prerequisites: e.target.value })} />
        </div>
        <input className="field" placeholder="Criteria — kab complete maanenge?" value={draft.criteria} onChange={(e) => set({ criteria: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="field" placeholder="Thinking skills (comma)" value={draft.thinkingSkills} onChange={(e) => set({ thinkingSkills: e.target.value })} />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={draft.isCore} onChange={(e) => set({ isCore: e.target.checked })} className="h-4 w-4 accent-[var(--color-l)]" />
            Core habit
          </label>
        </div>
        <p className="text-[11px] text-muted-dim">Ye habit Level {levelId} (Day {LEVELS.find((l) => l.id === levelId)?.dayStart}) se active hogi.</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary btn-sm flex-1" onClick={onSave}>
            <Check size={14} /> Save
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockGroup({
  block,
  dayNumber,
  activeBlockId,
  editing,
  openHeaderId,
  openLevelId,
  onToggleHeader,
  onToggleLevel,
  onEdit,
  onDelete,
  onAddLevel,
  onDeleteLevel,
}: {
  block: CustomPhase;
  dayNumber: number;
  activeBlockId: string | null;
  editing: boolean;
  openHeaderId: boolean;
  openLevelId: number | string | null;
  onToggleHeader: () => void;
  onToggleLevel: (levelId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddLevel: () => void;
  onDeleteLevel: (level: CustomLevel) => void;
}) {
  const isActive = block.id === activeBlockId;
  const isCurrentDay = dayNumber >= block.dayStart && dayNumber <= block.dayEnd;
  const levels = block.levels ?? [];

  const blockTypeKey = Object.keys(BLOCK_TYPES).find((k) => block.habits.some((h) => h.toLowerCase().includes(k)) || block.name.toLowerCase().includes(k));
  const blockType = blockTypeKey ? BLOCK_TYPES[blockTypeKey] : { icon: '📋', color: 'var(--color-tag-default)' };
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
        onClick={onToggleHeader}
        aria-expanded={openHeaderId}
        className="card card-press w-full p-3.5 text-left transition-colors"
        style={{
          borderColor: isCurrentDay ? 'rgba(201,162,39,0.5)' : isActive ? 'rgba(138,154,91,0.5)' : 'var(--color-border)',
          backgroundColor: isCurrentDay ? 'rgba(201,162,39,0.05)' : isActive ? 'rgba(138,154,91,0.05)' : undefined,
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
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-lg px-2 py-1 text-xs font-medium ${diffColors.bg} ${diffColors.text}`}>
              {block.difficulty}
            </span>
            <span className="chip" style={{ color: 'var(--color-l)', borderColor: 'rgba(138,154,91,0.44)', backgroundColor: 'rgba(138,154,91,0.14)' }}>
              {levels.length} level{levels.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <span className="chip" style={{ color: 'var(--color-tag-revision)', borderColor: 'rgba(155,138,168,0.4)', backgroundColor: 'rgba(155,138,168,0.14)' }}>
            {block.createdBy === 'ai' ? <><Wand2 size={10} className="mr-1" />AI Generated</> : <><User size={10} className="mr-1" />Custom</>}
          </span>
        </div>

        <div className="mt-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted">
            <ChevronDown size={14} className={`transition-transform duration-200 ${openHeaderId ? 'rotate-180' : ''}`} />
            {openHeaderId ? 'Collapse' : 'Block details'}
          </span>
          {isCurrentDay && (
            <span className="flex items-center gap-1 font-mono text-[10px] font-semibold text-light">
              <Clock3 size={11} /> Current day
            </span>
          )}
        </div>
      </button>

      {openHeaderId && (
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

          {editing && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onAddLevel}>
                <Plus size={14} /> Add level
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
                <Pencil size={14} /> Edit block
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
                <Trash2 size={14} /> Delete block
              </button>
            </div>
          )}
        </div>
      )}

      {levels.length > 0 && (
        <div className="mt-2 space-y-2.5 pl-4">
          {levels.map((level) => (
            <CustomLevelCard
              key={`clevel-${level.id}`}
              level={level}
              block={block}
              dayNumber={dayNumber}
              isOpen={openLevelId === level.id}
              editing={editing}
              onToggle={() => onToggleLevel(level.id)}
              onEdit={onEdit}
              onDelete={() => onDeleteLevel(level)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CustomLevelCard({
  level,
  block,
  dayNumber,
  isOpen,
  editing,
  onToggle,
  onEdit,
  onDelete,
}: {
  level: CustomLevel;
  block: CustomPhase;
  dayNumber: number;
  isOpen: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isCurrentDay = dayNumber >= level.dayStart && dayNumber <= level.dayEnd;
  const accent = 'var(--color-l)';
  return (
    <div className="relative">
      <span
        className={`absolute left-[-3px] top-4 z-10 h-3.5 w-3.5 rounded-full border-2 transition-all ${isCurrentDay ? 'pulse-dot' : ''}`}
        style={{
          borderColor: isCurrentDay ? 'var(--color-light)' : 'var(--color-border)',
          backgroundColor: isCurrentDay ? 'var(--color-light)' : 'var(--color-bg)',
        }}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="card card-press w-full p-3.5 text-left transition-colors"
        style={{
          borderColor: isCurrentDay ? 'rgba(201,162,39,0.5)' : 'var(--color-border)',
          backgroundColor: isCurrentDay ? 'rgba(201,162,39,0.05)' : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-widest text-muted">
              LEVEL · DAYS {level.dayStart}–{level.dayEnd}
            </p>
            <p className="mt-0.5 truncate font-display text-[15px] font-bold tracking-tight">{level.title}</p>
          </div>
          {isCurrentDay && (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] font-bold text-light">
              <Clock3 size={11} /> IN PROGRESS
            </span>
          )}
        </div>

        {(level.goals.length > 0 || level.habits.length > 0) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {level.goals.slice(0, 2).map((g, i) => (
              <span key={i} className="chip" style={{ color: accent, borderColor: `${accent}44`, backgroundColor: `${accent}14` }}>{g}</span>
            ))}
            {level.habits.slice(0, 3).map((h, i) => (
              <span key={i} className="chip">{h}</span>
            ))}
            {level.goals.length + level.habits.length > 5 && <span className="chip">+{level.goals.length + level.habits.length - 5}</span>}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted">
            <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            {isOpen ? 'Collapse' : 'Details dekho'}
          </span>
          <span className="max-w-[45%] truncate font-mono text-[10px] text-muted-dim">{block.name}</span>
        </div>
      </button>

      {isOpen && (
        <div className="card mt-2.5 p-4 text-sm slide-up" style={{ backgroundColor: 'var(--color-panel-raised)' }}>
          {level.goals.length > 0 && (
            <DetailBlock title="Goals" icon={<Sparkles size={15} color="var(--color-l)" />}>
              <ul className="space-y-1.5">
                {level.goals.map((goal, i) => (
                  <li key={i} className="flex items-start gap-2 text-muted">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-l" />
                    {goal}
                  </li>
                ))}
              </ul>
            </DetailBlock>
          )}
          {level.habits.length > 0 && (
            <DetailBlock title="Daily Habits" icon={<GraduationCap size={15} color="var(--color-l)" />}>
              <ul className="space-y-2">
                {level.habits.map((habit, i) => (
                  <li key={i} className="text-muted">
                    <span className="font-semibold text-text">{habit}</span>
                  </li>
                ))}
              </ul>
            </DetailBlock>
          )}
          <DetailBlock title="Level Info" icon={<ListChecks size={15} color="var(--color-light)" />}>
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              <span>📅 {level.dayEnd - level.dayStart + 1} days</span>
              <span className="chip" style={{ color: 'var(--color-tag-revision)', borderColor: 'rgba(155,138,168,0.4)', backgroundColor: 'rgba(155,138,168,0.14)' }}>
                <User size={10} className="mr-1" />Custom
              </span>
            </div>
          </DetailBlock>
          {editing && (
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
                <Pencil size={14} /> Edit
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomBlockCard({
  block,
  dayNumber,
  activeBlockId,
  isOpen,
  editing,
  onToggle,
  onEdit,
  onDelete,
}: {
  block: CustomPhase;
  dayNumber: number;
  activeBlockId: string | null;
  isOpen: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isActive = block.id === activeBlockId;
  const isCurrentDay = dayNumber >= block.dayStart && dayNumber <= block.dayEnd;

  const blockTypeKey = Object.keys(BLOCK_TYPES).find((k) => block.habits.some((h) => h.toLowerCase().includes(k)) || block.name.toLowerCase().includes(k));
  const blockType = blockTypeKey ? BLOCK_TYPES[blockTypeKey] : { icon: '📋', color: 'var(--color-tag-default)' };
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
          borderColor: isCurrentDay ? 'rgba(201,162,39,0.5)' : isActive ? 'rgba(138,154,91,0.5)' : 'var(--color-border)',
          backgroundColor: isCurrentDay ? 'rgba(201,162,39,0.05)' : isActive ? 'rgba(138,154,91,0.05)' : undefined,
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
              <span className="badge" style={{ backgroundColor: 'rgba(138,154,91,0.14)', color: 'var(--color-l)' }}>
                <Sparkles size={10} /> Active
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <span className="chip" style={{ color: 'var(--color-tag-revision)', borderColor: 'rgba(155,138,168,0.4)', backgroundColor: 'rgba(155,138,168,0.14)' }}>
            {block.createdBy === 'ai' ? <><Wand2 size={10} className="mr-1" />AI Generated</> : <><User size={10} className="mr-1" />Custom</>}
          </span>
        </div>

        {block.habits.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {block.habits.slice(0, 3).map((habit, i) => (
              <span key={i} className="chip" style={{ borderColor: 'rgba(138,154,91,0.4)', color: 'var(--color-l)' }}>{habit}</span>
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
          <DetailBlock title="Description" icon={<Lightbulb size={15} color="var(--color-light)" />}>
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

          {editing && (
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
                <Pencil size={14} /> Edit
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 flex items-center gap-1.5 font-display text-[13px] font-bold">
        {icon}
        <span className="flex-1">{title}</span>
        {action}
      </p>
      {children}
    </div>
  );
}

function statusColor(status: LevelStatus): string {
  switch (status) {
    case 'cleared': return '#8a9a5b';
    case 'active': return '#c9a227';
    case 'needs-recovery': return '#b3372f';
    default: return '#48453a';
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

// ---- Small helpers (shared with TaskBankScreen semantics) ----

const MAX_CUSTOM_DAY = 365;

function slotRank(t: TaskBankEntry): number {
  const order = ['morning', 'blocks', 'night', 'weekly', 'monthly'];
  if (!t.legacy) return order.length;
  return order.indexOf(t.legacy.slot);
}

function unlockDay(entry: TaskBankEntry): number {
  const exact = entry.unlockConditions.find((c) => c.type === 'day-exact');
  if (exact && exact.type === 'day-exact') return exact.day;
  const day = entry.unlockConditions.find((c) => c.type === 'day');
  return day && day.type === 'day' ? day.fromDay : 1;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function generateLevels(levelCount: number, daysPerLevel: number, dayStart: number, name: string): BlockLevelDraft[] {
  const levels: BlockLevelDraft[] = [];
  const count = clampInt(levelCount, 1, 60);
  const days = clampInt(daysPerLevel, 1, 90);
  let cursor = clampInt(dayStart, 1, 1095);
  for (let i = 0; i < count; i++) {
    levels.push({
      id: uid('lv'),
      title: `${name.trim() || 'Level'} — Part ${i + 1}`,
      dayStart: cursor,
      dayEnd: cursor + days - 1,
    });
    cursor += days;
  }
  return levels;
}

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

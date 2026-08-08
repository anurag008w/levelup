import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, ListTodo, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { AppState } from '../types';
import type { EnergyLevel, TaskBankEntry, TaskType } from '../core/domain/task-bank';
import { TASK_TYPES } from '../core/domain/task-bank';
import { parseTaskBankEntry } from '../features/task-bank/validation';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import { haptic } from '../lib/haptics';
import { useMenuFocus } from '../components/useMenuFocus';
import { MoreButton } from '../components/menu-accessibility';

const ENERGY_LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];
const ENERGY_LABEL: Record<EnergyLevel, string> = { low: 'Light', medium: 'Balanced', high: 'Intense' };
const MAX_CUSTOM_DAY = 365;
const EMPTY_FORM = { title: '', description: '', day: 1, durationMin: 30, energyLevel: 'medium' as EnergyLevel, taskType: 'Beginner' as TaskType };

type SourceFilter = 'all' | 'built-in' | 'user';

export default function TaskBankScreen({ state: _state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const allTasks = container.taskBank.getAll().filter((entry) => entry.active);
  const seedCount = allTasks.filter((entry) => entry.legacy).length;
  const customCount = allTasks.length - seedCount;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; day: number; durationMin: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; entry: TaskBankEntry } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const firedRef = useRef(false);
  const closeRowMenu = useCallback(() => {
    setRowMenu(null);
    firedRef.current = false;
  }, []);
  const { menuRef } = useMenuFocus(rowMenu !== null, closeRowMenu);

  function openRowMenu(entry: TaskBankEntry, x: number, y: number) {
    haptic(20);
    setRowMenu({ x, y, entry });
  }

  function clearHold() {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  const sorted = useMemo(() => [...allTasks].sort((a, b) => unlockDay(a) - unlockDay(b) || a.id.localeCompare(b.id)), [allTasks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((e) => {
      if (source === 'built-in' && !e.legacy) return false;
      if (source === 'user' && e.legacy) return false;
      if (q && !e.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sorted, query, source]);

  // Group by unlock day so browsing feels organised instead of a flat wall.
  const grouped = useMemo(() => {
    const groups = new Map<number, TaskBankEntry[]>();
    for (const entry of filtered) {
      const day = unlockDay(entry);
      const list = groups.get(day) ?? [];
      list.push(entry);
      groups.set(day, list);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 2500);
  }

  function addTask() {
    if (!form.title.trim()) {
      flash('Title bharo.');
      return;
    }
    haptic();
    const entry = parseTaskBankEntry({
      id: uid('u'),
      habitId: 'h1',
      title: form.title.trim(),
      description: form.description.trim(),
      phase: 'jee-core',
      difficulty: 2,
      estimatedDurationMin: clampInt(form.durationMin, 5, 180),
      energyLevel: form.energyLevel,
      tags: [],
      prerequisites: [],
      taskType: form.taskType,
      revisionSuitability: 0.3,
      backlogSuitability: 0.3,
      thinkingSkills: ['focus'],
      jeeRelevance: { score: 0.5 },
      unlockConditions: [{ type: 'day-exact', day: clampInt(form.day, 1, MAX_CUSTOM_DAY) }],
      active: true,
    });
    if (hasDuplicateTask(allTasks, entry.title, unlockDay(entry))) {
      flash('Ye task is day ke liye pehle se hai. Duplicate add nahi hua.');
      return;
    }
    update((s) => ({ ...s, dynamicTaskBank: upsertUniqueTask(s.dynamicTaskBank, entry) }));
    setForm(EMPTY_FORM);
    setShowForm(false);
    flash(`Task add ho gaya — Day ${unlockDay(entry)} ke plan mein aa jayega.`);
  }

  function startEdit(entry: TaskBankEntry) {
    setEditingId(entry.id);
    setEditDraft({ title: entry.title, day: unlockDay(entry), durationMin: entry.estimatedDurationMin });
  }

  function saveEdit() {
    if (!editingId || !editDraft) return;
    if (!editDraft.title.trim()) {
      flash('Title khaali nahi ho sakta.');
      return;
    }
    if (hasDuplicateTask(allTasks, editDraft.title, clampInt(editDraft.day, 1, MAX_CUSTOM_DAY), editingId)) {
      flash('Same day par same title ka task pehle se hai.');
      return;
    }
    update((s) => ({
      ...s,
      dynamicTaskBank: [
        ...s.dynamicTaskBank.filter((e) => e.id !== editingId),
        {
          ...(container.taskBank.getById(editingId) ?? s.dynamicTaskBank.find((e) => e.id === editingId)!),
          title: editDraft.title.trim(),
          estimatedDurationMin: clampInt(editDraft.durationMin, 5, 180),
          unlockConditions: [{ type: 'day-exact' as const, day: clampInt(editDraft.day, 1, MAX_CUSTOM_DAY) }],
          active: true,
        },
      ],
    }));
    setEditingId(null);
    setEditDraft(null);
    flash('Task edit ho gaya.');
  }

  function deleteTask(entry: TaskBankEntry) {
    if (!window.confirm('Ye task task bank se hat jayega. Confirm?')) return;
    update((s) => {
      if (entry.legacy) {
        const inactive = { ...entry, active: false };
        return {
          ...s,
          dynamicTaskBank: [...s.dynamicTaskBank.filter((e) => e.id !== entry.id), inactive],
        };
      }
      return { ...s, dynamicTaskBank: s.dynamicTaskBank.filter((e) => e.id !== entry.id) };
    });
    flash('Task delete ho gaya.');
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="TASK BANK"
        title="Tasks"
        subtitle="Apne tasks yahan se bhi add/edit/delete karo — chat mein bhi kar sakte ho."
        right={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="btn btn-primary px-3.5 text-sm font-bold"
            style={{ minHeight: '2.5rem' }}
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? 'Cancel' : 'Add'}
          </button>
        }
      />

      <div className="card mb-4 flex items-center gap-3 p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(111,163,157,0.14)', color: '#6fa39d' }}>
          <ListTodo size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-bold">
            {allTasks.length} study task{allTasks.length === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-muted">
            {customCount > 0
              ? `${customCount} tumhare banaye hue · baaki suggested tasks`
              : 'Suggested tasks — yahan se ya chat mein bolke apne bana sakte ho'}
          </p>
        </div>
      </div>

      {notice && (
        <div className="toast mb-4 fade-in" role="status">
          <Check size={15} color="var(--color-l)" />
          {notice}
        </div>
      )}

      {showForm && (
        <div className="card mb-4 p-4 text-sm slide-up">
          <p className="mb-3 font-display text-[15px] font-bold">Naya task</p>
          <div className="space-y-2.5">
            <input className="field" placeholder="Title (e.g. Physics ke 10 numericals)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="field" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="field-label">Day (1-{MAX_CUSTOM_DAY})</span>
                <input className="field" type="number" min={1} max={MAX_CUSTOM_DAY} value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) || 1 })} />
              </label>
              <label className="block">
                <span className="field-label">Duration (min)</span>
                <input className="field" type="number" min={5} max={180} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) || 30 })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="field-label">Energy</span>
                <select className="field" value={form.energyLevel} onChange={(e) => setForm({ ...form, energyLevel: e.target.value as EnergyLevel })}>
                  {ENERGY_LEVELS.map((l) => (
                    <option key={l} value={l}>{ENERGY_LABEL[l]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Type</span>
                <select className="field" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}>
                  {TASK_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn btn-primary w-full text-sm font-bold" onClick={addTask}>
              Add to bank
            </button>
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="mb-4 space-y-2.5">
        <div className="relative">
          <Search size={16} color="var(--color-muted-dim)" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            className="field pl-10"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tasks"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'user', label: 'Mine' },
              { id: 'built-in', label: 'Suggested' },
            ] as Array<{ id: SourceFilter; label: string }>
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              className="filter-chip shrink-0"
              aria-pressed={source === f.id}
              onClick={() => {
                haptic(6);
                setSource(f.id);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">
            {allTasks.length === 0 ? 'Abhi koi active task nahi hai. "Add" se banayein, ya chat mein bolo.' : 'Is filter mein koi task nahi mila.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, tasks]) => (
            <section key={day}>
              <div className="mb-1.5 flex items-baseline justify-between px-0.5">
                <h3 className="font-display text-sm font-bold tracking-tight">Day {day}</h3>
                <span className="font-mono text-[11px] text-muted">
                  {tasks.length} task{tasks.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-2">
                {tasks.map((entry) => {
                  const isEditing = editingId === entry.id;
                  return (
                    <div
                      key={entry.id}
                      className="card p-3 text-sm"
                      onContextMenu={(e) => {
                        if (isEditing || rowMenu) return;
                        e.preventDefault();
                        if (!firedRef.current) openRowMenu(entry, e.clientX, e.clientY);
                      }}
                      onPointerDown={(e) => {
                        if (isEditing || e.pointerType !== 'touch' || rowMenu) return;
                        firedRef.current = false;
                        holdTimer.current = window.setTimeout(() => {
                          firedRef.current = true;
                          openRowMenu(entry, e.clientX, e.clientY);
                        }, 450);
                      }}
                      onPointerUp={clearHold}
                      onPointerMove={clearHold}
                      onPointerLeave={clearHold}
                    >
                      {isEditing && editDraft ? (
                        <div className="space-y-2.5">
                          <input className="field" aria-label="Task title" value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                          <div className="grid grid-cols-2 gap-2.5">
                            <input className="field" type="number" min={1} max={MAX_CUSTOM_DAY} aria-label="Day" value={editDraft.day} onChange={(e) => setEditDraft({ ...editDraft, day: Number(e.target.value) || 1 })} />
                            <input className="field" type="number" min={5} max={180} aria-label="Duration" value={editDraft.durationMin} onChange={(e) => setEditDraft({ ...editDraft, durationMin: Number(e.target.value) || 30 })} />
                          </div>
                          <div className="flex gap-2">
                            <button className="btn btn-primary flex-1 py-2 text-sm font-bold" onClick={saveEdit}>
                              <Check size={15} /> Save
                            </button>
                            <button className="btn btn-ghost px-4" onClick={() => { setEditingId(null); setEditDraft(null); }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <MoreButton label={`Open actions for ${entry.title}`} onOpen={(r) => openRowMenu(entry, r.right, r.bottom)} />
                          <div className="flex items-center gap-3">
                            <span
                              className="flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-lg font-mono leading-none"
                              style={{ backgroundColor: 'rgba(163,19,19,0.1)', color: 'var(--color-l)' }}
                            >
                              <span className="text-sm font-bold">{entry.estimatedDurationMin}</span>
                              <span className="text-[9px] uppercase tracking-wider opacity-80">min</span>
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold leading-snug">{entry.title}</p>
                              {entry.description && (
                                <p className="mt-0.5 text-xs leading-relaxed text-muted line-clamp-2">{entry.description}</p>
                              )}
                            </div>
                            {!entry.legacy && (
                              <span className="badge shrink-0" style={{ backgroundColor: 'rgba(111,163,157,0.14)', color: '#6fa39d' }}>
                                Mine
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="badge" style={{ backgroundColor: 'var(--color-panel-raised)', color: 'var(--color-peak)' }}>
                              {entry.taskType}
                            </span>
                            <EnergyBadge level={entry.energyLevel} />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {rowMenu && (
        <>
          <div className="fixed inset-0 z-[59]" onClick={closeRowMenu} aria-hidden="true" />
          <div ref={menuRef} role="menu" className="ctx-menu" style={{ left: rowMenu.x, top: rowMenu.y }}>
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => {
                haptic();
                startEdit(rowMenu.entry);
                closeRowMenu();
              }}
            >
              <Pencil size={15} />
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              className="ctx-item danger"
              onClick={() => {
                haptic();
                deleteTask(rowMenu.entry);
                closeRowMenu();
              }}
            >
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EnergyBadge({ level }: { level: EnergyLevel }) {
  const color = level === 'low' ? '#a31313' : level === 'medium' ? '#efe9df' : '#e34530';
  return (
    <span className="badge" style={{ backgroundColor: `${color}1a`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {ENERGY_LABEL[level]}
    </span>
  );
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

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTaskTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasDuplicateTask(entries: TaskBankEntry[], title: string, day: number, ignoreId?: string): boolean {
  const normalized = normalizeTaskTitle(title);
  return entries.some((entry) => entry.active && entry.id !== ignoreId && normalizeTaskTitle(entry.title) === normalized && unlockDay(entry) === day);
}

function upsertUniqueTask(entries: TaskBankEntry[], entry: TaskBankEntry): TaskBankEntry[] {
  const normalized = normalizeTaskTitle(entry.title);
  const day = unlockDay(entry);
  return [
    ...entries.filter((existing) => existing.id !== entry.id && (!existing.active || normalizeTaskTitle(existing.title) !== normalized || unlockDay(existing) !== day)),
    entry,
  ];
}

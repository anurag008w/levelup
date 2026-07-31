import { useMemo, useState } from 'react';
import { Check, ListTodo, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { AppState } from '../types';
import type { EnergyLevel, TaskBankEntry, TaskType } from '../core/domain/task-bank';
import { TASK_TYPES } from '../core/domain/task-bank';
import { parseTaskBankEntry } from '../features/task-bank/validation';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';

const ENERGY_LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];

const EMPTY_FORM = { title: '', description: '', day: 1, durationMin: 30, energyLevel: 'medium' as EnergyLevel, taskType: 'Beginner' as TaskType };

export default function TaskBankScreen({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const dynamic = state.dynamicTaskBank;
  const allTasks = useMemo(() => {
    try {
      return container.taskBank.getAll();
    } catch {
      return dynamic.filter((entry) => entry.active);
    }
  }, [dynamic]);
  const seedCount = allTasks.filter((entry) => entry.legacy).length;
  const customCount = allTasks.length - seedCount;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; day: number; durationMin: number } | null>(null);
  const [notice, setNotice] = useState('');

  const sorted = [...allTasks].sort((a, b) => unlockDay(a) - unlockDay(b) || a.title.localeCompare(b.title));

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 2500);
  }

  function addTask() {
    if (!form.title.trim()) {
      flash('Title bharo.');
      return;
    }
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
      unlockConditions: [{ type: 'day', fromDay: clampInt(form.day, 1, 90) }],
      active: true,
    });
    update((s) => ({ ...s, dynamicTaskBank: [...s.dynamicTaskBank, entry] }));
    setForm(EMPTY_FORM);
    setShowForm(false);
    flash(`Task add ho gaya — Day ${entry.unlockConditions[0].type === 'day' ? entry.unlockConditions[0].fromDay : 1} ke plan mein aa jayega.`);
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
    update((s) => {
      const existing = allTasks.find((e) => e.id === editingId);
      if (!existing) return s;
      const edited = {
        ...existing,
        title: editDraft.title.trim(),
        estimatedDurationMin: clampInt(editDraft.durationMin, 5, 180),
        unlockConditions: [{ type: 'day' as const, fromDay: clampInt(editDraft.day, 1, 90) }],
        active: true,
      };
      const found = s.dynamicTaskBank.some((e) => e.id === editingId);
      return {
        ...s,
        dynamicTaskBank: found
          ? s.dynamicTaskBank.map((e) => (e.id === editingId ? edited : e))
          : [...s.dynamicTaskBank, edited],
      };
    });
    setEditingId(null);
    setEditDraft(null);
    flash('Task edit ho gaya.');
  }

  function deleteTask(entry: TaskBankEntry) {
    if (!window.confirm('Ye task task bank se hat jayega. Confirm?')) return;
    update((s) => {
      if (entry.legacy) {
        const deleted = { ...entry, active: false };
        const found = s.dynamicTaskBank.some((e) => e.id === entry.id);
        return {
          ...s,
          dynamicTaskBank: found
            ? s.dynamicTaskBank.map((e) => (e.id === entry.id ? deleted : e))
            : [...s.dynamicTaskBank, deleted],
        };
      }
      return { ...s, dynamicTaskBank: s.dynamicTaskBank.filter((e) => e.id !== entry.id) };
    });
    flash('Task delete ho gaya.');
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="HUMAN OS"
        title="Task Bank"
        subtitle="Apne tasks yahan se bhi add/edit/delete karo — chat mein bhi kar sakte ho."
      />

      <div className="mb-3 flex items-center justify-between rounded-2xl bg-panel p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-grid">
            <ListTodo size={17} color="var(--color-light)" />
          </span>
          <div>
            <p className="font-display text-sm font-bold">{allTasks.length} active task{allTasks.length === 1 ? '' : 's'}</p>
            <p className="text-[11px] text-muted">{seedCount} built-in · {customCount} user/AI · unlocked tasks har din ke plan mein aate hain</p>
          </div>
        </div>
        <button className="btn btn-primary px-3 py-2 text-xs font-bold" onClick={() => setShowForm((v) => !v)}>
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? 'Cancel' : 'Add task'}
        </button>
      </div>

      {notice && <div className="mb-3 rounded-xl border border-border bg-panel px-3 py-2 text-xs text-light">{notice}</div>}

      {showForm && (
        <div className="card mb-4 p-4 text-xs fade-up">
          <p className="mb-2 font-display text-sm font-bold">Naya task</p>
          <div className="space-y-2">
            <input className="field" placeholder="Title (e.g. Physics ke 10 numericals)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="field" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-muted">Day (1-90)</span>
                <input className="field" type="number" min={1} max={90} value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) || 1 })} />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-muted">Duration (min)</span>
                <input className="field" type="number" min={5} max={180} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) || 30 })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-muted">Energy</span>
                <select className="field" value={form.energyLevel} onChange={(e) => setForm({ ...form, energyLevel: e.target.value as EnergyLevel })}>
                  {ENERGY_LEVELS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-muted">Type</span>
                <select className="field" value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value as TaskType })}>
                  {TASK_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn btn-primary w-full py-2 text-xs font-bold" onClick={addTask}>
              Add to bank
            </button>
          </div>
        </div>
      )}

      <SectionHeader accent="var(--color-l)" title="All active tasks" meta="Built-in + Chat + manual" />
      {sorted.length === 0 ? (
        <div className="card p-4 text-xs text-muted">Abhi koi task nahi hai. "Add task" se banayein, ya chat mein bolo.</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((entry) => {
            const isEditing = editingId === entry.id;
            const day = unlockDay(entry);
            return (
              <div key={entry.id} className="card p-3 text-xs">
                {isEditing && editDraft ? (
                  <div className="space-y-2">
                    <input className="field" value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <input className="field" type="number" min={1} max={90} value={editDraft.day} onChange={(e) => setEditDraft({ ...editDraft, day: Number(e.target.value) || 1 })} />
                      <input className="field" type="number" min={5} max={180} value={editDraft.durationMin} onChange={(e) => setEditDraft({ ...editDraft, durationMin: Number(e.target.value) || 30 })} />
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-primary flex-1 py-1.5 text-xs font-bold" onClick={saveEdit}>
                        <Check size={13} /> Save
                      </button>
                      <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => { setEditingId(null); setEditDraft(null); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug">{entry.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        Day {day} · {entry.estimatedDurationMin}min · {entry.energyLevel} · {entry.taskType} · {entry.legacy ? 'built-in' : 'user/AI'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button className="btn btn-ghost px-2 py-1" onClick={() => startEdit(entry)} aria-label="Edit">
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost px-2 py-1 text-red-400" onClick={() => deleteTask(entry)} aria-label="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function unlockDay(entry: TaskBankEntry): number {
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
import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ListTodo,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { CustomTodoTask, TodoCategory, TodoPriority } from '../types';
import { sortCustomTodos } from '../core/domain/todo-tasks';
import SectionHeader from './ui/SectionHeader';
import { haptic } from '../lib/haptics';

interface CustomTodoSectionProps {
  todos: CustomTodoTask[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, updated: Partial<CustomTodoTask> | string) => void;
  onAdd: (todo: { title: string; priority: TodoPriority; category: TodoCategory; estimatedMinutes: number }) => void;
  onReorder?: (newTodos: CustomTodoTask[]) => void;
  flash: (msg: string) => void;
  isStandalone?: boolean;
}

const CATEGORIES: { id: TodoCategory; label: string; color: string }[] = [
  { id: 'physics', label: 'Physics', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  { id: 'chemistry', label: 'Chemistry', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  { id: 'maths', label: 'Maths', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  { id: 'revision', label: 'Revision', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { id: 'general', label: 'General', color: 'text-stone-300 bg-stone-500/10 border-stone-500/20' },
];

const PRIORITIES: { id: TodoPriority; label: string; dot: string; bg: string }[] = [
  { id: 'high', label: 'High', dot: 'bg-rose-500', bg: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
  { id: 'medium', label: 'Med', dot: 'bg-amber-500', bg: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { id: 'low', label: 'Low', dot: 'bg-emerald-500', bg: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
];

const DURATIONS = [15, 30, 45, 60, 90];

export default function CustomTodoSection({
  todos,
  onToggle,
  onDelete,
  onEdit,
  onAdd,
  onReorder,
  flash,
  isStandalone = false,
}: CustomTodoSectionProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [category, setCategory] = useState<TodoCategory>('general');
  const [duration, setDuration] = useState<number>(30);

  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<TodoPriority>('medium');
  const [editCategory, setEditCategory] = useState<TodoCategory>('general');
  const [editDuration, setEditDuration] = useState<number>(30);

  const sortedTodos = sortCustomTodos(todos);
  const completedTodos = sortedTodos.filter((t) => t.completed);
  const pendingTodos = sortedTodos.filter((t) => !t.completed);
  const filtered = sortedTodos.filter((t) => {
    if (filter === 'pending') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  function handleSubmit() {
    if (!title.trim()) {
      flash('Pehle To-Do title bharein.');
      return;
    }
    haptic();
    onAdd({
      title: title.trim(),
      priority,
      category,
      estimatedMinutes: duration,
    });
    setTitle('');
    setShowAddForm(false);
    flash('Naya To-Do add ho gaya!');
  }

  function startEdit(t: CustomTodoTask) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditPriority(t.priority || 'medium');
    setEditCategory(t.category || 'general');
    setEditDuration(t.estimatedMinutes || 30);
  }

  function saveEdit(id: string) {
    if (!editTitle.trim()) return;
    haptic();
    onEdit(id, {
      title: editTitle.trim(),
      priority: editPriority,
      category: editCategory,
      estimatedMinutes: editDuration,
    });
    setEditingId(null);
    setEditTitle('');
    flash('To-Do update ho gaya.');
  }

  function handleMove(id: string, direction: 'up' | 'down') {
    const list = [...sortedTodos];
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const item = list.splice(idx, 1)[0];
    list.splice(targetIdx, 0, item);
    const updated = list.map((t, i) => ({ ...t, order: i }));
    onReorder?.(updated);
    haptic(5);
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader
          icon={<ListTodo size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title={isStandalone ? 'Daily To-Dos & Tasks' : 'Custom To-Dos'}
          meta={`${completedTodos.length}/${todos.length} done`}
        />
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="btn btn-ghost min-h-8 gap-1 px-2.5 text-xs font-semibold text-l"
          aria-label={showAddForm ? 'Close add form' : 'Add custom to-do'}
        >
          {showAddForm ? <X size={14} /> : <Plus size={14} />}
          {showAddForm ? 'Cancel' : 'Add To-Do'}
        </button>
      </div>

      {/* Quick Add Form */}
      {showAddForm && (
        <div className="card p-4 fade-in space-y-3 border-l/30 bg-panel-raised/95">
          <div className="flex items-center justify-between">
            <p className="font-display text-sm font-bold text-text">Naya To-Do Task</p>
            <button type="button" onClick={() => setShowAddForm(false)} className="icon-btn" aria-label="Close form">
              <X size={15} />
            </button>
          </div>

          <input
            type="text"
            className="field w-full text-sm font-medium placeholder:text-muted"
            placeholder="Kya karna hai? (e.g. Physics HC Verma 10 questions)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            autoFocus
          />

          <div className="space-y-2 text-xs">
            {/* Priority */}
            <div>
              <span className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">Priority (High tasks stay on top)</span>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => {
                  const active = priority === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        haptic(4);
                        setPriority(p.id);
                      }}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                        active ? p.bg : 'border-border/60 bg-white/5 text-muted hover:border-border'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category */}
            <div>
              <span className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">Subject / Category</span>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const active = category === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        haptic(4);
                        setCategory(c.id);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                        active ? c.color : 'border-border/60 bg-white/5 text-muted hover:border-border'
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Duration */}
            <div>
              <span className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">Estimated Time (Longer tasks on top)</span>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map((d) => {
                  const active = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        haptic(4);
                        setDuration(d);
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                        active ? 'border-l bg-l/15 text-light font-bold' : 'border-border/60 bg-white/5 text-muted hover:border-border'
                      }`}
                    >
                      {d} min
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary w-full min-h-10 text-xs font-bold gap-1.5 mt-2"
          >
            <Plus size={15} /> Save to today's list
          </button>
        </div>
      )}

      {/* Filter Chips */}
      {todos.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs">
          {(['all', 'pending', 'completed'] as const).map((tab) => {
            const count = tab === 'all' ? todos.length : tab === 'pending' ? pendingTodos.length : completedTodos.length;
            const active = filter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  haptic(4);
                  setFilter(tab);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-all ${
                  active
                    ? 'border-l/50 bg-l/15 text-light shadow-sm'
                    : 'border-border/50 bg-panel/50 text-muted hover:border-border'
                }`}
              >
                {tab} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* To-Do Items List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="card p-5 text-center text-muted">
            <p className="text-xs">
              {todos.length === 0
                ? 'Aaj koi custom to-do nahi hai. Upar "+ Add To-Do" dabao ya Misa AI se plan karvao!'
                : `Koi ${filter} to-do nahi hai.`}
            </p>
          </div>
        ) : (
          filtered.map((t, index) => {
            const prioMeta = PRIORITIES.find((p) => p.id === t.priority) || PRIORITIES[1];
            const catMeta = CATEGORIES.find((c) => c.id === t.category) || CATEGORIES[4];
            const isEditing = editingId === t.id;

            return (
              <div
                key={t.id}
                className={`card relative flex items-start gap-2.5 p-3.5 transition-all ${
                  t.completed ? 'opacity-65 bg-panel/35' : 'bg-panel/85 hover:border-border-strong'
                }`}
              >
                {/* Checkbox button */}
                <button
                  type="button"
                  onClick={() => onToggle(t.id)}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                    t.completed
                      ? 'border-success bg-success text-bg'
                      : 'border-border hover:border-l hover:bg-l/10 text-transparent'
                  }`}
                  aria-label={t.completed ? `Mark ${t.title} as pending` : `Mark ${t.title} as completed`}
                >
                  <Check size={13} strokeWidth={3} />
                </button>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="space-y-2.5 pt-0.5">
                      <input
                        type="text"
                        className="field w-full text-xs font-semibold"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(t.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />

                      {/* Edit Priority */}
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        {PRIORITIES.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              haptic(4);
                              setEditPriority(p.id);
                            }}
                            className={`flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium transition-all ${
                              editPriority === p.id ? p.bg : 'border-border/50 bg-white/5 text-muted'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {/* Edit Category */}
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        {CATEGORIES.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              haptic(4);
                              setEditCategory(c.id);
                            }}
                            className={`rounded-md border px-2 py-0.5 font-medium transition-all ${
                              editCategory === c.id ? c.color : 'border-border/50 bg-white/5 text-muted'
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>

                      {/* Edit Duration */}
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        {DURATIONS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              haptic(4);
                              setEditDuration(d);
                            }}
                            className={`rounded-md border px-2 py-0.5 transition-all ${
                              editDuration === d ? 'border-l bg-l/15 text-light font-bold' : 'border-border/50 bg-white/5 text-muted'
                            }`}
                          >
                            {d}m
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => saveEdit(t.id)}
                          className="btn btn-primary px-3 py-1 text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="btn btn-ghost px-2.5 py-1 text-xs text-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p
                        className={`text-sm font-semibold leading-snug break-words ${
                          t.completed ? 'line-through text-muted' : 'text-text'
                        }`}
                      >
                        {t.title}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {/* Priority */}
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${prioMeta.bg}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${prioMeta.dot}`} />
                          {prioMeta.label}
                        </span>

                        {/* Category */}
                        {t.category && (
                          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-medium ${catMeta.color}`}>
                            {catMeta.label}
                          </span>
                        )}

                        {/* Duration */}
                        {t.estimatedMinutes && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-muted">
                            <Clock size={10} /> {t.estimatedMinutes}m
                          </span>
                        )}

                        {/* AI tag */}
                        {t.createdBy === 'ai' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-l/15 px-1.5 py-0.5 font-semibold text-l">
                            <Sparkles size={10} /> Misa
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions & Reorder buttons */}
                {!isEditing && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {/* Move Up */}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMove(t.id, 'up')}
                      className={`icon-btn p-1 ${index === 0 ? 'opacity-20 cursor-not-allowed' : 'text-muted hover:text-text'}`}
                      aria-label="Move task up"
                      title="Move up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    {/* Move Down */}
                    <button
                      type="button"
                      disabled={index === filtered.length - 1}
                      onClick={() => handleMove(t.id, 'down')}
                      className={`icon-btn p-1 ${index === filtered.length - 1 ? 'opacity-20 cursor-not-allowed' : 'text-muted hover:text-text'}`}
                      aria-label="Move task down"
                      title="Move down"
                    >
                      <ChevronDown size={14} />
                    </button>
                    {/* Edit */}
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="icon-btn p-1 text-muted hover:text-text"
                      aria-label="Edit To-Do"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`"${t.title}" ko delete karna hai?`)) {
                          onDelete(t.id);
                        }
                      }}
                      className="icon-btn p-1 text-muted hover:text-danger"
                      aria-label="Delete To-Do"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useCallback } from 'react';
import {
  ArrowUpDown,
  Check,
  Clock,
  GripVertical,
  ListTodo,
  Pencil,
  Plus,
  RotateCcw,
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
  const [isArrangeMode, setIsArrangeMode] = useState(false);

  // Add Form State
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [category, setCategory] = useState<TodoCategory>('general');
  const [duration, setDuration] = useState<number>(30);

  // Edit Modal State
  const [editingTodo, setEditingTodo] = useState<CustomTodoTask | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<TodoPriority>('medium');
  const [editCategory, setEditCategory] = useState<TodoCategory>('general');
  const [editDuration, setEditDuration] = useState<number>(30);

  // Uncomplete confirmation modal state
  const [uncompleteTarget, setUncompleteTarget] = useState<CustomTodoTask | null>(null);

  // Drag Reorder state for arrange mode
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const sortedTodos = sortCustomTodos(todos);
  const completedTodos = sortedTodos.filter((t) => t.completed);
  const pendingTodos = sortedTodos.filter((t) => !t.completed);
  const filtered = sortedTodos.filter((t) => {
    if (filter === 'pending') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  function handleAddSubmit() {
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

  function handleTaskToggle(t: CustomTodoTask) {
    if (t.completed) {
      haptic(10);
      setUncompleteTarget(t);
    } else {
      haptic(8);
      onToggle(t.id);
    }
  }

  function confirmUncomplete() {
    if (!uncompleteTarget) return;
    haptic(10);
    onToggle(uncompleteTarget.id);
    setUncompleteTarget(null);
    flash(`"${uncompleteTarget.title}" ko wapas Pending mark kar diya.`);
  }

  function startEdit(t: CustomTodoTask) {
    haptic();
    setEditingTodo(t);
    setEditTitle(t.title);
    setEditPriority(t.priority || 'medium');
    setEditCategory(t.category || 'general');
    setEditDuration(t.estimatedMinutes || 30);
  }

  function saveEdit() {
    if (!editingTodo || !editTitle.trim()) return;
    haptic();
    onEdit(editingTodo.id, {
      title: editTitle.trim(),
      priority: editPriority,
      category: editCategory,
      estimatedMinutes: editDuration,
    });
    setEditingTodo(null);
    flash('To-Do update ho gaya.');
  }

  function moveItem(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= sortedTodos.length) return;
    const list = [...sortedTodos];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    const updated = list.map((t, i) => ({ ...t, order: i }));
    onReorder?.(updated);
    haptic(8);
  }

  const handleLongPressTrigger = useCallback(() => {
    haptic(30);
    setIsArrangeMode(true);
  }, []);

  return (
    <div className="mb-6 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SectionHeader
          icon={<ListTodo size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title={isStandalone ? 'Daily To-Dos & Tasks' : 'Custom To-Dos'}
          meta={`${completedTodos.length}/${todos.length} done`}
        />
        <div className="flex items-center gap-1.5">
          {!isArrangeMode && todos.length > 1 && (
            <button
              type="button"
              onClick={() => {
                haptic();
                setIsArrangeMode(true);
              }}
              className="btn btn-ghost min-h-8 gap-1 px-2 text-xs font-semibold text-muted hover:text-text"
              aria-label="Arrange tasks"
            >
              <ArrowUpDown size={13} />
              Arrange
            </button>
          )}
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
      </div>

      {/* Arrange Mode Banner */}
      {isArrangeMode && (
        <div className="flex items-center justify-between rounded-xl border border-l/40 bg-l/15 p-3 fade-in">
          <div className="flex items-center gap-2">
            <GripVertical size={16} className="text-light" />
            <p className="font-display text-xs font-bold text-light">Arrange Mode: Tasks ko drag ya move karein</p>
          </div>
          <button
            type="button"
            onClick={() => {
              haptic();
              setIsArrangeMode(false);
              flash('Tasks ka order save ho gaya.');
            }}
            className="btn btn-primary px-3 py-1.5 text-xs font-bold gap-1 shadow-md"
          >
            <Check size={13} strokeWidth={3} /> Done
          </button>
        </div>
      )}

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
              if (e.key === 'Enter') handleAddSubmit();
            }}
            autoFocus
          />

          <div className="space-y-2 text-xs">
            {/* Priority */}
            <div>
              <span className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">Priority (High tasks on top)</span>
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
            onClick={handleAddSubmit}
            className="btn btn-primary w-full min-h-10 text-xs font-bold gap-1.5 mt-2"
          >
            <Plus size={15} /> Save to today's list
          </button>
        </div>
      )}

      {/* Filter Chips */}
      {!isArrangeMode && todos.length > 0 && (
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

      {/* Helper text about swipe gestures */}
      {!isArrangeMode && filtered.length > 0 && (
        <p className="text-[10px] text-muted text-center italic">
          Tip: Slide right to delete · Slide left to edit · Long press to arrange
        </p>
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
          filtered.map((t, index) => (
            <SwipeableTodoCard
              key={t.id}
              task={t}
              index={index}
              totalCount={filtered.length}
              isArrangeMode={isArrangeMode}
              onToggle={() => handleTaskToggle(t)}
              onDelete={() => onDelete(t.id)}
              onEdit={() => startEdit(t)}
              onMove={moveItem}
              onLongPress={handleLongPressTrigger}
              onDragStart={() => setDraggedIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedIndex !== null && draggedIndex !== index) {
                  moveItem(draggedIndex, index);
                  setDraggedIndex(index);
                }
              }}
              onDragEnd={() => setDraggedIndex(null)}
            />
          ))
        )}
      </div>

      {/* Uncomplete / Undo Confirmation Dialog */}
      {uncompleteTarget && (
        <div className="modal-backdrop fade-in" style={{ zIndex: 110 }} onClick={() => setUncompleteTarget(null)}>
          <div
            className="modal-card max-w-sm w-full p-4.5 space-y-3.5 text-center"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Undo task completion"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <RotateCcw size={22} />
            </div>

            <div>
              <p className="font-display text-base font-bold text-text">Mark Task as Pending?</p>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                Kya aap <span className="font-semibold text-text">"{uncompleteTarget.title}"</span> ko wapas incomplete / pending list mein lana chahte hain?
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={confirmUncomplete}
                className="btn btn-primary flex-1 py-2 text-xs font-bold gap-1"
              >
                <Check size={14} strokeWidth={3} /> Haan, Pending Karo
              </button>
              <button
                type="button"
                onClick={() => setUncompleteTarget(null)}
                className="btn btn-ghost px-4 py-2 text-xs text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal Dialog */}
      {editingTodo && (
        <div className="modal-backdrop fade-in" style={{ zIndex: 100 }} onClick={() => setEditingTodo(null)}>
          <div
            className="modal-card max-w-md w-full p-4.5 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Edit To-Do"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <Pencil size={16} className="text-l" />
                <p className="font-display text-base font-bold text-text">Edit To-Do Task</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTodo(null)}
                className="icon-btn text-muted hover:text-text"
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">
                  Task Title
                </label>
                <input
                  type="text"
                  className="field w-full text-sm font-semibold"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') setEditingTodo(null);
                  }}
                  autoFocus
                />
              </div>

              {/* Edit Priority */}
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">
                  Priority
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITIES.map((p) => {
                    const active = editPriority === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          haptic(4);
                          setEditPriority(p.id);
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

              {/* Edit Category */}
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">
                  Subject / Category
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const active = editCategory === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          haptic(4);
                          setEditCategory(c.id);
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

              {/* Edit Duration */}
              <div>
                <label className="block text-[11px] font-semibold text-muted mb-1.5 uppercase tracking-wider">
                  Duration (Minutes)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DURATIONS.map((d) => {
                    const active = editDuration === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          haptic(4);
                          setEditDuration(d);
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

            <div className="flex items-center gap-2 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={saveEdit}
                className="btn btn-primary flex-1 py-2 text-xs font-bold gap-1"
              >
                <Check size={14} strokeWidth={3} /> Save Changes
              </button>
              <button
                type="button"
                onClick={() => setEditingTodo(null)}
                className="btn btn-ghost px-4 py-2 text-xs text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Swipeable Card Component with Gesture Detection & Clean View
// -------------------------------------------------------------
function SwipeableTodoCard({
  task,
  index,
  totalCount,
  isArrangeMode,
  onToggle,
  onDelete,
  onEdit,
  onMove,
  onLongPress,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  task: CustomTodoTask;
  index: number;
  totalCount: number;
  isArrangeMode: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMove: (from: number, to: number) => void;
  onLongPress: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const prioMeta = PRIORITIES.find((p) => p.id === task.priority) || PRIORITIES[1];
  const catMeta = CATEGORIES.find((c) => c.id === task.category) || CATEGORIES[4];

  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isHorizontalRef = useRef<boolean | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  function clearHoldTimer() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (isArrangeMode) return;
    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    isHorizontalRef.current = null;
    setIsSwiping(true);

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      onLongPress();
      clearHoldTimer();
    }, 450);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (isArrangeMode) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    // Detect direction on first significant movement
    if (isHorizontalRef.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        if (Math.abs(dx) > Math.abs(dy)) {
          isHorizontalRef.current = true;
          clearHoldTimer();
        } else {
          isHorizontalRef.current = false;
          clearHoldTimer();
        }
      }
    }

    if (isHorizontalRef.current) {
      // Dampen resistance past 110px
      const dampened = Math.sign(dx) * Math.min(130, Math.abs(dx) * 0.85);
      setOffsetX(dampened);
    }
  }

  function handleTouchEnd() {
    clearHoldTimer();
    setIsSwiping(false);

    if (offsetX > 70) {
      // Swiped Right -> Delete
      haptic(20);
      onDelete();
    } else if (offsetX < -70) {
      // Swiped Left -> Edit
      haptic(15);
      onEdit();
    }
    setOffsetX(0);
  }

  if (isArrangeMode) {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        className="card relative flex items-center justify-between p-3 bg-panel border-l/30 cursor-grab active:cursor-grabbing transition-all select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <GripVertical size={16} className="text-light/70 shrink-0" />
          <span className={`text-sm font-semibold truncate ${task.completed ? 'line-through text-muted' : 'text-text'}`}>
            {task.title}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            className={`btn btn-ghost px-2 py-1 text-xs ${index === 0 ? 'opacity-20' : 'text-text'}`}
            aria-label="Move Up"
          >
            ↑ Up
          </button>
          <button
            type="button"
            disabled={index === totalCount - 1}
            onClick={() => onMove(index, index + 1)}
            className={`btn btn-ghost px-2 py-1 text-xs ${index === totalCount - 1 ? 'opacity-20' : 'text-text'}`}
            aria-label="Move Down"
          >
            ↓ Down
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl select-none">
      {/* Background action reveals */}
      {offsetX > 0 && (
        <div className="absolute inset-0 flex items-center justify-start px-4 rounded-2xl bg-rose-600/20 border border-rose-500/30 text-rose-400 font-bold text-xs">
          <div className="flex items-center gap-1.5">
            <Trash2 size={16} />
            <span>Slide right to Delete</span>
          </div>
        </div>
      )}
      {offsetX < 0 && (
        <div className="absolute inset-0 flex items-center justify-end px-4 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 font-bold text-xs">
          <div className="flex items-center gap-1.5">
            <span>Slide left to Edit</span>
            <Pencil size={16} />
          </div>
        </div>
      )}

      {/* Main Task Card */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          onLongPress();
        }}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        className={`card relative flex items-start gap-2.5 p-3.5 transition-colors ${
          task.completed ? 'opacity-65 bg-panel/35' : 'bg-panel/85 hover:border-border-strong'
        }`}
      >
        {/* Checkbox button */}
        <button
          type="button"
          onClick={onToggle}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
            task.completed
              ? 'border-success bg-success text-bg'
              : 'border-border hover:border-l hover:bg-l/10 text-transparent'
          }`}
          aria-label={task.completed ? `Mark ${task.title} as pending` : `Mark ${task.title} as completed`}
        >
          <Check size={13} strokeWidth={3} />
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-semibold leading-snug break-words ${
              task.completed ? 'line-through text-muted' : 'text-text'
            }`}
          >
            {task.title}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            {/* Priority */}
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${prioMeta.bg}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${prioMeta.dot}`} />
              {prioMeta.label}
            </span>

            {/* Category */}
            {task.category && (
              <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-medium ${catMeta.color}`}>
                {catMeta.label}
              </span>
            )}

            {/* Duration */}
            {task.estimatedMinutes && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-muted">
                <Clock size={10} /> {task.estimatedMinutes}m
              </span>
            )}

            {/* AI tag */}
            {task.createdBy === 'ai' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-l/15 px-1.5 py-0.5 font-semibold text-l">
                <Sparkles size={10} /> Misa
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export type TodoPriority = 'high' | 'medium' | 'low';
export type TodoCategory = 'physics' | 'chemistry' | 'maths' | 'general' | 'revision';

export interface CustomTodoTask {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: TodoPriority;
  category?: TodoCategory;
  estimatedMinutes?: number;
  dueDateISO?: string;
  createdAtISO: string;
  completedAtISO?: string;
  createdBy: 'user' | 'ai';
  /** Manual position sorting index (lower index = rendered higher). */
  order?: number;
}

export function createDefaultTodo(title: string, priority: TodoPriority = 'medium', estimatedMinutes = 30, category: TodoCategory = 'general'): CustomTodoTask {
  return {
    id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    completed: false,
    priority,
    category,
    estimatedMinutes,
    createdAtISO: new Date().toISOString(),
    createdBy: 'user',
  };
}

/**
 * Sorts custom to-dos:
 * 1. Pending (uncompleted) tasks always on top, completed at the bottom.
 * 2. If manual order is set, honors order index.
 * 3. Default heuristic: High Priority > Medium > Low; then longer duration > shorter; then newest.
 */
export function sortCustomTodos(todos: CustomTodoTask[]): CustomTodoTask[] {
  const prioWeight: Record<TodoPriority, number> = { high: 3, medium: 2, low: 1 };
  return [...todos].sort((a, b) => {
    // 1. Pending first
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    // 2. Explicit manual order
    if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.order !== undefined && b.order === undefined) return -1;
    if (a.order === undefined && b.order !== undefined) return 1;
    // 3. Priority: High (3) > Medium (2) > Low (1)
    const pA = prioWeight[a.priority || 'medium'] || 2;
    const pB = prioWeight[b.priority || 'medium'] || 2;
    if (pA !== pB) return pB - pA;
    // 4. Duration: Longer study blocks first
    const durA = a.estimatedMinutes ?? 30;
    const durB = b.estimatedMinutes ?? 30;
    if (durA !== durB) return durB - durA;
    // 5. Creation date: Newest first
    return (b.createdAtISO || '').localeCompare(a.createdAtISO || '');
  });
}

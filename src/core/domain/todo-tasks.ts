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

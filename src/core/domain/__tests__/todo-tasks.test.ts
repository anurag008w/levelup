import { describe, it, expect } from 'vitest';
import { createDefaultTodo, sortCustomTodos, type CustomTodoTask } from '../todo-tasks';

describe('todo-tasks', () => {
  it('creates a default todo with proper defaults', () => {
    const todo = createDefaultTodo('Physics HW', 'high', 45, 'physics');
    expect(todo.title).toBe('Physics HW');
    expect(todo.priority).toBe('high');
    expect(todo.estimatedMinutes).toBe(45);
    expect(todo.category).toBe('physics');
    expect(todo.completed).toBe(false);
    expect(todo.createdBy).toBe('user');
  });

  describe('sortCustomTodos', () => {
    it('always puts pending tasks on top and completed tasks at the bottom', () => {
      const todos: CustomTodoTask[] = [
        {
          id: '1',
          title: 'Done task with high priority',
          completed: true,
          priority: 'high',
          estimatedMinutes: 90,
          createdAtISO: '2026-08-31T10:00:00Z',
          createdBy: 'user',
        },
        {
          id: '2',
          title: 'Pending task with low priority',
          completed: false,
          priority: 'low',
          estimatedMinutes: 15,
          createdAtISO: '2026-08-31T09:00:00Z',
          createdBy: 'user',
        },
      ];

      const sorted = sortCustomTodos(todos);
      expect(sorted[0].id).toBe('2'); // Pending first
      expect(sorted[1].id).toBe('1'); // Completed bottom
    });

    it('sorts pending tasks by priority: High > Medium > Low', () => {
      const todos: CustomTodoTask[] = [
        {
          id: 'low',
          title: 'Low task',
          completed: false,
          priority: 'low',
          estimatedMinutes: 30,
          createdAtISO: '2026-08-31T10:00:00Z',
          createdBy: 'user',
        },
        {
          id: 'high',
          title: 'High task',
          completed: false,
          priority: 'high',
          estimatedMinutes: 30,
          createdAtISO: '2026-08-31T09:00:00Z',
          createdBy: 'user',
        },
        {
          id: 'med',
          title: 'Medium task',
          completed: false,
          priority: 'medium',
          estimatedMinutes: 30,
          createdAtISO: '2026-08-31T08:00:00Z',
          createdBy: 'user',
        },
      ];

      const sorted = sortCustomTodos(todos);
      expect(sorted.map((t) => t.id)).toEqual(['high', 'med', 'low']);
    });

    it('sorts same-priority tasks by duration (longer tasks higher up)', () => {
      const todos: CustomTodoTask[] = [
        {
          id: '30m',
          title: 'Short task',
          completed: false,
          priority: 'high',
          estimatedMinutes: 30,
          createdAtISO: '2026-08-31T10:00:00Z',
          createdBy: 'user',
        },
        {
          id: '90m',
          title: 'Long task',
          completed: false,
          priority: 'high',
          estimatedMinutes: 90,
          createdAtISO: '2026-08-31T09:00:00Z',
          createdBy: 'user',
        },
        {
          id: '60m',
          title: 'Medium length task',
          completed: false,
          priority: 'high',
          estimatedMinutes: 60,
          createdAtISO: '2026-08-31T08:00:00Z',
          createdBy: 'user',
        },
      ];

      const sorted = sortCustomTodos(todos);
      expect(sorted.map((t) => t.id)).toEqual(['90m', '60m', '30m']);
    });

    it('honors manual order index when set', () => {
      const todos: CustomTodoTask[] = [
        {
          id: 't1',
          title: 'Custom order 2',
          completed: false,
          priority: 'high',
          estimatedMinutes: 90,
          order: 2,
          createdAtISO: '2026-08-31T10:00:00Z',
          createdBy: 'user',
        },
        {
          id: 't2',
          title: 'Custom order 0',
          completed: false,
          priority: 'low',
          estimatedMinutes: 15,
          order: 0,
          createdAtISO: '2026-08-31T09:00:00Z',
          createdBy: 'user',
        },
        {
          id: 't3',
          title: 'Custom order 1',
          completed: false,
          priority: 'medium',
          estimatedMinutes: 45,
          order: 1,
          createdAtISO: '2026-08-31T08:00:00Z',
          createdBy: 'user',
        },
      ];

      const sorted = sortCustomTodos(todos);
      expect(sorted.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
    });
  });
});

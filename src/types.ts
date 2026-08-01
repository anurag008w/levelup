// Legacy type shim. All domain types now live in src/core/domain and are
// re-exported here so existing imports (../types) keep working unchanged.
export * from './core/domain/task-bank';
export * from './core/domain/habit';
export * from './core/domain/progress';
export * from './core/domain/memory';
export * from './core/domain/summary';
export * from './core/domain/llm';
export * from './core/domain/state';
export * from './core/domain/ai-actions';

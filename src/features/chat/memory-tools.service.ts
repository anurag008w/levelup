import type { AppState } from '../../core/domain/state';
import type { StateStore } from '../../core/ports/repositories';
import type { MemoryService } from '../ai/memory.service';
import {
  memoryToolActionSchema,
  memoryToolBatchSchema,
  isMemoryQuery,
  memoryEntriesToText,
  type MemoryToolAction,
  type MemoryToolResult,
} from '../../core/domain/memory-tools';

/**
 * Executes AI memory tool actions deterministically (read/edit/delete/pin).
 * The decision to CALL a tool is made by the LLM in a separate decision hop;
 * execution here never touches a model. Deleting requires explicit
 * confirmation through the same JSON protocol.
 */
export class MemoryToolsService {
  private readonly store: StateStore;
  private readonly memory: MemoryService;

  constructor(store: StateStore, memory: MemoryService) {
    this.store = store;
    this.memory = memory;
  }

  /** Routes a user message to the memory decision hop. */
  isMemoryQuery(text: string): boolean {
    return isMemoryQuery(text);
  }

  /** Extracts memory tool actions from a model reply (single object, batch or array). */
  parseTools(text: string): MemoryToolAction[] {
    const parsed = tryJson(text);
    if (parsed === null) return [];

    // {"actions": [...]}
    if (typeof parsed === 'object' && parsed !== null && 'actions' in parsed) {
      const batch = memoryToolBatchSchema.safeParse(parsed);
      return batch.success ? batch.data.actions : [];
    }

    if (Array.isArray(parsed)) {
      const out: MemoryToolAction[] = [];
      for (const item of parsed.slice(0, 20)) {
        const single = memoryToolActionSchema.safeParse(item);
        if (single.success) out.push(single.data);
      }
      return out;
    }

    const single = memoryToolActionSchema.safeParse(parsed);
    return single.success ? [single.data] : [];
  }

  /** Executes a batch of memory actions in order. */
  async runMany(actions: MemoryToolAction[]): Promise<MemoryToolResult> {
    if (actions.length === 0) return { ok: false, summary: 'Koi memory action nahi mila.' };
    const parts: string[] = [];
    let requiresConfirmation = false;
    let state = this.store.get();
    for (const action of actions) {
      const result = this.runOnState(state, action);
      if (result.result.requiresConfirmation) requiresConfirmation = true;
      if (result.state) state = result.state;
      parts.push(result.result.summary);
      if (result.result.ok) this.store.save(state);
    }
    return {
      ok: parts.length > 0,
      requiresConfirmation,
      summary: parts.join('\n'),
    };
  }

  private runOnState(
    state: AppState,
    action: MemoryToolAction,
  ): { state?: AppState; result: MemoryToolResult } {
    const all = [...state.memory.summaries, ...state.memory.entries];
    switch (action.action) {
      case 'readMemory': {
        const items = this.memory.relevant(state, { max: 30 });
        return { result: { ok: true, summary: `Current memory:\n${memoryEntriesToText(items)}` } };
      }
      case 'editMemory': {
        const exists = all.some((e) => e.id === action.id);
        if (!exists) return { result: { ok: false, summary: `Memory entry not found: ${action.id}` } };
        const next = this.memory.update(state, action.id, { content: action.content });
        return { state: next, result: { ok: true, summary: `Edited memory entry ${action.id}.` } };
      }
      case 'deleteMemory': {
        const exists = all.some((e) => e.id === action.id);
        if (!exists) return { result: { ok: false, summary: `Memory entry not found: ${action.id}` } };
        if (action.confirmed !== true) {
          return {
            result: {
              ok: false,
              requiresConfirmation: true,
              summary: `Preview — confirm deletion of memory entry ${action.id}. Reply with the same action and "confirmed":true.`,
            },
          };
        }
        const next = this.memory.remove(state, action.id);
        return { state: next, result: { ok: true, summary: `Deleted memory entry ${action.id}.` } };
      }
      case 'pinMemory': {
        const exists = all.some((e) => e.id === action.id);
        if (!exists) return { result: { ok: false, summary: `Memory entry not found: ${action.id}` } };
        const next = this.memory.setLongTerm(state, [action.id], true);
        return { state: next, result: { ok: true, summary: `Pinned ${action.id} to long-term memory.` } };
      }
      case 'unpinMemory': {
        const exists = all.some((e) => e.id === action.id);
        if (!exists) return { result: { ok: false, summary: `Memory entry not found: ${action.id}` } };
        const next = this.memory.setLongTerm(state, [action.id], false);
        return { state: next, result: { ok: true, summary: `Unpinned ${action.id} from long-term memory.` } };
      }
    }
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

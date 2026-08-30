import type { AppState } from '../../core/domain/state';
import type { StateStore } from '../../core/ports/repositories';
import type { MemoryService } from '../ai/memory.service';
import {
  memoryToolActionSchema,
  memoryToolBatchSchema,
  MAX_MEMORY_TOOL_ACTIONS,
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

    // {"actions": [...]} — validate the shape, then cap defensively so a huge
    // batch can never drop entirely just because it exceeds the limit.
    if (typeof parsed === 'object' && parsed !== null && 'actions' in parsed) {
      const batch = memoryToolBatchSchema.safeParse(parsed);
      return batch.success ? batch.data.actions.slice(0, MAX_MEMORY_TOOL_ACTIONS) : [];
    }

    if (Array.isArray(parsed)) {
      const out: MemoryToolAction[] = [];
      for (const item of parsed.slice(0, MAX_MEMORY_TOOL_ACTIONS)) {
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
    const limited = actions.slice(0, MAX_MEMORY_TOOL_ACTIONS);
    if (limited.length === 0) return { ok: false, summary: 'Koi memory action nahi mila.' };
    const parts: string[] = [];
    let anyOk = false;
    let requiresConfirmation = false;
    let state = this.store.get();
    for (const action of limited) {
      const result = this.runOnState(state, action);
      if (result.result.requiresConfirmation) requiresConfirmation = true;
      if (result.state) state = result.state;
      parts.push(result.result.summary);
      if (result.result.ok) {
        anyOk = true;
        this.store.save(state);
      }
    }
    return {
      // ok means "at least one action applied" — a batch where every action
      // failed (wrong ids etc.) must not look like a success.
      ok: anyOk,
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
      case 'searchMemory': {
        const query = action.query?.toLowerCase().trim();
        const type = action.type;
        const tag = action.tag?.toLowerCase().trim();
        let list = [...state.memory.summaries, ...state.memory.entries];
        if (type && type !== 'all') {
          list = list.filter((e) => e.type === type);
        }
        if (tag) {
          list = list.filter((e) => e.context.tags.some((t) => t.toLowerCase().includes(tag)));
        }
        if (query) {
          list = list.filter((e) => e.content.toLowerCase().includes(query) || e.context.tags.some((t) => t.toLowerCase().includes(query)));
        }
        if (list.length === 0) {
          return { result: { ok: true, summary: `Memory search: "${query || tag || type || 'all'}" se related koi saved memory nahi mili.` } };
        }
        return { result: { ok: true, summary: `Memory search results (${list.length} matches):\n${memoryEntriesToText(list, 20)}` } };
      }
      case 'addMemory': {
        const next = this.memory.add(state, {
          type: action.type ?? 'observation',
          content: action.content,
          source: 'user',
          importance: action.importance,
        });
        return { state: next, result: { ok: true, summary: `Memory mein save kar diya: ${action.content}` } };
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
          const entry = all.find((e) => e.id === action.id);
          const label = entry ? (entry.content.length > 90 ? `${entry.content.slice(0, 89)}…` : entry.content) : action.id;
          return {
            result: {
              ok: false,
              requiresConfirmation: true,
              summary: `⚠️ Ye memory entry delete kar doon?\n"${label}"\n\nHaan bolo toh main delete kar dungi.`,
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

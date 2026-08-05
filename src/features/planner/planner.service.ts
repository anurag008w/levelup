// Planner feature service — CRUD + import for uploaded subject planners, and
// the deterministic read-only tool executor used by the MISA AI decision hop.
// All mutations go through the StateStore so the UI snapshot and sync stay in sync.

import type { AppState } from '../../core/domain/state';
import type { StateStore } from '../../core/ports/repositories';
import {
  availableSubjects,
  inDateRange,
  isPlannerQuery,
  normalizeDate,
  parsePlannerImport,
  plannerListToText,
  plannerToText,
  subjectToText,
  testRowsToText,
  testsCoveringSubjectText,
  routineToText,
  groupBySubject,
  normalizePlanner,
  plannerToolActionSchema,
  plannerToolBatchSchema,
  type PlannerToolAction,
  type PlannerToolResult,
  type SubjectPlanner,
} from '../../core/domain/subject-planner';

/** Max tool actions executed per batch. The schema caps the input at 100 too. */
const MAX_BATCH_ACTIONS = 100;

export interface PlannerImportResult {
  added: number;
  skipped: number;
  addedIds: string[];
}

/** CRUD + import for user-uploaded subject planners. */
export class PlannerService {
  private readonly store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
  }

  list(): SubjectPlanner[] {
    return this.store.get().subjectPlanners ?? [];
  }

  /** Unique subject names, sorted (case-insensitive). */
  subjects(): string[] {
    const names = new Set(this.list().map((p) => p.subject));
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  getById(id: string): SubjectPlanner | undefined {
    return this.list().find((p) => p.id === id);
  }

  /**
   * Parses + appends planners from a raw import payload. Planners whose
   * subject+title already exist are skipped so re-importing the same export
   * never duplicates rows.
   */
  importPlanners(text: string, meta: { source: 'file' | 'paste'; fileName?: string } = { source: 'paste' }): PlannerImportResult {
    const parsed = parsePlannerImport(text);
    const current = this.list();
    const existing = new Set(current.map((p) => keyOf(p)));
    const seen = new Set<string>();
    const added: SubjectPlanner[] = [];
    for (const p of parsed) {
      const key = keyOf(p);
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      added.push({
        ...p,
        source: meta.source,
        fileName: meta.source === 'file' ? meta.fileName : undefined,
      });
    }
    if (added.length === 0) return { added: 0, skipped: parsed.length, addedIds: [] };
    this.save([...current, ...added]);
    return { added: added.length, skipped: parsed.length - added.length, addedIds: added.map((p) => p.id) };
  }

  /** Appends one fully-formed planner (used by manual creation / future AI writes). */
  addPlanner(planner: SubjectPlanner): void {
    this.save([...this.list(), normalizePlanner(planner) ?? planner]);
  }

  remove(id: string): boolean {
    const next = this.list().filter((p) => p.id !== id);
    if (next.length === this.list().length) return false;
    this.save(next);
    return true;
  }

  /** Toggles the "done" flag of one planner item. */
  toggleItem(plannerId: string, itemId: string, done: boolean): boolean {
    const next = this.list().map((p) => {
      if (p.id !== plannerId) return p;
      return {
        ...p,
        updatedAt: new Date().toISOString(),
        items: p.items.map((i) => (i.id === itemId ? { ...i, done } : i)),
      };
    });
    if (!next.some((p) => p.id === plannerId)) return false;
    this.save(next);
    return true;
  }

  /** Pure reshape for tool execution that does not persist. */
  toState(state: AppState, planners: SubjectPlanner[]): AppState {
    return { ...state, subjectPlanners: planners };
  }

  private save(planners: SubjectPlanner[]): void {
    const state = this.store.get();
    this.store.save(this.toState(state, planners));
  }
}

function keyOf(p: SubjectPlanner): string {
  return `${p.subject.trim().toLowerCase()}\u0000${p.title.trim().toLowerCase()}`;
}

/** Executes the read-only planner tool actions deterministically. */
export class PlannerToolsService {
  private readonly store: StateStore;
  private readonly planner: PlannerService;

  constructor(store: StateStore, planner: PlannerService) {
    this.store = store;
    this.planner = planner;
  }

  isPlannerQuery(text: string): boolean {
    return isPlannerQuery(text);
  }

  /** True when the student imported at least one coaching planner. */
  hasPlannerData(): boolean {
    return this.planner.list().length > 0;
  }

  parseTools(text: string): PlannerToolAction[] {
    const parsed = tryJson(text);
    if (parsed === null) return [];

    if (typeof parsed === 'object' && parsed !== null && 'actions' in parsed) {
      const batch = plannerToolBatchSchema.safeParse(parsed);
      return batch.success ? batch.data.actions.slice(0, MAX_BATCH_ACTIONS) : [];
    }
    if (Array.isArray(parsed)) {
      const out: PlannerToolAction[] = [];
      for (const item of parsed.slice(0, MAX_BATCH_ACTIONS)) {
        const single = plannerToolActionSchema.safeParse(item);
        if (single.success) out.push(single.data);
      }
      return out;
    }
    const single = plannerToolActionSchema.safeParse(parsed);
    return single.success ? [single.data] : [];
  }

  async runMany(actions: PlannerToolAction[]): Promise<PlannerToolResult> {
    if (actions.length === 0) return { ok: false, summary: 'Koi planner action nahi mila.' };
    const parts: string[] = [];
    let anyOk = false;
    let anyRetryable = false;
    for (const action of actions.slice(0, MAX_BATCH_ACTIONS)) {
      const result = this.run(this.planner.list(), action);
      if (result.ok) anyOk = true;
      if (result.retryable) anyRetryable = true;
      parts.push(result.summary);
    }
    return {
      ok: anyOk,
      summary: parts.join('\n'),
      // Retryable only when nothing succeeded — a mixed batch that partially
      // worked must not trigger a wholesale fix hop.
      ...(anyRetryable && !anyOk ? { retryable: true } : {}),
    };
  }

  private run(planners: SubjectPlanner[], action: PlannerToolAction): PlannerToolResult {
    switch (action.action) {
      case 'listPlanners': {
        if (action.type) {
          const filtered = planners.filter((p) => p.kind === action.type);
          if (filtered.length === 0) {
            return {
              ok: false,
              retryable: true,
              summary: `"${action.type}" type ka koi planner upload nahi hai. Available types: subject, test, routine. Pehle listPlanners (bina type) call karo.`,
            };
          }
          return { ok: true, summary: plannerListToText(filtered) };
        }
        return { ok: true, summary: plannerListToText(planners) };
      }
      case 'getSubject': {
        const wanted = action.subject.trim().toLowerCase();
        const from = action.from ? normalizeDate(action.from) : null;
        const to = action.to ? normalizeDate(action.to) : null;
        const match = (p: SubjectPlanner): boolean => p.subject.toLowerCase() === wanted;
        const subjectPlanners = planners.filter((p) => p.kind === 'subject');
        const bySubject = groupBySubject(subjectPlanners);
        // Exact subject first; fall back to a contains match for partial names.
        const list = bySubject.get(action.subject.trim()) ?? subjectPlanners.filter(match);
        let listSummary = '';
        if (list.length > 0) {
          if (from || to) {
            const filtered = list
              .map((p) => ({ ...p, items: p.items.filter((i) => inDateRange(i.date, from, to)) }))
              .filter((p) => p.items.length > 0);
            if (filtered.length > 0) listSummary = subjectToText(filtered);
          } else {
            listSummary = subjectToText(list);
          }
        }
        const covering = testsCoveringSubjectText(planners, wanted, from, to);
        if (!listSummary && !covering) {
          const suggestion = availableSubjects(planners).map((s) => `"${s}"`).join(', ');
          return {
            ok: false,
            retryable: true,
            summary: `Subject "${action.subject}"${from || to ? ' is date range mein' : ''} ka koi planner/test nahi hai.${suggestion ? ` Available: ${suggestion}. Pehle listPlanners call karo.` : ''}`,
          };
        }
        return { ok: true, summary: [listSummary, covering].filter(Boolean).join('\n\n') };
      }
      case 'getPlanner': {
        const planner = planners.find((p) => p.id === action.plannerId);
        if (!planner) {
          return {
            ok: false,
            retryable: true,
            summary: `Planner "${action.plannerId}" nahi mila. Pehle listPlanners se exact planner id le lo, phir retry karo.`,
          };
        }
        return { ok: true, summary: plannerToText(planner) };
      }
      case 'getTest': {
        const wanted = action.testName.trim().toLowerCase();
        const rows = planners
          .filter((p) => p.kind === 'test')
          .flatMap((p) => (p.tests ?? []).map((test) => ({ plannerId: p.id, batch: p.subject, test })));
        const exact = rows.filter((r) => r.test.name.toLowerCase() === wanted);
        const matched = exact.length > 0 ? exact : rows.filter((r) => r.test.name.toLowerCase().includes(wanted));
        if (matched.length === 0) {
          const names = [...new Set(rows.map((r) => r.test.name))];
          return {
            ok: false,
            retryable: true,
            summary: `"${action.testName}" naam ka koi test nahi mila.${names.length > 0 ? ` Available tests: ${names.join(', ')}. Pehle listPlanners call karo.` : ' Pehle listPlanners call karo.'}`,
          };
        }
        return { ok: true, summary: testRowsToText(matched.map((r) => r.test)) };
      }
      case 'getTests': {
        const from = action.from ? normalizeDate(action.from) : null;
        const to = action.to ? normalizeDate(action.to) : null;
        const subj = action.subject?.trim().toLowerCase();
        const rows = planners
          .filter((p) => p.kind === 'test')
          .flatMap((p) => (p.tests ?? []).map((test) => ({ plannerId: p.id, batch: p.subject, test })));
        let matched = rows;
        if (subj) matched = matched.filter((r) => Object.keys(r.test.syllabus ?? {}).some((s) => s.toLowerCase() === subj));
        if (from || to) matched = matched.filter((r) => inDateRange(r.test.date, from, to));
        if (matched.length === 0) {
          const names = [...new Set(rows.map((r) => r.test.name))];
          return {
            ok: false,
            retryable: true,
            summary: `Is date range${subj ? ` / subject "${action.subject}"` : ''} mein koi test nahi mila.${names.length > 0 ? ` Available tests: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ' …' : ''}. Pehle listPlanners ya getTests (bina range) call karo.` : ' Pehle listPlanners call karo.'}`,
          };
        }
        const sorted = [...matched].sort(
          (a, b) =>
            (normalizeDate(a.test.date) ?? '9999-12-31').localeCompare(normalizeDate(b.test.date) ?? '9999-12-31') ||
            a.test.name.localeCompare(b.test.name),
        );
        return { ok: true, summary: testRowsToText(sorted.map((r) => r.test)) };
      }
      case 'getRoutine': {
        const rows = planners
          .filter((p) => p.kind === 'routine')
          .flatMap((p) => (p.routine ?? []).map((r) => ({ batch: p.subject, day: r.day, slots: r.slots })));
        if (rows.length === 0) {
          return { ok: false, retryable: false, summary: 'Koi routine/time-table upload nahi hua hai. Pehle listPlanners call karo.' };
        }
        const wanted = action.day?.trim().toLowerCase();
        if (!wanted) return { ok: true, summary: routineToText(rows) };
        const matched = rows.filter(
          (r) => r.day.toLowerCase() === wanted || r.day.toLowerCase().includes(wanted) || wanted.includes(r.day.toLowerCase()),
        );
        if (matched.length === 0) {
          const days = [...new Set(rows.map((r) => r.day))];
          return {
            ok: false,
            retryable: true,
            summary: `"${action.day}" ka routine nahi mila.${days.length > 0 ? ` Available days: ${days.join(', ')}. Pehle listPlanners call karo.` : ''}`,
          };
        }
        return { ok: true, summary: routineToText(matched) };
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

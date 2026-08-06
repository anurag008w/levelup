import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../../../core/domain/state';
import type { AppState } from '../../../core/domain/state';
import type { StateStore } from '../../../core/ports/repositories';
import { PlannerService, PlannerToolsService } from '../planner.service';
import {
  isPlannerQuery,
  parsePlannerImport,
  PLANNER_CONVERSION_PROMPT,
  plannerActionForQuery,
  plannerCountLabel,
  plannerToText,
  sortPlannerItems,
  type PlannerItem,
  type SubjectPlanner,
} from '../../../core/domain/subject-planner';
import { normalizeState } from '../../../infra/storage/state-repository';
import { stateSyncPayload } from '../../sync/sync.service';

function makeStore(state: AppState): StateStore {
  return {
    get: () => state,
    save: (s: AppState) => {
      state = s;
    },
  };
}

const SAMPLE_IMPORT = JSON.stringify({
  version: 1,
  type: 'levelup-subject-planner',
  planners: [
    {
      subject: 'Physics',
      title: 'Class 11 Physics',
      description: 'Full syllabus',
      items: [
        { title: 'Kinematics', type: 'chapter', week: 1, details: 'Page 12-40' },
        { title: 'Free fall practice', type: 'task', week: 1 },
        { title: 'Laws of Motion', type: 'chapter', week: 2 },
      ],
    },
    {
      subject: 'Chemistry',
      title: 'Organic Chemistry',
      items: [{ title: 'GOC', type: 'chapter', week: 3 }],
    },
  ],
});

const SAMPLE_V2_IMPORT = JSON.stringify({
  version: 2,
  type: 'levelup-subject-planner',
  planners: [
    {
      kind: 'subject',
      subject: 'Maths',
      title: 'Algebra',
      items: [
        { title: 'Determinants', type: 'chapter', week: 4, date: '2026-07-10' },
        { title: 'Matrices', type: 'chapter', week: 5, date: 'Monday, July 13, 2026' },
      ],
    },
    {
      kind: 'test',
      subject: 'Lakshya JEE 2.0 2027',
      title: 'Full Test Schedule',
      tests: [
        {
          name: 'Short Test-1',
          date: 'Sunday, July 5, 2026',
          testType: 'Part Test',
          pattern: 'Short Test',
          syllabus: {
            Physics: ['Electrostatic Introduction', 'Electrostatic Potential'],
            Chemistry: ['Binary Solution', 'Concentration Terms'],
            Maths: ['Determinants (Complete Chapter)'],
          },
        },
        {
          name: 'JEE Main-1',
          date: 'Sunday, July 19, 2026',
          pattern: 'JEE Main',
          syllabus: { Physics: ['Electrostatics of Conductor'], Maths: ['Matrices (Complete Chapter)'] },
        },
      ],
    },
    {
      kind: 'routine',
      subject: 'Routine',
      title: 'Class Timetable',
      routine: [
        {
          day: 'MONDAY',
          slots: [
            { time: '04.00 PM - 05.45 PM', activity: 'PHYSICS' },
            { time: '06.15 PM - 8.00 PM', activity: 'MATHEMATICS' },
          ],
        },
        { day: 'TUESDAY', slots: [{ time: '04.00 PM - 05.45 PM', activity: 'PHYSICS' }] },
      ],
    },
  ],
});

describe('PlannerService', () => {
  it('imports planners, normalizes them and dedupes subject+title on re-import', () => {
    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);

    const first = planner.importPlanners(SAMPLE_IMPORT, { source: 'file', fileName: 'syllabus.json' });
    expect(first.added).toBe(2);
    expect(first.skipped).toBe(0);

    state = store.get();
    expect(state.subjectPlanners).toHaveLength(2);
    expect(state.subjectPlanners[0].items).toHaveLength(3);
    // Default item type + generated ids.
    expect(state.subjectPlanners[0].items[1].type).toBe('task');
    expect(state.subjectPlanners[0].items[0].id).toMatch(/^pl_/);
    expect(state.subjectPlanners[1].items[0].type).toBe('chapter');

    // Re-import of the same payload is a no-op.
    const again = planner.importPlanners(SAMPLE_IMPORT);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
    expect(store.get().subjectPlanners).toHaveLength(2);

    // Same subject, different title → new planner allowed.
    const extra = JSON.stringify({
      version: 1,
      type: 'levelup-subject-planner',
      planners: [{ subject: 'Physics', title: 'Physics Weekly Routine', items: [{ title: 'Revision' }] }],
    });
    const third = planner.importPlanners(extra);
    expect(third.added).toBe(1);
    expect(store.get().subjectPlanners).toHaveLength(3);
    expect(planner.subjects()).toEqual(['Chemistry', 'Physics']);
  });

  it('rejects non-LevelUp JSON with a friendly error', () => {
    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    expect(() => planner.importPlanners('{"foo":1}')).toThrow(/LevelUp planner format/);
    expect(() => planner.importPlanners('not json at all')).toThrow(/JSON valid nahi/);
  });

  it('removes and toggles items through the store', () => {
    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    planner.importPlanners(SAMPLE_IMPORT);
    state = store.get();
    const id = state.subjectPlanners[0].id;
    const itemId = state.subjectPlanners[0].items[0].id;

    expect(planner.toggleItem(id, itemId, true)).toBe(true);
    expect(store.get().subjectPlanners[0].items[0].done).toBe(true);

    expect(planner.remove(id)).toBe(true);
    expect(store.get().subjectPlanners).toHaveLength(1);
    expect(planner.remove('missing')).toBe(false);
    expect(planner.toggleItem('missing', itemId, true)).toBe(false);
  });
});

describe('PlannerToolsService', () => {
  function setup() {
    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    planner.importPlanners(SAMPLE_IMPORT);
    state = store.get();
    return { tools: new PlannerToolsService(store, planner), state };
  }

  it('lists planners grouped by subject with ids', async () => {
    const { tools } = setup();
    const out = await tools.runMany(tools.parseTools('{"action":"listPlanners"}'));
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('Physics');
    expect(out.summary).toContain('Chemistry');
    expect(out.summary).toContain('id:pl_');
  });

  it('returns a subject detail by exact and partial name', async () => {
    const { tools } = setup();
    const exact = await tools.runMany(tools.parseTools('{"action":"getSubject","subject":"Physics"}'));
    expect(exact.ok).toBe(true);
    expect(exact.summary).toContain('Kinematics');
    expect(exact.summary).toContain('Free fall practice');

    const partial = await tools.runMany(tools.parseTools('{"action":"getSubject","subject":"chemistry"}'));
    expect(partial.ok).toBe(true);
    expect(partial.summary).toContain('GOC');
  });

  it('is retryable when the subject does not exist', async () => {
    const { tools } = setup();
    const out = await tools.runMany(tools.parseTools('{"action":"getSubject","subject":"Biology"}'));
    expect(out.ok).toBe(false);
    expect(out.retryable).toBe(true);
    expect(out.summary).toContain('Physics');
  });

  it('gets a single planner by id and is retryable on a guessed id', async () => {
    const { tools, state } = setup();
    const id = state.subjectPlanners[0].id;
    const out = await tools.runMany(tools.parseTools(`{"action":"getPlanner","plannerId":"${id}"}`));
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('Kinematics');
    expect(out.summary).toContain('Week 1');

    const bad = await tools.runMany(tools.parseTools('{"action":"getPlanner","plannerId":"pl_nope"}'));
    expect(bad.ok).toBe(false);
    expect(bad.retryable).toBe(true);
  });

  it('parses batches and arrays of actions', () => {
    const { tools } = setup();
    const batch = tools.parseTools('{"actions":[{"action":"listPlanners"},{"action":"getSubject","subject":"Physics"}]}');
    expect(batch).toHaveLength(2);
    const arr = tools.parseTools('[{"action":"listPlanners"}]');
    expect(arr).toHaveLength(1);
    expect(tools.parseTools('just normal text')).toHaveLength(0);
  });
});

describe('planner kinds: subject / test / routine', () => {
  it('imports v2 payloads with all three kinds and defaults v1 rows to subject', () => {
    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    const result = planner.importPlanners(SAMPLE_V2_IMPORT, { source: 'file', fileName: 'batch.json' });
    expect(result.added).toBe(3);

    state = store.get();
    const subject = state.subjectPlanners.find((p) => p.kind === 'subject');
    const test = state.subjectPlanners.find((p) => p.kind === 'test');
    const routine = state.subjectPlanners.find((p) => p.kind === 'routine');
    expect(subject).toBeDefined();
    expect(test).toBeDefined();
    expect(routine).toBeDefined();

    expect(test?.subject).toBe('Lakshya JEE 2.0 2027');
    expect(test?.tests).toHaveLength(2);
    expect(test?.tests?.[0].name).toBe('Short Test-1');
    expect(test?.tests?.[0].syllabus.Physics).toEqual(['Electrostatic Introduction', 'Electrostatic Potential']);
    expect(test?.tests?.[1].pattern).toBe('JEE Main');
    expect(test?.tests?.[0].id).toMatch(/^pt_/);

    expect(routine?.routine).toHaveLength(2);
    expect(routine?.routine?.[0].day).toBe('MONDAY');
    expect(routine?.routine?.[0].slots).toHaveLength(2);
    expect(routine?.routine?.[0].id).toMatch(/^pr_/);

    // Version-1 rows still import with kind "subject".
    const v1 = planner.importPlanners(SAMPLE_IMPORT);
    expect(v1.added).toBe(2);
    expect(store.get().subjectPlanners.filter((p) => p.kind === 'subject')).toHaveLength(3);
    // Re-importing the same v2 payload is a no-op (dedupe on subject+title).
    const again = planner.importPlanners(SAMPLE_V2_IMPORT);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(3);
  });

  it('normalizeState keeps all kinds and sanitizes corrupt rows', () => {
    const state = emptyAppState();
    state.subjectPlanners = parsePlannerImport(SAMPLE_V2_IMPORT);
    const normalized = normalizeState({ ...state });
    expect(normalized.subjectPlanners).toHaveLength(3);
    expect(normalized.subjectPlanners.find((p) => p.kind === 'test')?.tests).toHaveLength(2);
    expect(normalized.subjectPlanners.find((p) => p.kind === 'routine')?.routine).toHaveLength(2);

    // Corrupt test/routine rows and legacy rows without a kind.
    const corrupt = normalizeState({
      ...state,
      subjectPlanners: [
        { kind: 'test', subject: 'Batch', title: 'T', tests: [{ name: '', syllabus: { Physics: 'nope' } }, { name: 'OK', syllabus: { Physics: ['Good'] } }] },
        { kind: 'routine', subject: 'Routine', title: 'R', routine: [{ day: 'MONDAY', slots: [{ time: '3 PM', activity: 'X' }, null] }, { day: '' }] },
        { subject: 'Physics', title: 'Legacy', items: [{ title: 'Kinematics' }] },
        null,
        'x',
      ],
    });
    const kept = corrupt.subjectPlanners;
    expect(kept).toHaveLength(3);
    expect(kept.find((p) => p.kind === 'test')?.tests).toHaveLength(1);
    expect(kept.find((p) => p.kind === 'routine')?.routine?.[0].slots).toHaveLength(1);
    const legacy = kept.find((p) => p.kind === 'subject');
    expect(legacy?.kind).toBe('subject');
    expect(legacy?.items).toHaveLength(1);
  });

  it('plannerCountLabel reports items/tests/days per kind', () => {
    const rows = parsePlannerImport(SAMPLE_V2_IMPORT);
    const subject = rows.find((p) => p.kind === 'subject');
    const test = rows.find((p) => p.kind === 'test');
    const routine = rows.find((p) => p.kind === 'routine');
    expect(plannerCountLabel(subject!)).toBe('2 items');
    expect(plannerCountLabel(test!)).toBe('2 tests');
    expect(plannerCountLabel(routine!)).toBe('2 days');
  });

  it('imports one single combined file with all kinds and preserves content verbatim', () => {
    // Hinglish + annotations + special characters must survive byte-for-byte.
    const payload = JSON.stringify({
      version: 2,
      type: 'levelup-subject-planner',
      planners: [
        {
          kind: 'subject',
          subject: 'Physics',
          title: 'Lakshya JEE 2.0 2027 Lectures',
          items: [
            { title: 'Electrostatic Potential/Potential difference', type: 'lecture', details: 'Lec 2 · 16 Jun 2026 · Rahul Dudi Sir' },
            { title: 'Relation between Electric field (E) & Electric potential (V)', type: 'lecture', details: 'Lec 3 · 17 Jun 2026 · Rahul Dudi Sir' },
          ],
        },
        {
          kind: 'test',
          subject: 'Lakshya JEE 2.0 2027',
          title: 'Full Test Schedule',
          tests: [
            {
              name: 'Short Test-1',
              date: 'Sunday, July 5, 2026',
              testType: 'Part Test',
              pattern: 'Short Test',
              syllabus: {
                Physics: ['Electrostatic Introduction', 'Electrostatic Potential/Potential difference'],
                Chemistry: ['Solutions: Binary Solution', 'Determination of Vapour Pressure of a Liquid'],
                Maths: ['Determinants (Complete Chapter)'],
              },
            },
          ],
        },
        {
          kind: 'routine',
          subject: 'Routine',
          title: 'Class Timetable',
          routine: [{ day: 'MONDAY', slots: [{ time: '04.00 PM - 05.45 PM', activity: 'PHYSICS' }, { time: '06.15 PM - 8.00 PM', activity: 'MATHEMATICS' }] }],
        },
      ],
    });

    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    expect(planner.importPlanners(payload, { source: 'paste' }).added).toBe(3);
    state = store.get();

    const physics = state.subjectPlanners.find((p) => p.kind === 'subject')!;
    expect(physics.items[0].title).toBe('Electrostatic Potential/Potential difference');
    expect(physics.items[1].details).toBe('Lec 3 · 17 Jun 2026 · Rahul Dudi Sir');

    const tests = state.subjectPlanners.find((p) => p.kind === 'test')!;
    expect(tests.tests![0].syllabus.Chemistry).toEqual(['Solutions: Binary Solution', 'Determination of Vapour Pressure of a Liquid']);
    expect(tests.tests![0].syllabus.Maths).toEqual(['Determinants (Complete Chapter)']);
    expect(tests.tests![0].date).toBe('Sunday, July 5, 2026');

    const routine = state.subjectPlanners.find((p) => p.kind === 'routine')!;
    expect(routine.routine![0].slots[1]).toEqual({ time: '06.15 PM - 8.00 PM', activity: 'MATHEMATICS' });
  });

  it('accepts a very large single file (raised limits) and caps only the tool summary', () => {
    const items = Array.from({ length: 3000 }, (_, i) => ({ title: `Topic ${i} — (Complete Chapter)`, type: 'lecture' }));
    const payload = JSON.stringify({
      version: 2,
      type: 'levelup-subject-planner',
      planners: [{ kind: 'subject', subject: 'Physics', title: 'Full year', items }],
    });
    const rows = parsePlannerImport(payload);
    expect(rows[0].items).toHaveLength(3000);
    expect(rows[0].items[2999].title).toBe('Topic 2999 — (Complete Chapter)');
    // Tool text stays bounded but reports the true total.
    const text = plannerToText(rows[0]);
    expect(text).toContain('Items (3000):');
    expect(text).toContain('aur 2750 items (total 3000)');
  });
});

describe('planner tools across kinds', () => {
  function setup() {
    let state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    planner.importPlanners(SAMPLE_V2_IMPORT);
    state = store.get();
    return { tools: new PlannerToolsService(store, planner), state };
  }

  it('listPlanners lists test and routine planners with their names', async () => {
    const { tools } = setup();
    const out = await tools.runMany(tools.parseTools('{"action":"listPlanners"}'));
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('Full Test Schedule');
    expect(out.summary).toContain('Short Test-1');
    expect(out.summary).toContain('Class Timetable');
    expect(out.summary).toContain('id:pl_');
  });

  it('getTest returns a test by exact and partial name and is retryable on unknown', async () => {
    const { tools } = setup();
    const exact = await tools.runMany(tools.parseTools('{"action":"getTest","testName":"Short Test-1"}'));
    expect(exact.ok).toBe(true);
    expect(exact.summary).toContain('Electrostatic Introduction');
    expect(exact.summary).toContain('Determinants (Complete Chapter)');
    expect(exact.summary).toContain('July 5, 2026');

    const partial = await tools.runMany(tools.parseTools('{"action":"getTest","testName":"JEE Main"}'));
    expect(partial.ok).toBe(true);
    expect(partial.summary).toContain('JEE Main-1');
    expect(partial.summary).toContain('Matrices (Complete Chapter)');

    const bad = await tools.runMany(tools.parseTools('{"action":"getTest","testName":"xyz"}'));
    expect(bad.ok).toBe(false);
    expect(bad.retryable).toBe(true);
    expect(bad.summary).toContain('Short Test-1');
  });

  it('getRoutine returns the full week and a single day, retryable on unknown day', async () => {
    const { tools } = setup();
    const all = await tools.runMany(tools.parseTools('{"action":"getRoutine"}'));
    expect(all.ok).toBe(true);
    expect(all.summary).toContain('MONDAY');
    expect(all.summary).toContain('04.00 PM - 05.45 PM: PHYSICS');
    expect(all.summary).toContain('TUESDAY');

    const day = await tools.runMany(tools.parseTools('{"action":"getRoutine","day":"monday"}'));
    expect(day.ok).toBe(true);
    expect(day.summary).toContain('MONDAY');
    expect(day.summary).not.toContain('TUESDAY');

    const bad = await tools.runMany(tools.parseTools('{"action":"getRoutine","day":"SUNDAY"}'));
    expect(bad.ok).toBe(false);
    expect(bad.retryable).toBe(true);
    expect(bad.summary).toContain('MONDAY');
  });

  it('getSubject lists subject planners and tests covering that subject', async () => {
    const { tools } = setup();
    const physics = await tools.runMany(tools.parseTools('{"action":"getSubject","subject":"Physics"}'));
    expect(physics.ok).toBe(true);
    expect(physics.summary).toContain('Short Test-1');
    expect(physics.summary).toContain('Electrostatic Potential');
    expect(physics.summary).toContain('Electrostatics of Conductor');

    // Maths has BOTH a subject-kind planner and test rows covering it.
    const maths = await tools.runMany(tools.parseTools('{"action":"getSubject","subject":"Maths"}'));
    expect(maths.ok).toBe(true);
    expect(maths.summary).toContain('Algebra');
    expect(maths.summary).toContain('Determinants');
    expect(maths.summary).toContain('Short Test-1');
  });

  it('getSubject filters subject items by a date range', async () => {
    const { tools } = setup();
    const out = await tools.runMany(tools.parseTools('{"action":"getSubject","subject":"Maths","from":"2026-07-01","to":"2026-07-11"}'));
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('Determinants');
    // "Matrices" is dated 13 July — outside the range, so it must not appear.
    expect(out.summary).not.toContain('Matrices');
  });

  it('listPlanners filters by planner type and is retryable on an empty type', async () => {
    const { tools } = setup();
    const testsOnly = await tools.runMany(tools.parseTools('{"action":"listPlanners","type":"test"}'));
    expect(testsOnly.ok).toBe(true);
    expect(testsOnly.summary).toContain('Full Test Schedule');
    expect(testsOnly.summary).not.toContain('Class Timetable');

    const routineOnly = await tools.runMany(tools.parseTools('{"action":"listPlanners","type":"routine"}'));
    expect(routineOnly.ok).toBe(true);
    expect(routineOnly.summary).toContain('Class Timetable');

    // A valid type with zero matching planners stays retryable...
    const state = emptyAppState();
    const store = makeStore(state);
    const planner = new PlannerService(store);
    planner.importPlanners(SAMPLE_IMPORT);
    const subjectOnlyTools = new PlannerToolsService(store, planner);
    const empty = await subjectOnlyTools.runMany(subjectOnlyTools.parseTools('{"action":"listPlanners","type":"test"}'));
    expect(empty.ok).toBe(false);
    expect(empty.retryable).toBe(true);

    // ...while an invalid enum is rejected at parse time.
    const { tools: fresh } = setup();
    const invalid = await fresh.runMany(fresh.parseTools('{"action":"listPlanners","type":"unknown"}'));
    expect(invalid.ok).toBe(false);
  });

  it('getTests filters by date range and subject, sorted by date', async () => {
    const { tools } = setup();
    const all = await tools.runMany(tools.parseTools('{"action":"getTests"}'));
    expect(all.ok).toBe(true);
    expect(all.summary).toContain('Short Test-1');
    expect(all.summary).toContain('JEE Main-1');

    const july1to10 = await tools.runMany(tools.parseTools('{"action":"getTests","from":"2026-07-01","to":"2026-07-10"}'));
    expect(july1to10.ok).toBe(true);
    expect(july1to10.summary).toContain('Short Test-1');
    expect(july1to10.summary).not.toContain('JEE Main-1');

    const julyPhysics = await tools.runMany(tools.parseTools('{"action":"getTests","from":"2026-07-01","to":"2026-08-31","subject":"Maths"}'));
    expect(julyPhysics.ok).toBe(true);
    expect(julyPhysics.summary).toContain('Short Test-1');
    expect(julyPhysics.summary).toContain('Matrices (Complete Chapter)');

    const none = await tools.runMany(tools.parseTools('{"action":"getTests","from":"2026-09-01","to":"2026-09-30"}'));
    expect(none.ok).toBe(false);
    expect(none.retryable).toBe(true);
  });

  it('getDay returns a whole day at once: tests + dated items + that weekday\'s classes', async () => {
    const { tools } = setup();
    // Sunday 5 July has the Short Test-1 and no routine classes.
    const day = await tools.runMany(tools.parseTools('{"action":"getDay","date":"2026-07-05"}'));
    expect(day.ok).toBe(true);
    expect(day.summary).toContain('Short Test-1');
    expect(day.summary).toContain('Sunday, July 5, 2026');
    // Routine only covers MONDAY/TUESDAY, so no class lines on Sunday.
    expect(day.summary).not.toContain('04.00 PM');

    // Friday 10 July has the dated "Determinants" chapter item.
    const fri = await tools.runMany(tools.parseTools('{"action":"getDay","date":"2026-07-10"}'));
    expect(fri.ok).toBe(true);
    expect(fri.summary).toContain('Determinants');
  });

  it('getDay covers a range and merges classes, tests and lectures per date', async () => {
    const { tools } = setup();
    const range = await tools.runMany(tools.parseTools('{"action":"getDay","from":"2026-07-05","to":"2026-07-11"}'));
    expect(range.ok).toBe(true);
    // Sunday 5 → Short Test-1.
    expect(range.summary).toContain('Short Test-1');
    // Monday 6 → routine Physics + Maths classes.
    expect(range.summary).toContain('PHYSICS');
    expect(range.summary).toContain('MATHEMATICS');
    // Friday 10 → Determinants chapter.
    expect(range.summary).toContain('Determinants');
    // Matrices is 13 July — outside the window.
    expect(range.summary).not.toContain('Matrices');
  });

  it('getDay says when a single day is empty and is retryable on bad input', async () => {
    const { tools } = setup();
    // Wednesday 8 July: no routine, no test, no dated item.
    const empty = await tools.runMany(tools.parseTools('{"action":"getDay","date":"2026-07-08"}'));
    expect(empty.ok).toBe(true);
    expect(empty.summary).toContain('koi class, test ya lecture scheduled nahi');

    const bad = await tools.runMany(tools.parseTools('{"action":"getDay","date":"xyz"}'));
    expect(bad.ok).toBe(false);
    expect(bad.retryable).toBe(true);
    expect(bad.summary).toContain('valid date');

    const inverted = await tools.runMany(tools.parseTools('{"action":"getDay","from":"2026-07-10","to":"2026-07-01"}'));
    expect(inverted.ok).toBe(false);
    expect(inverted.retryable).toBe(true);
    expect(inverted.summary).toContain('range galat');
  });

  it('getPlanner filters dated items and tests by a from/to range', async () => {
    const { tools, state } = setup();
    const subjectId = state.subjectPlanners.find((p) => p.kind === 'subject')!.id;
    const testId = state.subjectPlanners.find((p) => p.kind === 'test')!.id;

    const subj = await tools.runMany(tools.parseTools(`{"action":"getPlanner","plannerId":"${subjectId}","from":"2026-07-01","to":"2026-07-11"}`));
    expect(subj.ok).toBe(true);
    expect(subj.summary).toContain('Determinants');
    // Matrices is dated 13 July — filtered out by the window.
    expect(subj.summary).not.toContain('Matrices');

    const tests = await tools.runMany(tools.parseTools(`{"action":"getPlanner","plannerId":"${testId}","from":"2026-07-01","to":"2026-07-10"}`));
    expect(tests.ok).toBe(true);
    expect(tests.summary).toContain('Short Test-1');
    expect(tests.summary).not.toContain('JEE Main-1');
  });

  it('runs a 100-action mixed batch without failing and caps oversized batches', async () => {
    const { tools } = setup();
    const actions = Array.from({ length: 100 }, (_, i) =>
      i % 3 === 0 ? { action: 'listPlanners' as const } : i % 3 === 1 ? { action: 'getRoutine' as const } : { action: 'getTests' as const },
    );
    const out = await tools.runMany(actions);
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('Full Test Schedule');
    expect(out.summary).toContain('MONDAY');

    // An oversized JSON batch is capped at 100 by the executor.
    const big = JSON.stringify(Array.from({ length: 150 }, () => ({ action: 'listPlanners' })));
    expect(tools.parseTools(big)).toHaveLength(100);
  });
});

describe('planner routing + sync integration', () => {
  it('routes planner/syllabus/subject-list/test/routine queries but never daily-plan or concept questions', () => {
    expect(isPlannerQuery('physics planner batao')).toBe(true);
    expect(isPlannerQuery('mujhe chemistry ka syllabus chahiye')).toBe(true);
    expect(isPlannerQuery('kya kya subjects upload kiye hain')).toBe(true);
    expect(isPlannerQuery('sab subjects dikha')).toBe(true);
    expect(isPlannerQuery('physics mein chapters kya hain')).toBe(true);
    expect(isPlannerQuery('physics mein kya kya hai')).toBe(true);
    expect(isPlannerQuery('chemistry mein kya kya padhna hai')).toBe(true);
    expect(isPlannerQuery('uploaded file mein kya hai')).toBe(true);
    expect(isPlannerQuery('course plan mein kya kya hai')).toBe(true);

    // Test planner queries.
    expect(isPlannerQuery('kaunsa test kab hai')).toBe(true);
    expect(isPlannerQuery('test ka syllabus batao')).toBe(true);
    expect(isPlannerQuery('AITS-1 mein kya aayega')).toBe(true);
    expect(isPlannerQuery('mock test kab hai')).toBe(true);
    expect(isPlannerQuery('jee main kab hai')).toBe(true);
    expect(isPlannerQuery('test planner mein kya kya hai')).toBe(true);

    // Test-schedule inquiries (the reported miss: these went to getTasks).
    expect(isPlannerQuery('tests dekho')).toBe(true);
    expect(isPlannerQuery('test dikhao')).toBe(true);
    expect(isPlannerQuery('test dekhna hai')).toBe(true);
    expect(isPlannerQuery('tests batao')).toBe(true);
    expect(isPlannerQuery('test list dekho')).toBe(true);
    expect(isPlannerQuery('agla test kab hai')).toBe(true);
    expect(isPlannerQuery('kaunse tests hain')).toBe(true);
    expect(isPlannerQuery('upcoming tests')).toBe(true);
    expect(isPlannerQuery('test kya kya hai is hafte')).toBe(true);

    // Schedule questions with a time reference (the reported miss).
    expect(isPlannerQuery('kal koi test ya class hai kya')).toBe(true);
    expect(isPlannerQuery('kal koi test hai kya')).toBe(true);
    expect(isPlannerQuery('aaj koi class hai kya')).toBe(true);
    expect(isPlannerQuery('aaj koi lecture hai kya')).toBe(true);
    expect(isPlannerQuery('is week kaunse tests hain')).toBe(true);
    expect(isPlannerQuery('july mein kya tests hain')).toBe(true);
    expect(isPlannerQuery('kal ka test schedule batao')).toBe(true);

    // Routine / time-table queries.
    expect(isPlannerQuery('routine batao')).toBe(true);
    expect(isPlannerQuery('time table kya hai')).toBe(true);
    expect(isPlannerQuery('class timetable dekhna hai')).toBe(true);
    expect(isPlannerQuery('monday ko kya class hai')).toBe(true);
    expect(isPlannerQuery('saturday ko kaunsa subject hai')).toBe(true);

    // These must keep flowing to the Day 1-90 plan tools / normal chat.
    expect(isPlannerQuery('aaj ka plan kya hai')).toBe(false);
    expect(isPlannerQuery('aaj ka study plan batao')).toBe(false);
    expect(isPlannerQuery('week ka plan dikha')).toBe(false);
    expect(isPlannerQuery('physics concept samjhao')).toBe(false);
    expect(isPlannerQuery('integration kaise solve kare')).toBe(false);
    // No time reference → generic "what is a mock test" stays in normal chat.
    expect(isPlannerQuery('mock test kya hota hai aur kaise prepare kare')).toBe(false);
    expect(isPlannerQuery('mock test ki tyari kaise kare')).toBe(false);
    expect(isPlannerQuery('test kaise diya jaye')).toBe(false);
    expect(isPlannerQuery('hello')).toBe(false);
  });

  it('routes date-range and "uss din" queries to the planner (never task tools)', () => {
    expect(isPlannerQuery('1 se 10 tarikh kya kya hai')).toBe(true);
    expect(isPlannerQuery('1 se 10 july kya kya hai')).toBe(true);
    expect(isPlannerQuery('1 july se 10 july kya kya hai')).toBe(true);
    expect(isPlannerQuery('aaj se 5 din mein kya kya hai')).toBe(true);
    expect(isPlannerQuery('kal se 3 din kya chalega')).toBe(true);
    expect(isPlannerQuery('5 se 14 tak kya kya hai')).toBe(true);
    expect(isPlannerQuery('5 se 14 tak kya hoga')).toBe(true);
    expect(isPlannerQuery('uss din kya kya hai')).toBe(true);
    expect(isPlannerQuery('date wise kya kya hai')).toBe(true);
    expect(isPlannerQuery('tarikh ke hisaab se batao')).toBe(true);

    // Time-of-day phrasing must NOT become a date range.
    expect(isPlannerQuery('5 se 10 baje kya kare')).toBe(false);
    expect(isPlannerQuery('5 se 14 tak padhunga')).toBe(false);
  });

  it('deterministically maps date-range phrasing to a getDay from/to range', () => {
    const today = '2026-08-05'; // Wednesday
    expect(plannerActionForQuery('1 se 10 tarikh kya kya hai', today)).toEqual({
      action: 'getDay',
      from: '2026-08-01',
      to: '2026-08-10',
    });
    expect(plannerActionForQuery('1 se 10 july kya kya hai', today)).toEqual({
      action: 'getDay',
      from: '2026-07-01',
      to: '2026-07-10',
    });
    expect(plannerActionForQuery('1 july se 10 july kya kya hai', today)).toEqual({
      action: 'getDay',
      from: '2026-07-01',
      to: '2026-07-10',
    });
    expect(plannerActionForQuery('aaj se 5 din mein kya kya hai', today)).toEqual({
      action: 'getDay',
      from: '2026-08-05',
      to: '2026-08-09',
    });
    expect(plannerActionForQuery('kal se 3 din kya chalega', today)).toEqual({
      action: 'getDay',
      from: '2026-08-06',
      to: '2026-08-08',
    });
    expect(plannerActionForQuery('5 se 14 tak kya kya hai', today)).toEqual({
      action: 'getDay',
      from: '2026-08-05',
      to: '2026-08-14',
    });
    // Bare ranges resolve to the CURRENT month; clock-time stays a no-match.
    expect(plannerActionForQuery('5 se 10 baje kya kare', today)).toBeNull();
  });

  it('deterministically maps unambiguous planner questions to the exact planner tool', () => {
    const today = '2026-08-05'; // Wednesday
    // Weekday + schedule/class → that weekday's routine.
    expect(plannerActionForQuery('friday ka schedule batao', today)).toEqual({ action: 'getRoutine', day: 'Friday' });
    expect(plannerActionForQuery('monday ko kya class hai', today)).toEqual({ action: 'getRoutine', day: 'Monday' });
    expect(plannerActionForQuery('saturday ko kaunsa subject hai', today)).toEqual({ action: 'getRoutine', day: 'Saturday' });
    expect(plannerActionForQuery('fri ka time table dikhao', today)).toEqual({ action: 'getRoutine', day: 'Friday' });
    // Plain routine/timetable → full week.
    expect(plannerActionForQuery('routine batao', today)).toEqual({ action: 'getRoutine' });
    expect(plannerActionForQuery('time table kya hai', today)).toEqual({ action: 'getRoutine' });
    // Test schedule questions → getTests with a resolved date range.
    expect(plannerActionForQuery('tests dekho', today)).toEqual({ action: 'getTests' });
    expect(plannerActionForQuery('kal koi test hai kya', today)).toEqual({ action: 'getTests', from: '2026-08-06', to: '2026-08-06' });
    expect(plannerActionForQuery('aaj koi test hai kya', today)).toEqual({ action: 'getTests', from: '2026-08-05', to: '2026-08-05' });
    expect(plannerActionForQuery('parso koi test hai kya', today)).toEqual({ action: 'getTests', from: '2026-08-07', to: '2026-08-07' });
    expect(plannerActionForQuery('is week kaunse tests hain', today)).toEqual({ action: 'getTests', from: '2026-08-03', to: '2026-08-09' });
    expect(plannerActionForQuery('july mein kya tests hain', today)).toEqual({ action: 'getTests', from: '2026-07-01', to: '2026-07-31' });
    expect(plannerActionForQuery('agla test kab hai', today)).toEqual({ action: 'getTests' });
    // Subject content questions → getSubject with the canonical subject.
    expect(plannerActionForQuery('physics mein kya kya hai', today)).toEqual({ action: 'getSubject', subject: 'Physics' });
    expect(plannerActionForQuery('chemistry ka syllabus batao', today)).toEqual({ action: 'getSubject', subject: 'Chemistry' });
    expect(plannerActionForQuery('maths mein chapters kya hain', today)).toEqual({ action: 'getSubject', subject: 'Maths' });
    // Ambiguous / non-planner messages → null (LLM decision hop decides).
    expect(plannerActionForQuery('friday ka plan batao', today)).toBeNull();
    expect(plannerActionForQuery('aaj ka plan kya hai', today)).toBeNull();
    expect(plannerActionForQuery('aaj ka study plan batao', today)).toBeNull();
    expect(plannerActionForQuery('mock test kya hota hai', today)).toBeNull();
    expect(plannerActionForQuery('physics concept samjhao', today)).toBeNull();
    expect(plannerActionForQuery('hello', today)).toBeNull();
  });

  it('persists planners through the existing state normalize + sync payload (no new flow)', () => {
    const state = emptyAppState();
    state.subjectPlanners = parsePlannerImport(SAMPLE_IMPORT);

    const normalized = normalizeState({ ...state });
    expect(normalized.subjectPlanners).toHaveLength(2);
    expect(normalized.subjectPlanners[0].items[0].title).toBe('Kinematics');

    const payload = stateSyncPayload(normalized) as { subjectPlanners?: SubjectPlanner[] };
    expect(Array.isArray(payload.subjectPlanners)).toBe(true);
    expect(payload.subjectPlanners).toHaveLength(2);

    // normalizeState defends against malformed/corrupt planner rows.
    const sanitized = normalizeState({ ...state, subjectPlanners: [{ bad: true }, null, 'x'] });
    expect(sanitized.subjectPlanners).toHaveLength(0);
  });

  it('exposes a copyable conversion prompt describing the exact JSON format', () => {
    expect(PLANNER_CONVERSION_PROMPT).toContain('levelup-subject-planner');
    expect(PLANNER_CONVERSION_PROMPT).toContain('"version": 2');
    expect(PLANNER_CONVERSION_PROMPT).toContain('"planners"');
    expect(PLANNER_CONVERSION_PROMPT).toContain('"kind"');
    expect(PLANNER_CONVERSION_PROMPT).toContain('"tests"');
    expect(PLANNER_CONVERSION_PROMPT).toContain('"routine"');
    expect(PLANNER_CONVERSION_PROMPT).toContain('chapter');
    // Single-file support: the prompt converts the WHOLE file in one shot.
    expect(PLANNER_CONVERSION_PROMPT).toContain('WHOLE file');
    expect(PLANNER_CONVERSION_PROMPT).toContain('ONE JSON');
    expect(PLANNER_CONVERSION_PROMPT).toContain('Do NOT translate');
  });

  it('sorts lectures chronologically when their date lives only inside details', () => {
    // Real scenario: imported lecture rows carry no `date` field — the date is
    // embedded in `details`. Sorting must read it from there, otherwise the UI
    // falls back to alphabetical title order (Lec 2, Lec 3, Lec 1).
    const items: PlannerItem[] = [
      { id: 'l3', title: 'Solubility', type: 'lecture', details: 'Lec 3 · Physical Chemistry · 19 Jun 2026 · Rahul Dudi Sir' },
      { id: 'l1', title: 'Binary Solution', type: 'lecture', details: 'Lec 1 · Physical Chemistry · 16 Jun 2026 · Rahul Dudi Sir' },
      { id: 'l2', title: 'Concentration Terms', type: 'lecture', details: 'Lec 2 · Physical Chemistry · 17 Jun 2026 · Rahul Dudi Sir' },
    ];
    const sorted = sortPlannerItems(items);
    expect(sorted.map((i) => i.id)).toEqual(['l1', 'l2', 'l3']);
  });
});

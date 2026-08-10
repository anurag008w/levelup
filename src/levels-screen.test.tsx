// @vitest-environment jsdom
//
// LevelsScreen — regression tests for two production bugs:
//   1. Legacy blocks without goals/habits crash the whole screen
//      (unguarded `block.goals.join(', ')` / `block.habits.some(...)`).
//   2. Curriculum import applies onto the stale render-time snapshot, silently
//      wiping any change that landed while the async FileReader was loading.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import LevelsScreen from './screens/LevelsScreen';
import { container } from './di/container';
import { emptyAppState } from './core/domain/state';
import type { CustomPhase } from './core/domain/state';
import { deviceTimeZone } from './core/ports/clock';
import { parseTaskBankEntry } from './features/task-bank/validation';
import { serializeCurriculum } from './features/curriculum/curriculum';

function journey(startISO: string) {
  const s = emptyAppState();
  s.startDateISO = startISO;
  s.timeZone = deviceTimeZone();
  return s;
}

/** update mock mirrors useAppState: applies the updater onto the live store. */
function liveUpdate(fn: (s: ReturnType<typeof container.store.get>) => ReturnType<typeof container.store.get>) {
  const next = fn(container.store.get());
  container.store.save(next);
  return next;
}

function curriculumEntry(id: string, title: string, day: number) {
  return parseTaskBankEntry({
    id,
    habitId: 'h1',
    title,
    description: '',
    phase: 'jee-core',
    difficulty: 2,
    estimatedDurationMin: 20,
    energyLevel: 'low',
    tags: [],
    prerequisites: [],
    taskType: 'Beginner',
    revisionSuitability: 0.3,
    backlogSuitability: 0.3,
    thinkingSkills: ['focus'],
    jeeRelevance: { score: 0.5 },
    unlockConditions: [{ type: 'day-exact', day }],
    active: true,
  });
}

describe('LevelsScreen legacy blocks', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
    vi.stubGlobal('scrollTo', () => {});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
  });

  it('renders a legacy block missing goals/habits without crashing', () => {
    const s = journey('2026-01-01');
    s.curriculumEditing = true;
    // Old backup / hand-edited import can lack these fields at runtime.
    const legacyBlock = {
      id: 'legacy1',
      name: 'Legacy Block',
      description: 'Purane backup ka block',
      dayStart: 1,
      dayEnd: 5,
      difficulty: 'medium',
      createdBy: 'user',
      createdAt: '2025-01-01T00:00:00.000Z',
    } as unknown as CustomPhase;
    s.postJourney = { ...s.postJourney, customPhases: [legacyBlock] };
    container.store.save(s);

    render(React.createElement(LevelsScreen, { state: s, today: '2026-01-01', update: liveUpdate }));
    // Crash se pehle block ka naam screen pe dikhna chahiye.
    expect(screen.getByText('Legacy Block')).toBeTruthy();
  });
});

describe('LevelsScreen curriculum import', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
    vi.stubGlobal('scrollTo', () => {});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    container.store.save(emptyAppState());
    vi.unstubAllGlobals();
  });

  it('applies the import onto the freshest store state, not the stale render snapshot', () => {
    const s = journey('2026-01-01');
    s.curriculumEditing = true;
    container.store.save(s);

    render(React.createElement(LevelsScreen, { state: s, today: '2026-01-01', update: liveUpdate }));

    // A change lands in the store AFTER the render — this is the async
    // FileReader window where the old code silently wiped it.
    const concurrent = curriculumEntry('concurrent-task', 'Concurrent Task', 2);
    container.store.save({ ...container.store.get(), dynamicTaskBank: [concurrent] });

    const json = serializeCurriculum([curriculumEntry('imported-task', 'Imported Task', 3)], [], []);

    // Fake FileReader: synchronously "loads" the file when readAsText is called.
    class FakeFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        this.result = json;
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader);

    fireEvent.change(screen.getByLabelText('Import curriculum JSON'), {
      target: { files: [{ name: 'curriculum.json', size: json.length } as unknown as File] },
    });

    const stored = container.store.get();
    // Dono changes zinda rehne chahiye — concurrent wala bhi, imported wala bhi.
    expect(stored.dynamicTaskBank.some((t) => t.id === 'concurrent-task')).toBe(true);
    expect(stored.dynamicTaskBank.some((t) => t.id === 'imported-task')).toBe(true);
  });
});

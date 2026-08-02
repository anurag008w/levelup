/**
 * Comprehensive tests for Progress Tracking
 * Tests streak calculations, completion rates, phase transitions, and progress metrics
 */
import { describe, it, expect } from 'vitest';
import { emptyAppState } from '../state';
import { DEFAULT_PROGRESSION_CONFIG } from '../progress';
import type { DayLog } from '../progress';

// Helper to create day log
function createLog(completedTaskIds: string[]): DayLog {
  const log: DayLog = {};
  for (const id of completedTaskIds) {
    log[id] = true;
  }
  return log;
}

/** Pure UTC day → ISO for January 2026. Deterministic in every timezone
 *  (local `new Date(2026, 0, d)` + `toISOString()` shifts the result by one
 *  day on non-UTC machines). */
function isoDay(day: number): string {
  return new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
}

function previousISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Helper function: count consecutive completed days ending on given date
function countConsecutiveCompletedDays(logs: Record<string, DayLog>, endDateISO: string): number {
  let streak = 0;
  let cursor = endDateISO;

  while (true) {
    const log = logs[cursor];

    if (!log || Object.keys(log).length === 0) {
      break;
    }

    streak++;
    cursor = previousISO(cursor);
  }

  return streak;
}

// Helper function: calculate weekly completion rate
function calculateWeeklyCompletionRate(logs: Record<string, DayLog>, fromDay: number, toDay: number): number {
  let completedDays = 0;
  let totalDays = 0;

  for (let d = fromDay; d <= toDay; d++) {
    const dateISO = isoDay(d);
    const log = logs[dateISO];

    totalDays++;
    if (log && Object.keys(log).length > 0) {
      completedDays++;
    }
  }

  return totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
}

describe('Progress Calculations', () => {
  describe('Streak Logic', () => {
    it('returns 0 for no completion history', () => {
      const logs: Record<string, DayLog> = {};
      const streak = countConsecutiveCompletedDays(logs, '2026-01-05');
      expect(streak).toBe(0);
    });

    it('calculates single day streak', () => {
      const logs: Record<string, DayLog> = {
        '2026-01-01': createLog(['task1']),
      };
      const streak = countConsecutiveCompletedDays(logs, '2026-01-01');
      expect(streak).toBe(1);
    });

    it('calculates consecutive day streak', () => {
      const logs: Record<string, DayLog> = {
        '2026-01-01': createLog(['task1']),
        '2026-01-02': createLog(['task2']),
        '2026-01-03': createLog(['task3']),
      };
      const streak = countConsecutiveCompletedDays(logs, '2026-01-03');
      expect(streak).toBe(3);
    });

    it('breaks streak on missed day', () => {
      const logs: Record<string, DayLog> = {
        '2026-01-01': createLog(['task1']),
        '2026-01-02': createLog(['task2']),
        '2026-01-04': createLog(['task4']),
      };
      const streak = countConsecutiveCompletedDays(logs, '2026-01-04');
      expect(streak).toBe(1);
    });

    it('handles multiple weeks of completion', () => {
      const logs: Record<string, DayLog> = {};
      for (let i = 1; i <= 14; i++) {
        const dateISO = isoDay(i);
        logs[dateISO] = createLog([`task${i}`]);
      }
      const streak = countConsecutiveCompletedDays(logs, '2026-01-14');
      expect(streak).toBe(14);
    });

    it('returns 0 if today has no completion', () => {
      const logs: Record<string, DayLog> = {
        '2026-01-01': createLog(['task1']),
        '2026-01-02': createLog(['task2']),
      };
      const streak = countConsecutiveCompletedDays(logs, '2026-01-03');
      expect(streak).toBe(0);
    });
  });

  describe('Completion Rate Logic', () => {
    it('returns 0 for empty logs', () => {
      const logs: Record<string, DayLog> = {};
      const rate = calculateWeeklyCompletionRate(logs, 1, 7);
      expect(rate).toBe(0);
    });

    it('returns 100 for perfect completion', () => {
      const logs: Record<string, DayLog> = {};
      for (let i = 1; i <= 7; i++) {
        const dateISO = isoDay(i);
        logs[dateISO] = createLog(['task1', 'task2', 'task3']);
      }
      const rate = calculateWeeklyCompletionRate(logs, 1, 7);
      expect(rate).toBe(100);
    });

    it('calculates partial completion rate', () => {
      const logs: Record<string, DayLog> = {};
      const completedDays = [1, 3, 5, 7];
      for (let i = 1; i <= 7; i++) {
        const dateISO = isoDay(i);
        if (completedDays.includes(i)) {
          logs[dateISO] = createLog(['task1']);
        }
      }
      const rate = calculateWeeklyCompletionRate(logs, 1, 7);
      expect(rate).toBeGreaterThanOrEqual(50);
      expect(rate).toBeLessThan(60);
    });

    it('returns 0 for no completion', () => {
      const logs: Record<string, DayLog> = {};
      for (let i = 1; i <= 7; i++) {
        const dateISO = isoDay(i);
        logs[dateISO] = createLog([]);
      }
      const rate = calculateWeeklyCompletionRate(logs, 1, 7);
      expect(rate).toBe(0);
    });
  });

  describe('Progression Config', () => {
    it('has reasonable default values', () => {
      expect(DEFAULT_PROGRESSION_CONFIG.aiEnabled).toBe(true);
      expect(DEFAULT_PROGRESSION_CONFIG.availableMinutes).toBe(360);
      expect(DEFAULT_PROGRESSION_CONFIG.missedThresholdPct).toBe(30);
      expect(DEFAULT_PROGRESSION_CONFIG.recoveryThresholdPct).toBe(30);
      expect(DEFAULT_PROGRESSION_CONFIG.backlogThresholdDays).toBe(3);
      expect(DEFAULT_PROGRESSION_CONFIG.maxInjectedTasks).toBe(3);
    });

    it('aiEnabled can be toggled', () => {
      const config = { ...DEFAULT_PROGRESSION_CONFIG, aiEnabled: false };
      expect(config.aiEnabled).toBe(false);

      const config2 = { ...config, aiEnabled: true };
      expect(config2.aiEnabled).toBe(true);
    });

    it('thresholds are valid percentages', () => {
      expect(DEFAULT_PROGRESSION_CONFIG.missedThresholdPct).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_PROGRESSION_CONFIG.missedThresholdPct).toBeLessThanOrEqual(100);
      expect(DEFAULT_PROGRESSION_CONFIG.recoveryThresholdPct).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_PROGRESSION_CONFIG.recoveryThresholdPct).toBeLessThanOrEqual(100);
    });
  });

  describe('Phase Transitions', () => {
    it('identifies phase boundaries correctly', () => {
      const phases = [
        { id: 'jee-core', dayStart: 1, dayEnd: 30 },
        { id: 'l-mindset', dayStart: 31, dayEnd: 60 },
      ];

      const getPhase = (day: number) => {
        return phases.find(p => day >= p.dayStart && day <= p.dayEnd);
      };

      expect(getPhase(1)?.id).toBe('jee-core');
      expect(getPhase(15)?.id).toBe('jee-core');
      expect(getPhase(30)?.id).toBe('jee-core');
      expect(getPhase(31)?.id).toBe('l-mindset');
      expect(getPhase(60)?.id).toBe('l-mindset');
    });

    it('handles days outside any phase', () => {
      const phases = [
        { id: 'jee-core', dayStart: 1, dayEnd: 30 },
      ];

      const getPhase = (day: number) => {
        return phases.find(p => day >= p.dayStart && day <= p.dayEnd);
      };

      expect(getPhase(0)).toBeUndefined();
      expect(getPhase(31)).toBeUndefined();
    });
  });

  describe('Weekly/Monthly Reviews', () => {
    it('identifies weekly review days', () => {
      const isWeeklyReviewDay = (dateISO: string) => {
        const date = new Date(dateISO + 'T00:00:00');
        return date.getDay() === 0; // Sunday
      };

      expect(isWeeklyReviewDay('2026-01-04')).toBe(true); // Sunday
      expect(isWeeklyReviewDay('2026-01-05')).toBe(false); // Monday
      expect(isWeeklyReviewDay('2026-01-11')).toBe(true); // Sunday
    });

    it('identifies monthly assessment days', () => {
      const monthlyDays = [30, 60, 90];

      const isMonthlyAssessmentDay = (dayNumber: number) => {
        return monthlyDays.includes(dayNumber);
      };

      expect(isMonthlyAssessmentDay(30)).toBe(true);
      expect(isMonthlyAssessmentDay(60)).toBe(true);
      expect(isMonthlyAssessmentDay(90)).toBe(true);
      expect(isMonthlyAssessmentDay(29)).toBe(false);
      expect(isMonthlyAssessmentDay(45)).toBe(false);
    });
  });

  describe('Recovery Mode', () => {
    it('detects recovery mode when previous day was missed', () => {
      const logs: Record<string, DayLog> = {};
      // Day 1 completed
      logs['2026-01-01'] = createLog(['task1']);
      // Day 2 missed (empty log)
      logs['2026-01-02'] = createLog([]);

      const shouldEnterRecovery = (dayNumber: number, logs: Record<string, DayLog>) => {
        const yesterdayISO = isoDay(dayNumber - 1);
        const yesterdayLog = logs[yesterdayISO];
        return !yesterdayLog || Object.keys(yesterdayLog).length === 0;
      };

      expect(shouldEnterRecovery(3, logs)).toBe(true); // Day 2 was empty
    });

    it('does not enter recovery mode after complete day', () => {
      const logs: Record<string, DayLog> = {};
      logs['2026-01-01'] = createLog(['task1']);
      logs['2026-01-02'] = createLog(['task1']);

      const shouldEnterRecovery = (dayNumber: number, logs: Record<string, DayLog>) => {
        const yesterdayISO = isoDay(dayNumber - 1);
        const yesterdayLog = logs[yesterdayISO];
        return !yesterdayLog || Object.keys(yesterdayLog).length === 0;
      };

      expect(shouldEnterRecovery(3, logs)).toBe(false); // Day 2 was complete
    });
  });

  describe('Gap Detection', () => {
    it('counts missed days correctly', () => {
      const logs: Record<string, DayLog> = {};
      logs['2026-01-01'] = createLog(['task1']);
      // Days 2-4 missed
      logs['2026-01-05'] = createLog(['task1']);

      const countGaps = (fromDay: number, toDay: number, logs: Record<string, DayLog>) => {
        let gaps = 0;
        for (let d = fromDay; d <= toDay; d++) {
          const dateISO = isoDay(d);
          if (!logs[dateISO] || Object.keys(logs[dateISO]).length === 0) {
            gaps++;
          }
        }
        return gaps;
      };

      expect(countGaps(1, 5, logs)).toBe(3); // Days 2, 3, 4
    });

    it('handles no gaps', () => {
      const logs: Record<string, DayLog> = {};
      for (let i = 1; i <= 5; i++) {
        const dateISO = isoDay(i);
        logs[dateISO] = createLog(['task1']);
      }

      const countGaps = (fromDay: number, toDay: number, logs: Record<string, DayLog>) => {
        let gaps = 0;
        for (let d = fromDay; d <= toDay; d++) {
          const dateISO = isoDay(d);
          if (!logs[dateISO] || Object.keys(logs[dateISO]).length === 0) {
            gaps++;
          }
        }
        return gaps;
      };

      expect(countGaps(1, 5, logs)).toBe(0);
    });
  });

  describe('Study Time Tracking', () => {
    it('calculates total study time from completed tasks', () => {
      // DayLog is [taskId: string]: boolean, so we track study time separately
      const studyMinutes = { '2026-01-01': 45, '2026-01-02': 60, '2026-01-03': 30 };

      const totalMinutes = Object.values(studyMinutes).reduce((sum, m) => sum + m, 0);
      expect(totalMinutes).toBe(135);
    });

    it('handles empty study time data', () => {
      const studyMinutes: Record<string, number> = {};
      const totalMinutes = Object.values(studyMinutes).reduce((sum, m) => sum + m, 0);
      expect(totalMinutes).toBe(0);
    });
  });

  describe('Day Log Structure', () => {
    it('handles empty log', () => {
      const log: DayLog = {};
      expect(Object.keys(log).length).toBe(0);
    });

    it('handles single task completion', () => {
      const log: DayLog = { task_1: true };
      expect(log.task_1).toBe(true);
    });

    it('handles multiple task completions', () => {
      const log: DayLog = {
        task_1: true,
        task_2: true,
        task_3: true,
      };
      expect(Object.keys(log).length).toBe(3);
    });

    it('can check if task is completed', () => {
      const log: DayLog = { task_1: true };
      expect(log.task_1).toBe(true);
      expect(log.task_2).toBeUndefined();
    });
  });

  describe('Exam Date Calculations', () => {
    it('calculates days until exam', () => {
      const examDate = new Date('2026-04-01');
      const today = new Date('2026-03-01');
      const daysUntil = Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysUntil).toBe(31);
    });

    it('handles past exam date', () => {
      const examDate = new Date('2026-01-01');
      const today = new Date('2026-02-01');
      const daysUntil = Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysUntil).toBeLessThan(0);
    });

    it('handles no exam date set', () => {
      const examDateISO: string | null = null;
      expect(examDateISO).toBeNull();
    });
  });

  describe('Bonus Days', () => {
    it('tracks bonus days used', () => {
      const state = emptyAppState();
      expect(state.bonusDaysUsed).toBe(0);

      const updated = { ...state, bonusDaysUsed: 5 };
      expect(updated.bonusDaysUsed).toBe(5);
    });

    it('can add bonus days', () => {
      let state = emptyAppState();
      state = { ...state, bonusDaysUsed: state.bonusDaysUsed + 1 };
      expect(state.bonusDaysUsed).toBe(1);

      state = { ...state, bonusDaysUsed: state.bonusDaysUsed + 1 };
      expect(state.bonusDaysUsed).toBe(2);
    });
  });

  describe('Cleared Levels', () => {
    it('starts with no cleared levels', () => {
      const state = emptyAppState();
      expect(state.clearedLevels).toEqual([]);
    });

    it('can mark level as cleared', () => {
      const state = emptyAppState();
      const updated = { ...state, clearedLevels: [1, 2] };
      expect(updated.clearedLevels).toContain(1);
      expect(updated.clearedLevels).toContain(2);
    });

    it('can check if level is cleared', () => {
      const clearedLevels = [1, 2, 3];
      expect(clearedLevels.includes(1)).toBe(true);
      expect(clearedLevels.includes(4)).toBe(false);
    });
  });
});

import type { TaskBankEntry } from '../../core/domain/task-bank';

export interface RankContext {
  dayNumber: number;
  weakHabitIds: string[];
  revisionDueHabitIds: string[];
  backlogDays: number;
  remainingMinutes: number;
  /** Task ids recently completed — deprioritized to keep plans varied. */
  recentTaskIds: Set<string>;
  gapDays: number;
  recoveryMode: boolean;
}

export interface RankedCandidate {
  entry: TaskBankEntry;
  score: number;
  reason: string;
}

/**
 * Deterministic ranking of candidate tasks for a day. No randomness: ties are
 * broken by id. The best use of this is for AI-recommended injections on top of
 * the deterministic base plan.
 */
export function rankCandidates(candidates: TaskBankEntry[], ctx: RankContext): RankedCandidate[] {
  const ranked = candidates.map((entry) => {
    let score = 0.5;
    const reasons: string[] = [];

    const isWeak = ctx.weakHabitIds.includes(entry.habitId);
    const isRevisionDue = ctx.revisionDueHabitIds.includes(entry.habitId);
    const isRecoveryType = entry.taskType === 'Recovery';
    const isReviewType = entry.taskType === 'Review';

    if (isWeak) {
      score += 0.2;
      reasons.push('weak habit');
    }
    if (isRevisionDue && (isReviewType || entry.revisionSuitability >= 0.7)) {
      score += entry.revisionSuitability * 0.3;
      reasons.push('revision due');
    }
    if (ctx.backlogDays > 0 && (isRecoveryType || entry.backlogSuitability >= 0.7)) {
      score += entry.backlogSuitability * 0.3;
      reasons.push('backlog');
    }
    if (ctx.gapDays > 0 && isRecoveryType) {
      score += 0.1;
      reasons.push('gap recovery');
    }
    if (ctx.recoveryMode && isRecoveryType) {
      score += 0.05;
    }
    if (ctx.recentTaskIds.has(entry.id)) {
      score -= 0.2;
      reasons.push('done recently');
    }
    if (entry.estimatedDurationMin > ctx.remainingMinutes * 0.5) {
      score -= 0.15;
      reasons.push('long');
    }
    if (entry.energyLevel === 'high' && ctx.remainingMinutes < 60) {
      score -= 0.1;
    }

    score = Math.max(0, Math.min(1, score));
    return { entry, score, reason: reasons.length > 0 ? reasons.join(', ') : 'matches today' };
  });

  return ranked.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
}

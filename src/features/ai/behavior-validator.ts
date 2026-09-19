/**
 * Misa Behavior Validation Layer (Pre-Delivery Guard)
 *
 * Sits immediately before message/call delivery:
 * EVENT -> CONTEXT -> SHOULD SPEAK? -> PRIORITY -> CHANNEL -> TIMING -> GENERATE -> VALIDATE -> DELIVER
 *
 * Prevents:
 * - Violations of DND or Quiet Hours
 * - Unwanted background interruption during active grace period
 * - Spam / identical duplicate messages
 * - Referencing already-completed tasks or stale commitments
 * - Excessive message length or emoji spam
 */

import type { RelationshipState } from './relationship-state';
import type { ProactiveCandidate } from './social-decision-engine';

export interface ValidationContext {
  lastActiveTimestamp: number;
  isInsideActiveSession?: boolean;
  completedTaskIds?: string[];
  recentSentMessages?: string[];
  now?: number;
}

export interface ValidationResult {
  valid: boolean;
  reason: string;
  sanitizedText?: string;
}

export function validateProactiveDelivery(
  candidate: ProactiveCandidate,
  relationship: RelationshipState,
  context: ValidationContext
): ValidationResult {
  const now = context.now ?? Date.now();

  // 1. DND Check
  if (now < relationship.boundaries.dndUntilTimestamp) {
    return { valid: false, reason: 'Suppressed: DND shield active' };
  }

  // 2. Quiet Hours Check
  const isQuiet = checkQuietHours(
    relationship.boundaries.quietHoursStart,
    relationship.boundaries.quietHoursEnd,
    now
  );
  if (isQuiet) {
    return { valid: false, reason: 'Suppressed: Inside quiet hours' };
  }

  // 3. Active Grace Period (30 minutes)
  // Allowed ONLY if it is an in-session conversational follow-up inside the active chat.
  const configuredGraceMinutes = relationship.boundaries.activeGraceMinutes;
  const graceMinutes = Number.isFinite(configuredGraceMinutes)
    ? Math.max(0, configuredGraceMinutes)
    : 30;
  const graceMs = graceMinutes * 60 * 1000;

  // Corrupt persisted activity timestamps must fail closed. `NaN` would make
  // `timeSinceActive < graceMs` false and could silently bypass the grace shield.
  // Treating an invalid timestamp as "active now" is conservative and prevents
  // malformed local/synced state from causing an unexpected interruption.
  // Reject negative/future timestamps too: either value is outside the valid
  // wall-clock domain for a completed activity event and could otherwise bypass
  // or indefinitely distort the grace calculation after clock/state corruption.
  const lastActiveTimestamp = Number.isFinite(context.lastActiveTimestamp) &&
    context.lastActiveTimestamp >= 0 &&
    context.lastActiveTimestamp <= now
    ? context.lastActiveTimestamp
    : now;
  const timeSinceActive = now - lastActiveTimestamp;

  if (timeSinceActive < graceMs && !context.isInsideActiveSession) {
    return {
      valid: false,
      reason: `Suppressed: User active in app ${Math.round(timeSinceActive / 60000)}m ago (${graceMinutes}-min grace shield)`,
    };
  }

  // 4. Stale / Completed Task Check
  if (candidate.topic && context.completedTaskIds && context.completedTaskIds.length > 0) {
    const lowerTopic = candidate.topic.toLowerCase();
    const isCompleted = context.completedTaskIds.some((id) => id.toLowerCase().includes(lowerTopic));
    if (isCompleted) {
      return { valid: false, reason: `Suppressed: Topic "${candidate.topic}" is already completed` };
    }
  }

  // 5. Duplicate / Fatigue Check
  const text = (candidate.offlineText || '').trim();
  if (context.recentSentMessages && context.recentSentMessages.includes(text)) {
    return { valid: false, reason: 'Suppressed: Exact duplicate message was sent recently' };
  }

  // 6. Fatigue Score Guard (> 0.8 blocks non-critical communications)
  if (relationship.fatigue.fatigueScore >= 0.8 && candidate.urgency < 0.8) {
    return { valid: false, reason: 'Suppressed: Notification fatigue score too high' };
  }

  // 7. Sanitization (Limit excessive length, clean text)
  let sanitized = text;
  if (sanitized.length > 250) {
    sanitized = sanitized.slice(0, 247) + '...';
  }

  return {
    valid: true,
    reason: 'Validation passed',
    sanitizedText: sanitized,
  };
}

function checkQuietHours(startStr: string, endStr: string, nowEpoch: number): boolean {
  const start = parseClockMinutes(startStr);
  const end = parseClockMinutes(endStr);

  // Malformed persisted/configured boundaries must fail closed. Returning
  // "quiet" avoids silently bypassing a user's quiet-hours preference when
  // old or corrupted state contains an invalid clock value.
  if (start === null || end === null) return true;

  const date = new Date(nowEpoch);
  const currentMins = date.getHours() * 60 + date.getMinutes();

  if (start > end) {
    return currentMins >= start || currentMins < end;
  }
  return currentMins >= start && currentMins < end;
}

function parseClockMinutes(value: string): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value.trim());
  if (!match) return null;
  const [hours, minutes] = value.trim().split(':').map(Number);
  return hours * 60 + minutes;
}

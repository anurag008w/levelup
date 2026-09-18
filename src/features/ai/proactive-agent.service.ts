/**
 * Misa Autonomous Proactive Agent Service (Hardened Production Model)
 *
 * Canonical Rules:
 * 1. 4-Second Debounce (sealSessionTrigger): Only seals conversation intent, commitments,
 *    and schedules future background alarms. Never injects an instant user-facing message.
 * 2. 5-Minute In-Session Idle (evaluateSessionFollowUp): Evaluates active doubt follow-up
 *    strictly inside the active chat session without creating background notifications.
 * 3. 30-Minute Grace Period: Blocks all background notifications if user was active recently.
 * 4. Conservative Spontaneous Calls: Checks relationship confidence, fatigue, activity state,
 *    and decline history. Suppresses calls during DEEP_STUDY / SOLVING.
 * 5. Distinct Call States: ACCEPTED, DECLINED, MISSED, OFFLINE_CALL_ATTEMPT, TIMEOUT.
 * 6. Behavior Validation Layer (validateProactiveDelivery): Final check before any message delivery.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { ringtonePlayer, type RingtonePresetId } from '../../lib/ringtone-player';
import { relationshipManager, type SubjectArea } from './relationship-state';
import { socialDecisionEngine, type ProactiveCandidate } from './social-decision-engine';
import { validateProactiveDelivery } from './behavior-validator';
import type { UserActivityState } from '../../core/domain/activity-signal';
import { isAppActive } from '../../lib/notifications';
import { container } from '../../di/container';
import { isLiveCallActive } from './live-call-state';
import type { LiveCallOrigin } from '../../core/domain/live-types';

export interface ProactivePreferences {
  enabled: boolean;
  callsEnabled: boolean;
  callFrequency: 'rare' | 'balanced' | 'request_only'; // rare = 1 call/4d, balanced = 1 call/2d, request_only = only when user asks
  quietHoursStart: string; // e.g. "01:00"
  quietHoursEnd: string;   // e.g. "07:00"
  ringtonePreset: RingtonePresetId;
  customRingtoneUrl?: string;
  activeGraceMinutes: number; // default: 30 minutes
}

export const DEFAULT_PROACTIVE_PREFS: ProactivePreferences = {
  enabled: true,
  callsEnabled: true,
  callFrequency: 'balanced',
  quietHoursStart: '01:00',
  quietHoursEnd: '07:00',
  ringtonePreset: 'soft_chime',
  activeGraceMinutes: 30,
};

export type CallStatusType =
  | 'accepted'
  | 'declined'
  | 'missed'
  | 'offline_attempt'
  | 'timeout';

export interface ProactiveTrigger {
  id: number;
  idempotencyKey?: string;
  type: 'chat_nudge' | 'incoming_call' | 'inactivity' | 'cold_start' | 'session_followup';
  scheduledTime: number; // epoch ms
  topic?: string;
  intent?: 'reminder' | 'doubt_followup' | 'urgent_check' | 'recap' | 'general';
  relatedTaskId?: string;
  offlineMessage: string;
  callReason?: string;
  requiresOnline?: boolean;
}

/** AI tools (scheduleMessage/makeCall) se banaya gaya scheduled item. */
export interface ScheduledProactiveMessage {
  id: string;
  kind: 'message' | 'call';
  text?: string;
  reason?: string;
  scheduledTime: number; // epoch ms
  topic?: string;
  createdAt: number;
  /** Jab user is felt entity (todo title / task / memory) ki baat pura kar de
   *  toh is scheduled item ko auto-cancel karo — "ho gaya" kaam track. */
  linkedEntity?: { type: 'todo' | 'task' | 'memory' | 'keyword'; value: string };
  /** A cancellation is a sync tombstone; it must survive until peers have time to merge it. */
  cancelled?: boolean;
  cancelledAt?: number;
  /** Kitni baar validation-ne-blocked retry ho chuki (cap lagata hai). */
  deliveryRetries?: number;
}

/**
 * Persisted proactive-agent snapshot that rides the `misa` sync scope.
 * Mirrors exactly what saveState() writes so a device change restores
 * prefs + scheduled reminders/calls + follow-up memory losslessly.
 */
export interface MisaProactiveBlob {
  prefs: ProactivePreferences;
  lastActiveTimestamp: number;
  lastUserChatTimestamp: number;
  lastCallTimestamp: number;
  lastCallDeclinedTimestamp: number;
  consecutiveCallDeclines: number;
  dndUntilTimestamp: number;
  coldStartDone: boolean;
  pendingTriggers: ProactiveTrigger[];
  scheduledMessages: ScheduledProactiveMessage[];
  missedInteractions: Array<{ kind: 'call' | 'message'; at: number; detail: string; followedUpAt: number | null }>;
}

// ...rest of file unchanged...
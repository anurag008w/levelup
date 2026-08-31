/**
 * Composite Activity & Stuck Signal Analyzer
 *
 * Combines multimodal inputs (vision, voice, pen, cursor, scrolling,
 * dwell time, and verbal statements) into rich activity states,
 * activity scores, and stuck/away confidence metrics.
 */

export type UserActivityState =
  | 'DEEP_STUDY'
  | 'READING'
  | 'SOLVING'
  | 'THINKING'
  | 'WRITING'
  | 'BREAK'
  | 'ENTERTAINMENT'
  | 'AWAY'
  | 'IDLE'
  | 'UNKNOWN';

export interface RawActivityInputs {
  silenceDurationSec: number;
  isCameraOrScreenActive: boolean;
  voiceActivity?: boolean;
  penMovement?: boolean;
  cursorMovement?: boolean;
  screenChanges?: boolean;
  scrolling?: boolean;
  visibleWriting?: boolean;
  calculationProgress?: boolean;
  questionDwellTimeSec?: number;
  userStatement?: string;
  hasErasuresOrStallSigns?: boolean;
  isEmptyRoomOrChair?: boolean;
  isEntertainmentScreen?: boolean;
  topicMemoryContext?: string;
  memoryFactList?: string[];
}

export interface EvaluatedActivitySignal {
  studyActivityScore: number;  // 0.0 to 1.0
  stuckConfidence: number;     // 0.0 to 1.0
  awayConfidence: number;      // 0.0 to 1.0
  activityState: UserActivityState;
  isExtendedQuietRequested: boolean;
  quietExtensionDurationMs: number;
  reason: string;
}

const EXTENDED_QUIET_KEYWORDS = [
  'solving hu',
  'solve kar raha',
  'solve kar rahi',
  'soch raha',
  'soch rahi',
  'ek minute',
  'wait',
  'ruko',
  'hold on',
  'just a sec',
  'shant raho',
  'disturb mat',
];

export function evaluateActivitySignal(inputs: RawActivityInputs): EvaluatedActivitySignal {
  const {
    silenceDurationSec,
    isCameraOrScreenActive,
    penMovement = false,
    cursorMovement = false,
    screenChanges = false,
    scrolling = false,
    visibleWriting = false,
    calculationProgress = false,
    questionDwellTimeSec = silenceDurationSec,
    userStatement = '',
    hasErasuresOrStallSigns = false,
    isEmptyRoomOrChair = false,
    isEntertainmentScreen = false,
  } = inputs;

  // 1. Check for explicit verbal request for quiet time
  const lowerStatement = userStatement.toLowerCase();
  const isExtendedQuietRequested = EXTENDED_QUIET_KEYWORDS.some((kw) => lowerStatement.includes(kw));

  // 2. Compute studyActivityScore (0.0 to 1.0)
  let activityScore = 0;
  if (visibleWriting) activityScore += 0.45;
  if (calculationProgress) activityScore += 0.4;
  if (penMovement) activityScore += 0.3;
  if (cursorMovement) activityScore += 0.15;
  if (scrolling) activityScore += 0.15;
  if (screenChanges) activityScore += 0.1;
  const studyActivityScore = Math.min(1.0, Math.max(0.0, activityScore));

  // 3. Compute awayConfidence
  let awayConf = 0;
  if (isCameraOrScreenActive && isEmptyRoomOrChair) {
    awayConf = 0.95;
  } else if (!penMovement && !cursorMovement && !screenChanges && silenceDurationSec >= 120 && !isCameraOrScreenActive) {
    awayConf = 0.6;
  }
  const awayConfidence = Math.min(1.0, Math.max(0.0, awayConf));

  // 4. Compute stuckConfidence
  let stuckConf = 0;
  if (hasErasuresOrStallSigns) {
    stuckConf += 0.5;
  }
  if (questionDwellTimeSec > 90 && studyActivityScore < 0.2 && !isEmptyRoomOrChair && !isEntertainmentScreen) {
    stuckConf += 0.4;
  }
  if (silenceDurationSec > 100 && studyActivityScore < 0.15 && !isEmptyRoomOrChair) {
    stuckConf += 0.3;
  }
  if (studyActivityScore >= 0.5) {
    // Active solving strongly reduces stuck confidence
    stuckConf *= 0.3;
  }
  const stuckConfidence = Math.min(1.0, Math.max(0.0, stuckConf));

  // 5. Derive UserActivityState
  let activityState: UserActivityState = 'IDLE';

  if (awayConfidence >= 0.7) {
    activityState = 'AWAY';
  } else if (isEntertainmentScreen) {
    activityState = 'ENTERTAINMENT';
  } else if (isExtendedQuietRequested) {
    activityState = 'THINKING';
  } else if (visibleWriting || (penMovement && calculationProgress)) {
    activityState = 'WRITING';
  } else if (studyActivityScore >= 0.5) {
    activityState = 'SOLVING';
  } else if (scrolling && !calculationProgress) {
    activityState = 'READING';
  } else if (studyActivityScore >= 0.3) {
    activityState = 'DEEP_STUDY';
  } else if (silenceDurationSec < 45) {
    activityState = 'THINKING';
  } else {
    activityState = 'IDLE';
  }

  return {
    studyActivityScore,
    stuckConfidence,
    awayConfidence,
    activityState,
    isExtendedQuietRequested,
    quietExtensionDurationMs: isExtendedQuietRequested ? 120_000 : 0,
    reason: `State: ${activityState} (Activity: ${studyActivityScore.toFixed(2)}, Stuck: ${stuckConfidence.toFixed(2)}, Away: ${awayConfidence.toFixed(2)})`,
  };
}

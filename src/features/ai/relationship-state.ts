/**
 * Persistent Relationship State & Student Commitments Graph for Misa.
 *
 * Keeps a continuous mental model of the student's goals, active subject,
 * commitments (with full lifecycle), durable memories with confidence & decay,
 * and interaction boundaries outside ephemeral chat sessions.
 */

export type CommitmentState =
  | 'PLANNED'
  | 'STARTED'
  | 'PAUSED'
  | 'RESUMED'
  | 'COMPLETED'
  | 'POSTPONED'
  | 'ABANDONED';

export type SubjectArea = 'Physics' | 'Chemistry' | 'Mathematics' | 'General';

export type MoodContext = 'confident' | 'stressed' | 'distracted' | 'burnout' | 'focused' | 'neutral';

export interface Commitment {
  id: string;
  sourceText: string;
  topic: string;
  subject: SubjectArea;
  targetDate: string; // YYYY-MM-DD
  state: CommitmentState;
  linkedTaskId?: string;
  createdAt: number;
  updatedAt: number;
  postponedCount: number;
  notes?: string;
}

export interface DurableMemoryItem {
  id: string;
  category: 'struggle' | 'strength' | 'habit' | 'preference' | 'target';
  fact: string;
  topic?: string;
  subject?: SubjectArea;
  confidence: number; // 0.0 to 1.0
  successCount: number;
  lastReinforcedAt: number;
  isMastered: boolean;
}

export interface NotificationFatigueState {
  consecutiveDismissals: number;
  fatigueScore: number; // 0.0 (fresh) to 1.0 (exhausted)
  lastDismissalTimestamp: number;
  todayProactiveCount: number;
  proactiveDate: string; // YYYY-MM-DD
  topicCooldowns: Record<string, number>; // topic -> cooldown expires timestamp
}

export interface UserPromise {
  id: string;
  userPromise: string;
  topic?: string;
  createdAt: number;
  targetDate: string; // YYYY-MM-DD
  isResumed: boolean;
}

export interface RelationshipState {
  currentGoal: string;
  currentSubject: SubjectArea;
  currentProblemArea?: string;
  currentMoodContext: MoodContext;
  lastInteractionTimestamp: number;
  lateNightStreak: number; // consecutive days of studying past 00:30 AM
  recentSentMessages: string[]; // FIFO buffer of last 20 sent proactive messages to prevent duplicates
  wasUserIdleOrIgnoring: boolean; // Flag to greet naturally when user returns after ignoring
  boundaries: {
    dndUntilTimestamp: number;
    quietHoursStart: string;
    quietHoursEnd: string;
    activeGraceMinutes: number;
  };
  commitments: Commitment[];
  pendingPromises: UserPromise[]; // e.g. "kal batata hu" -> "kal wali baat ab bataoge? 😏"
  durableMemories: DurableMemoryItem[];
  fatigue: NotificationFatigueState;
  preferredInteractionStyle: 'gentle_encouragement' | 'disciplined_accountability' | 'concise_hints';
}

const STORAGE_KEY = 'misa_relationship_state_v2';

export const DEFAULT_RELATIONSHIP_STATE: RelationshipState = {
  currentGoal: 'JEE Main & Advanced Mastery',
  currentSubject: 'General',
  currentMoodContext: 'neutral',
  lastInteractionTimestamp: Date.now(),
  lateNightStreak: 0,
  recentSentMessages: [],
  wasUserIdleOrIgnoring: false,
  boundaries: {
    dndUntilTimestamp: 0,
    quietHoursStart: '22:30',
    quietHoursEnd: '07:30',
    activeGraceMinutes: 30,
  },
  commitments: [],
  pendingPromises: [],
  durableMemories: [],
  fatigue: {
    consecutiveDismissals: 0,
    fatigueScore: 0,
    lastDismissalTimestamp: 0,
    todayProactiveCount: 0,
    proactiveDate: new Date().toISOString().slice(0, 10),
    topicCooldowns: {},
  },
  preferredInteractionStyle: 'gentle_encouragement',
};

export class RelationshipManager {
  private state: RelationshipState;

  constructor() {
    this.state = this.load();
  }

  private load(): RelationshipState {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_RELATIONSHIP_STATE };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_RELATIONSHIP_STATE,
          ...parsed,
          boundaries: { ...DEFAULT_RELATIONSHIP_STATE.boundaries, ...parsed.boundaries },
          fatigue: { ...DEFAULT_RELATIONSHIP_STATE.fatigue, ...parsed.fatigue },
        };
      }
    } catch (e) {
      console.warn('[RelationshipManager] Load failed, initializing fresh:', e);
    }
    return { ...DEFAULT_RELATIONSHIP_STATE };
  }

  save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('[RelationshipManager] Save failed:', e);
    }
  }

  getState(): Readonly<RelationshipState> {
    return this.state;
  }

  update(fn: (s: RelationshipState) => void): void {
    fn(this.state);
    this.save();
  }

  // --- Commitments Lifecycle ---

  addCommitment(commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'postponedCount'>): Commitment {
    const newCommitment: Commitment = {
      ...commitment,
      id: `comm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      postponedCount: 0,
    };
    this.state.commitments.push(newCommitment);
    this.save();
    return newCommitment;
  }

  updateCommitmentState(id: string, nextState: CommitmentState, notes?: string): Commitment | null {
    const item = this.state.commitments.find((c) => c.id === id);
    if (!item) return null;

    item.state = nextState;
    item.updatedAt = Date.now();
    if (notes) item.notes = notes;

    if (nextState === 'POSTPONED') {
      item.postponedCount += 1;
    }

    if (nextState === 'COMPLETED' && item.topic) {
      this.reinforceTopicSuccess(item.topic, item.subject);
    }

    this.save();
    return item;
  }

  findCommitmentByTopic(topic: string): Commitment | undefined {
    const lower = topic.toLowerCase();
    return this.state.commitments.find(
      (c) => c.topic.toLowerCase().includes(lower) && c.state !== 'COMPLETED' && c.state !== 'ABANDONED'
    );
  }

  // --- Durable Memory & Confidence Decay ---

  addOrUpdateMemory(category: DurableMemoryItem['category'], fact: string, topic?: string, subject?: SubjectArea): DurableMemoryItem {
    const existing = this.state.durableMemories.find(
      (m) => m.category === category && (m.fact.toLowerCase() === fact.toLowerCase() || (topic && m.topic?.toLowerCase() === topic.toLowerCase()))
    );

    if (existing) {
      existing.confidence = Math.min(1.0, existing.confidence + 0.15);
      existing.lastReinforcedAt = Date.now();
      existing.isMastered = false;
      this.save();
      return existing;
    }

    const newMemory: DurableMemoryItem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      category,
      fact,
      topic,
      subject,
      confidence: 0.85,
      successCount: 0,
      lastReinforcedAt: Date.now(),
      isMastered: false,
    };
    this.state.durableMemories.push(newMemory);
    this.save();
    return newMemory;
  }

  reinforceTopicSuccess(topic: string, _subject?: SubjectArea): void {
    const lower = topic.toLowerCase();
    const memory = this.state.durableMemories.find(
      (m) => m.category === 'struggle' && m.topic?.toLowerCase().includes(lower)
    );

    if (!memory) return;

    memory.successCount += 1;
    memory.confidence = Math.max(0.1, memory.confidence - 0.25);
    memory.lastReinforcedAt = Date.now();

    if (memory.confidence <= 0.3 || memory.successCount >= 3) {
      memory.isMastered = true;
      memory.fact = `Mastered: ${topic} concept and problem-solving.`;
    }

    this.save();
  }

  // --- Fatigue & Budget Management ---

  recordProactiveSent(topic?: string, messageText?: string): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.fatigue.proactiveDate !== today) {
      this.state.fatigue.proactiveDate = today;
      this.state.fatigue.todayProactiveCount = 0;
    }
    this.state.fatigue.todayProactiveCount += 1;

    if (topic) {
      // 48-hour cooldown on same topic
      this.state.fatigue.topicCooldowns[topic.toLowerCase()] = Date.now() + 48 * 3600 * 1000;
    }

    if (messageText) {
      if (!this.state.recentSentMessages) this.state.recentSentMessages = [];
      this.state.recentSentMessages.push(messageText);
      if (this.state.recentSentMessages.length > 20) {
        this.state.recentSentMessages.shift();
      }
    }

    this.save();
  }

  recordLateNightStudy(): void {
    this.state.lateNightStreak = (this.state.lateNightStreak || 0) + 1;
    this.save();
  }

  resetLateNightStreak(): void {
    this.state.lateNightStreak = 0;
    this.save();
  }

  recordNotificationDismissal(topic?: string): void {
    this.state.fatigue.consecutiveDismissals += 1;
    this.state.fatigue.lastDismissalTimestamp = Date.now();
    this.state.fatigue.fatigueScore = Math.min(1.0, this.state.fatigue.fatigueScore + 0.35);
    this.state.wasUserIdleOrIgnoring = true;

    if (topic) {
      // 72-hour penalty cooldown on dismissed topic
      this.state.fatigue.topicCooldowns[topic.toLowerCase()] = Date.now() + 72 * 3600 * 1000;
    }
    this.save();
  }

  recordAppEngaged(): { wasIgnoring: boolean; pendingPromise?: UserPromise } {
    const wasIgnoring = this.state.wasUserIdleOrIgnoring;
    this.state.wasUserIdleOrIgnoring = false;
    this.state.fatigue.consecutiveDismissals = 0;
    this.state.fatigue.fatigueScore = Math.max(0, this.state.fatigue.fatigueScore - 0.4);
    this.state.lastInteractionTimestamp = Date.now();

    const pendingPromise = this.getPendingPromise();
    if (pendingPromise) {
      this.markPromiseResumed(pendingPromise.id);
    }

    this.save();
    return { wasIgnoring, pendingPromise };
  }

  // --- Conversational Promises & Resumption (Rule 8) ---

  addUserPromise(userPromise: string, topic?: string): UserPromise {
    if (!this.state.pendingPromises) this.state.pendingPromises = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const promise: UserPromise = {
      id: `prm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userPromise,
      topic,
      createdAt: Date.now(),
      targetDate: tomorrow.toISOString().slice(0, 10),
      isResumed: false,
    };

    this.state.pendingPromises.push(promise);
    this.save();
    return promise;
  }

  getPendingPromise(): UserPromise | undefined {
    if (!this.state.pendingPromises) return undefined;
    return this.state.pendingPromises.find((p) => !p.isResumed);
  }

  markPromiseResumed(id: string): void {
    if (!this.state.pendingPromises) return;
    const p = this.state.pendingPromises.find((x) => x.id === id);
    if (p) {
      p.isResumed = true;
      this.save();
    }
  }

  // --- 3-Layer Memory Synthesis (Rule 11) ---

  get3LayerContext(subject?: SubjectArea, topic?: string): { recent: string; ongoing: string; longTerm: string; synthesis: string } {
    const s = this.state;
    const subj = subject || s.currentSubject || 'General';
    const top = topic || s.commitments[0]?.topic || 'daily study target';

    const recent = `Aap abhi ${top} kar rahe the`;
    const ongoing = `Is week ${subj} ka syllabus complete karna hai`;
    const longTerm = s.currentGoal || 'JEE Main & Advanced Mastery';
    const synthesis = `${top} ka ye target ho gaya toh aapka ${subj} ka is week wala schedule bhi track pe aa jayega.`;

    return { recent, ongoing, longTerm, synthesis };
  }

  resetForTesting(): void {
    this.state = {
      ...DEFAULT_RELATIONSHIP_STATE,
      commitments: [],
      pendingPromises: [],
      durableMemories: [],
      fatigue: {
        consecutiveDismissals: 0,
        fatigueScore: 0,
        lastDismissalTimestamp: 0,
        todayProactiveCount: 0,
        proactiveDate: new Date().toISOString().slice(0, 10),
        topicCooldowns: {},
      },
      recentSentMessages: [],
      wasUserIdleOrIgnoring: false,
    };
    this.save();
  }
}

export const relationshipManager = new RelationshipManager();

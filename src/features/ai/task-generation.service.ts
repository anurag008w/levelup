import type { AppState } from '../../core/domain/state';
import type { TaskBankEntry } from '../../core/domain/task-bank';
import type { HabitRepository } from '../../core/ports/repositories';
import type { TaskBankService } from '../task-bank/task-bank.service';
import { parseTaskBankEntry } from '../task-bank/validation';
import type { LLMService } from './llm.service';
import { TaskBankValidationError } from '../../core/domain/errors';

export interface GenerateTaskInput {
  /** Free-text user intent, e.g. "3 revision problems of thermodynamics". */
  intent: string;
  habitId?: string;
  dayNumber?: number;
  durationMin?: number;
}

export interface GenerationResult {
  entry: TaskBankEntry;
  source: 'bank' | 'ai';
}

const MIN_BANK_CONFIDENCE = 0.35;
const MAX_AI_TASKS_PER_DAY = 5;

/**
 * AI Task Generation (M5). Bank-first: a confident match from the existing
 * Task Bank is preferred; the LLM is only called when nothing matches well.
 * AI output is validated with the same zod schema as the seeds.
 */
export class TaskGenerationService {
  private readonly llm: LLMService;
  private readonly taskBank: TaskBankService;
  private readonly habits: HabitRepository;

  constructor(llm: LLMService, taskBank: TaskBankService, habits: HabitRepository) {
    this.llm = llm;
    this.taskBank = taskBank;
    this.habits = habits;
  }

  /** Deterministic bank lookup based on keyword overlap with title/description/tags. */
  findBankMatch(intent: string, dayNumber = 1): TaskBankEntry | null {
    const tokens = tokenize(intent);
    if (tokens.length === 0) return null;
    const matches: Array<{ entry: TaskBankEntry; score: number }> = [];
    for (const entry of this.taskBank.search({ unlock: { dayNumber, phase: 'jee-core', unlockedHabitIds: [], examWindowActive: false, mockSunday: false, weekday: 0, recoveryMode: false, backlogDays: 0, revisionDueHabitIds: [] }, activeOnly: true })) {
      const hay = tokenize(`${entry.title} ${entry.description} ${entry.tags.join(' ')}`);
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score++;
      const normalized = tokens.length > 0 ? score / tokens.length : 0;
      if (normalized > 0) matches.push({ entry, score: normalized });
    }
    matches.sort((a, b) => b.score - a.score);
    const best = matches[0];
    return best && best.score >= MIN_BANK_CONFIDENCE ? best.entry : null;
  }

  async generate(state: AppState, input: GenerateTaskInput): Promise<GenerationResult> {
    const dayNumber = input.dayNumber ?? currentDayNumber(state, new Date());
    const bankMatch = this.findBankMatch(input.intent, dayNumber);
    if (bankMatch) return { entry: bankMatch, source: 'bank' };

    const aiCount = state.dynamicTaskBank.filter(
      (t) =>
        t.id.startsWith('ai-') &&
        t.unlockConditions.some(
          (c) => (c.type === 'day' && c.fromDay <= dayNumber) || (c.type === 'day-exact' && c.day === dayNumber),
        ),
    ).length;
    if (aiCount >= MAX_AI_TASKS_PER_DAY) {
      throw new TaskBankValidationError(`Already ${MAX_AI_TASKS_PER_DAY} AI tasks planned for day ${dayNumber}`);
    }

    const entry = await this.askAi(input, dayNumber);
    return { entry, source: 'ai' };
  }

  private async askAi(input: GenerateTaskInput, dayNumber: number): Promise<TaskBankEntry> {
    const habitOptions = this.habits
      .getAllHabits()
      .filter((h) => h.dayStart <= dayNumber)
      .slice(0, 20)
      .map((h) => `${h.id} — ${h.name}`)
      .join('\n');

    const basePrompt = [
      'You design ONE daily study task for a JEE aspirant. Return strict JSON matching this schema:',
      '{ "habitId": string, "title": string, "description": string, "phase": "jee-core"|"l-mindset"|"light-execution"|"peak-performance", "difficulty": 1|2|3|4|5, "estimatedDurationMin": number, "energyLevel": "low"|"medium"|"high", "tags": string[], "prerequisites": string[], "taskType": "Beginner"|"Intermediate"|"Advanced"|"Review"|"Recovery"|"Reflection"|"Challenge", "revisionSuitability": 0..1, "backlogSuitability": 0..1, "thinkingSkills": string[], "jeeRelevance": { "subject"?: string, "examWindow"?: boolean, "score": 0..1 } }',
      'Constraints: "difficulty" must be an INTEGER 1-5, "revisionSuitability"/"backlogSuitability"/"jeeRelevance.score" must be DECIMALS between 0 and 1 (0.8, not 80, not 0.8/10).',
      'Allowed "thinkingSkills" values (use 1-2): "planning","focus","discipline","recall","analysis","reasoning","verification","reflection","systems","creativity".',
      `Day ${dayNumber} of the journey.`,
      `User request: "${input.intent}"`,
      input.habitId ? `Prefer habit id "${input.habitId}".` : `Pick the most fitting habit from:\n${habitOptions}`,
      input.durationMin ? `Estimated duration should be near ${input.durationMin} minutes.` : 'Keep it under 90 minutes.',
      'title must be concise (under 90 chars), description 1-2 sentences. No extra text besides the JSON object.',
    ].join('\n');

    const attempt = async (correction?: string): Promise<TaskBankEntry> => {
      const prompt = correction ? `${basePrompt}\n\n${correction}` : basePrompt;
      const res = await this.llm.complete({
        messages: [
          { role: 'system', content: 'You are a task designer for a JEE study app. Always respond with a single JSON object, no markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        maxTokens: 400,
        thinking: 'off',
      });
      const raw = extractJsonObject(res.text);
      if (!raw) throw new TaskBankValidationError('AI returned no JSON');
      const coerced = coerceTaskEntry(raw, dayNumber);
      return parseTaskBankEntry({
        ...coerced,
        id: `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        unlockConditions: [{ type: 'day', fromDay: dayNumber }],
        active: true,
      });
    };

    try {
      return await attempt();
    } catch (firstErr) {
      // Weaker models answer with prose or drift out of schema — one strict retry
      // (mirroring the chat tool retry) before giving up.
      try {
        return await attempt('Your previous reply was not a single JSON object. Respond with ONLY the JSON object now, no markdown, no prose.');
      } catch {
        if (firstErr instanceof TaskBankValidationError) throw firstErr;
        throw new TaskBankValidationError('AI task generation failed');
      }
    }
  }
}

function currentDayNumber(state: AppState, now: Date): number {
  if (!state.startDateISO) return 1;
  const start = new Date(state.startDateISO + 'T00:00:00').getTime();
  const day = now.getTime();
  return Math.min(Math.max(Math.floor((day - start) / 86400000) + 1, 1), 90);
}

function phaseForDay(dayNumber: number): 'jee-core' | 'l-mindset' | 'light-execution' | 'peak-performance' {
  if (dayNumber <= 7) return 'jee-core';
  if (dayNumber <= 21) return 'l-mindset';
  if (dayNumber <= 63) return 'light-execution';
  return 'peak-performance';
}

const THINKING_SKILLS = new Set([
  'planning',
  'focus',
  'discipline',
  'recall',
  'analysis',
  'reasoning',
  'verification',
  'reflection',
  'systems',
  'creativity',
]);

const ENERGY_LEVELS = new Set(['low', 'medium', 'high']);

const TASK_TYPES = new Set(['Beginner', 'Intermediate', 'Advanced', 'Review', 'Recovery', 'Reflection', 'Challenge']);

const PHASES = new Set(['jee-core', 'l-mindset', 'light-execution', 'peak-performance']);

function clamp01(v: unknown): number {
  return Math.min(1, Math.max(0, toNumber(v) ?? 0.5));
}

/**
 * Normalizes a model-produced task object into schema-safe values. Weaker models
 * routinely return strings for numbers, 0-10 scale for 0..1 fields, or out-of-
 * enum enum values — coerce instead of failing the whole add.
 */
function coerceTaskEntry(raw: Record<string, unknown>, dayNumber: number): Record<string, unknown> {
  const difficulty = Math.round(Math.min(5, Math.max(1, toNumber(raw.difficulty) ?? 3)));
  const energy = typeof raw.energyLevel === 'string' && ENERGY_LEVELS.has(raw.energyLevel) ? raw.energyLevel : 'medium';
  const taskType = typeof raw.taskType === 'string' && TASK_TYPES.has(raw.taskType) ? raw.taskType : 'Beginner';
  const phase = typeof raw.phase === 'string' && PHASES.has(raw.phase) ? raw.phase : phaseForDay(dayNumber);
  const thinkingSkills = Array.isArray(raw.thinkingSkills)
    ? [...new Set(raw.thinkingSkills.filter((s) => typeof s === 'string' && THINKING_SKILLS.has(s)))]
    : [];
  const jeeRel = (typeof raw.jeeRelevance === 'object' && raw.jeeRelevance !== null ? raw.jeeRelevance : {}) as Record<string, unknown>;
  return {
    habitId: typeof raw.habitId === 'string' && raw.habitId.length > 0 ? raw.habitId : 'h1',
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : 'Focused study block',
    description: typeof raw.description === 'string' ? raw.description : '',
    phase,
    difficulty,
    estimatedDurationMin: Math.round(Math.min(180, Math.max(5, toNumber(raw.estimatedDurationMin) ?? 30))),
    energyLevel: energy,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.filter((p) => typeof p === 'string') : [],
    taskType,
    revisionSuitability: clamp01(raw.revisionSuitability),
    backlogSuitability: clamp01(raw.backlogSuitability),
    thinkingSkills: thinkingSkills.length > 0 ? thinkingSkills : ['recall'],
    jeeRelevance: {
      subject: typeof jeeRel.subject === 'string' ? jeeRel.subject : undefined,
      examWindow: typeof jeeRel.examWindow === 'boolean' ? jeeRel.examWindow : undefined,
      score: clamp01(jeeRel.score),
    },
  };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .filter((t) => !STOPWORDS.has(t));
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'your', 'like', 'about', 'sure']);

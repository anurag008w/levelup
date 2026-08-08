// Planner domain — uploaded coaching planners for PCM and custom subjects.
//
// A planner is a per-document JSON payload (produced from the user's own files
// via any external AI using the copyable conversion prompt) that the user pastes
// or uploads. Three kinds are supported, matching how real coaching planners look:
//
//   - "subject"  — chapters / topics / lectures / tasks per subject (a syllabus,
//                  chapter list, or lecture routine).
//   - "test"     — a schedule of tests, each with name, date, type, pattern and
//                  the per-subject syllabus it covers (e.g. AITS-1).
//   - "routine"  — a fixed weekly class time-table (day → time slots → subject).
//
// The MISA AI can READ these planners through the deterministic JSON tool
// protocol below, so it can answer "physics mein kya kya hai", "kaunsa test kab
// hai", "AITS-1 mein kya aayega" and "monday ko kya class hai" with real data.

import { z } from 'zod';
import { cleanImportText } from './import-utils';

// ===== Domain types =====

export type PlannerKind = 'subject' | 'test' | 'routine';

export type PlannerItemType = 'chapter' | 'topic' | 'task' | 'milestone' | 'note' | 'lecture';

export interface PlannerItem {
  id: string;
  title: string;
  type: PlannerItemType;
  /** Optional week number the item belongs to (1-based, like a weekly planner). */
  week?: number;
  /** Optional date the item/lecture is scheduled for (any written format, kept verbatim). */
  date?: string;
  /** Extra context: page numbers, questions to solve, lecture/faculty info, etc. */
  details?: string;
  /** Manual progress flag (the user can mark a chapter/topic done). */
  done?: boolean;
}

export interface PlannerTestRow {
  id: string;
  /** Exact test name as in the planner, e.g. "JEE Main-1". */
  name: string;
  date?: string;
  testType?: string;
  pattern?: string;
  /** subject name → syllabus items covered in this test (kept verbatim). */
  syllabus: Record<string, string[]>;
}

export interface PlannerRoutineRow {
  id: string;
  day: string;
  slots: { time: string; activity: string }[];
}

export interface SubjectPlanner {
  id: string;
  kind: PlannerKind;
  /** For "subject": the subject name. For "test": batch name (e.g. Lakshya JEE 2.0 2027). For "routine": "Routine". */
  subject: string;
  title: string;
  description?: string;
  /** Where this planner came from — file import, manual paste, or the AI. */
  source: 'file' | 'paste' | 'ai';
  /** Original file name when imported from a JSON file. */
  fileName?: string;
  /** Items for kind "subject". */
  items: PlannerItem[];
  /** Tests for kind "test". */
  tests?: PlannerTestRow[];
  /** Weekly rows for kind "routine". */
  routine?: PlannerRoutineRow[];
  createdAt: string;
  updatedAt: string;
}

// ===== Import format (what external AIs are asked to produce) =====

export const plannerItemImportSchema = z.object({
  title: z.string().min(1).max(1000),
  type: z.enum(['chapter', 'topic', 'task', 'milestone', 'note', 'lecture']).optional(),
  week: z.number().int().min(0).max(104).optional(),
  date: z.string().max(120).optional(),
  details: z.string().max(2000).optional(),
  done: z.boolean().optional(),
});

export const plannerTestRowImportSchema = z.object({
  name: z.string().min(1).max(160),
  date: z.string().max(120).optional(),
  testType: z.string().max(80).optional(),
  pattern: z.string().max(80).optional(),
  syllabus: z.record(z.array(z.string().min(1).max(300)).max(500)).optional(),
});

export const plannerRoutineRowImportSchema = z.object({
  day: z.string().min(1).max(60),
  slots: z
    .array(
      z.object({
        time: z.string().min(1).max(60),
        activity: z.string().min(1).max(1000),
      }),
    )
    .max(12)
    .optional(),
});

export const plannerImportSchema = z.object({
  // Version 1 = subject planners only (no "kind"). Version 2 adds test + routine
  // kinds. Both are accepted so previously exported payloads keep importing.
  version: z.union([z.literal(1), z.literal(2)]),
  type: z.literal('levelup-subject-planner'),
  planners: z
    .array(
      z.object({
        kind: z.enum(['subject', 'test', 'routine']).default('subject'),
        subject: z.string().min(1).max(120),
        title: z.string().min(1).max(160),
        description: z.string().max(2000).optional(),
        items: z.array(plannerItemImportSchema).max(8000).optional(),
        tests: z.array(plannerTestRowImportSchema).max(800).optional(),
        routine: z.array(plannerRoutineRowImportSchema).max(25).optional(),
      }),
    )
    .min(1)
    .max(400),
});

export type PlannerImportPayload = z.infer<typeof plannerImportSchema>;

/**
 * Parses + validates a raw import payload into ready-to-store planners.
 * Throws a friendly Error when the JSON isn't a valid LevelUp planner export,
 * so the upload screen can show exactly what went wrong.
 *
 * Tolerates real-world copy/paste noise that is NOT part of the JSON spec but
 * is extremely common when users copy from external AIs or download files:
 *  - UTF-8 BOM ("\uFEFF") — file pickers/FileReader often prepend it.
 *  - Markdown code fences ("```json ... ```") — ChatGPT/Claude/Gemini wrap
 *    their JSON answer in fences by default.
 *  - Leading/trailing whitespace and blank lines.
 */
export function parsePlannerImport(text: string): SubjectPlanner[] {
  const raw = cleanImportText(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON valid nahi hai — file/paste ko check karo.');
  }
  const result = plannerImportSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const where = firstIssue ? `${firstIssue.path.join('.') || 'root'} — ${firstIssue.message}` : 'unknown field';
    throw new Error(`Ye LevelUp planner format nahi hai (${where}). Copy prompt use karke external AI se sahi JSON banwao.`);
  }
  const now = new Date().toISOString();
  return result.data.planners.map((p) => {
    const base = {
      id: plannerUid(),
      kind: p.kind,
      subject: p.subject.trim(),
      title: p.title.trim(),
      description: p.description?.trim() || undefined,
      source: 'file' as const,
      items: (p.items ?? []).map((item) => ({
        id: plannerUid(),
        title: item.title.trim(),
        type: item.type ?? 'topic',
        week: item.week,
        date: item.date?.trim() || undefined,
        details: item.details?.trim() || undefined,
        done: item.done === true,
      })),
      createdAt: now,
      updatedAt: now,
    };
    if (p.kind === 'test') {
      return {
        ...base,
        tests: (p.tests ?? []).map((t) => ({
          id: plannerUid('pt'),
          name: t.name.trim(),
          date: t.date?.trim() || undefined,
          testType: t.testType?.trim() || undefined,
          pattern: t.pattern?.trim() || undefined,
          syllabus: t.syllabus ?? {},
        })),
      };
    }
    if (p.kind === 'routine') {
      return {
        ...base,
        routine: (p.routine ?? []).map((r) => ({
          id: plannerUid('pr'),
          day: r.day.trim(),
          slots: (r.slots ?? []).map((s) => ({ time: s.time.trim(), activity: s.activity.trim() })),
        })),
      };
    }
    return base;
  });
}

// ===== Defensive storage normalization (mirrors normalizeState) =====

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ITEM_TYPES: PlannerItemType[] = ['chapter', 'topic', 'task', 'milestone', 'note', 'lecture'];

export function normalizePlannerItem(raw: unknown): PlannerItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : plannerUid(),
    title: raw.title.trim(),
    type: typeof raw.type === 'string' && (ITEM_TYPES as string[]).includes(raw.type) ? (raw.type as PlannerItemType) : 'topic',
    ...(typeof raw.week === 'number' && Number.isFinite(raw.week) ? { week: raw.week } : {}),
    ...(typeof raw.date === 'string' && raw.date.trim() ? { date: raw.date.trim() } : {}),
    ...(typeof raw.details === 'string' && raw.details.trim() ? { details: raw.details.trim() } : {}),
    ...(raw.done === true ? { done: true } : {}),
  };
}

export function normalizePlannerTestRow(raw: unknown): PlannerTestRow | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return null;
  const syllabus: Record<string, string[]> = {};
  if (isRecord(raw.syllabus)) {
    for (const [subject, topics] of Object.entries(raw.syllabus)) {
      if (!subject.trim()) continue;
      if (!Array.isArray(topics)) continue;
      const clean = topics
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      if (clean.length > 0) syllabus[subject.trim()] = clean;
    }
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : plannerUid('pt'),
    name: raw.name.trim(),
    date: typeof raw.date === 'string' && raw.date.trim() ? raw.date.trim() : undefined,
    testType: typeof raw.testType === 'string' && raw.testType.trim() ? raw.testType.trim() : undefined,
    pattern: typeof raw.pattern === 'string' && raw.pattern.trim() ? raw.pattern.trim() : undefined,
    syllabus,
  };
}

export function normalizePlannerRoutineRow(raw: unknown): PlannerRoutineRow | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.day !== 'string' || raw.day.trim().length === 0) return null;
  const slots = Array.isArray(raw.slots)
    ? raw.slots
        .map((s) => {
          if (!isRecord(s)) return null;
          if (typeof s.time !== 'string' || typeof s.activity !== 'string') return null;
          return { time: s.time.trim(), activity: s.activity.trim() };
        })
        .filter((s): s is PlannerRoutineRow['slots'][number] => s !== null)
    : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : plannerUid('pr'),
    day: raw.day.trim(),
    slots,
  };
}

export function normalizePlanner(raw: unknown): SubjectPlanner | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.subject !== 'string' || raw.subject.trim().length === 0) return null;
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
  const kind: PlannerKind = raw.kind === 'test' || raw.kind === 'routine' ? raw.kind : 'subject';
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizePlannerItem).filter((i): i is PlannerItem => i !== null)
    : [];
  const tests = Array.isArray(raw.tests)
    ? raw.tests.map(normalizePlannerTestRow).filter((t): t is PlannerTestRow => t !== null)
    : [];
  const routine = Array.isArray(raw.routine)
    ? raw.routine.map(normalizePlannerRoutineRow).filter((r): r is PlannerRoutineRow => r !== null)
    : [];
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : plannerUid(),
    kind,
    subject: raw.subject.trim(),
    title: raw.title.trim(),
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined,
    source: raw.source === 'file' || raw.source === 'paste' || raw.source === 'ai' ? raw.source : 'file',
    fileName: typeof raw.fileName === 'string' && raw.fileName ? raw.fileName : undefined,
    items,
    ...(tests.length > 0 ? { tests } : {}),
    ...(routine.length > 0 ? { routine } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

export function normalizePlanners(raw: unknown): SubjectPlanner[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePlanner).filter((p): p is SubjectPlanner => p !== null);
}

// ===== AI tool protocol (read-only, deterministic) =====

export const plannerToolActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('listPlanners'), type: z.enum(['subject', 'test', 'routine']).optional() }),
  z.object({ action: z.literal('getSubject'), subject: z.string().min(1).max(60), from: z.string().max(60).optional(), to: z.string().max(60).optional() }),
  z.object({ action: z.literal('getPlanner'), plannerId: z.string().min(1), from: z.string().max(60).optional(), to: z.string().max(60).optional() }),
  z.object({ action: z.literal('getTest'), testName: z.string().min(1).max(160) }),
  z.object({
    action: z.literal('getTests'),
    from: z.string().max(60).optional(),
    to: z.string().max(60).optional(),
    subject: z.string().max(60).optional(),
  }),
  z.object({ action: z.literal('getRoutine'), day: z.string().max(60).optional() }),
  z.object({
    action: z.literal('getDay'),
    date: z.string().max(60).optional(),
    from: z.string().max(60).optional(),
    to: z.string().max(60).optional(),
  }),
]);

export type PlannerToolAction = z.infer<typeof plannerToolActionSchema>;

export const plannerToolBatchSchema = z.object({
  actions: z.array(plannerToolActionSchema).min(1).max(100),
});

export type PlannerToolBatch = z.infer<typeof plannerToolBatchSchema>;

export interface PlannerToolResult {
  ok: boolean;
  summary: string;
  /** True when the model guessed an id/name that doesn't exist — retry with listPlanners. */
  retryable?: boolean;
}

export const PLANNER_TOOL_INSTRUCTIONS = `You can VIEW the student's uploaded coaching planners. Three kinds exist:
- SUBJECT planners: chapters/topics/lectures/tasks per subject (Physics/Chemistry/Maths/custom), each item may carry a date.
- TEST planners: upcoming tests with exact name, date, pattern and the per-subject syllabus they cover.
- ROUTINE planners: the fixed weekly class time-table (day → time slots → subject).

Available actions (reply with exactly ONE JSON object, no prose, no markdown):

{"action":"listPlanners"}                                  # all planners with ids, grouped by kind
{"action":"listPlanners","type":"test"}                    # planners of one kind only: subject | test | routine
{"action":"getSubject","subject":"Physics"}                # a subject's planner items AND the tests covering that subject
{"action":"getSubject","subject":"Physics","from":"2026-07-01","to":"2026-07-31"}   # same, only items/tests inside the date range
{"action":"getPlanner","plannerId":"<id>"}                 # one planner's full content (id comes from listPlanners)
{"action":"getTest","testName":"JEE Main-1"}               # one test by name (exact or partial)
{"action":"getTests"}                                      # ALL tests, sorted by date
{"action":"getTests","from":"2026-07-01","to":"2026-08-15","subject":"Physics"}   # tests inside a date range, optionally for one subject
{"action":"getRoutine","day":"Monday"}                     # weekly routine (omit day for the full week)
{"action":"getDay","date":"2026-07-05"}                    # EVERYTHING on one day at once: that day's routine classes + tests + dated lectures/items
{"action":"getDay","from":"2026-07-05","to":"2026-07-11"}  # same for a whole date range (max 31 days)

Date filters: write dates as YYYY-MM-DD or any normal format ("July 5, 2026"). "from"/"to" are inclusive, both optional. Use them for "is month ke tests", "kal se 15 din mein kya hai", "July mein physics mein kya kya hai".

RULES:
- Call the MOST SPECIFIC action that answers the question directly: "tests dekho" → getTests; "physics mein kya kya hai" → getSubject; "routine batao" → getRoutine; "JEE Main-1 ka syllabus" → getTest; "uss din kya kya hai" / "aaj kya kya hai" / "5 july ko kya hoga" → getDay (it combines classes + tests + lectures for that day). Only call listPlanners when you do NOT know the exact subject name / planner id / test name.
- Use these tools when the user asks about their uploaded planners/syllabus/subjects/tests/routine (e.g. "physics mein kya kya hai", "kaunsa test kab hai", "tests dekho", "AITS-1 mein kya aayega", "test ka syllabus batao", "is month ke tests batao", "routine batao", "monday ko kya class hai", "aaj kya kya hai", "kal kya hoga").
- If the user asks about the daily study plan (Day 1-90 tasks) or task management, do NOT use these tools.
- If nothing is uploaded yet or the question is not about uploaded planners, reply with a short normal Hinglish (ROMAN script) message instead of JSON.`;

/** Correction prompt used when a planner query got a prose/task-tool reply. */
export const PLANNER_TOOL_RETRY =
  'You just answered with normal text (or a plan/task tool), but this message was about the uploaded coaching planners and MUST be a planner tool action. ' +
  'Do NOT refuse, do NOT explain limitations. Reply with EXACTLY one JSON planner action from the list above — ' +
  'getDay (a date/range: "date" for one day, "from"/"to" for a range), getTests, getSubject, getRoutine, getTest, getPlanner or listPlanners. ' +
  'Never use getPlan/getAllTasks/getTaskBank/block tools for planner questions.';

/** Message → planner decision hop router. Conservative by design so concept
 *  questions and daily-plan queries never get hijacked by this hop. "study
 *  plan" / "weekly plan" / bare "plan" deliberately stay OUT — those belong to
 *  the Day 1-90 plan tools. Test + routine phrases are routed to their kinds. */
const SUBJECT_PATTERN =
  /(physics|phys|chemistry|chem|maths|math|mathematics|biology|bio|sst|social science|history|geography|political science|economics|accountancy|business|computer science|cs|english|hindi|science|subjects?)/i;
const STRONG_PATTERN =
  /(planner|planners|syllabus|syllabi|upload kiya|upload karo|uploaded file|course plan|reading list)/i;
const SUBJECT_ANCHOR_PATTERN =
  /(chapter list|chapters|topics|topic list|routine|schedule|curriculum|course structure|file mein|file me|upload|kya kya|kya-kya)/i;
const SUBJECT_VERB_PATTERN = /(list|dekh|dikha|dikhao|show|kya|kaun|kaunse|sab|saare|all|add|added|save|covered|kitne|kitna)/i;
const TEST_PATTERN =
  /(test planner|test plan|test schedule|test list|test name|test pattern|test type|kaunse test|kaunsa test|tests? kab|kab test|test ka syllabus|test ki syllabus|test mein kya|test me kya)/i;
// "tests dekho", "test dikhao", "agla test kab hai", "upcoming tests",
// "test kya kya hai" — an inquiry ABOUT the test schedule (not a concept like
// "test kya hota hai" / "mock test ki tyari kaise kare").
const TEST_INQUIRY_PATTERN =
  /\btest(s)?\b.*\b(dekho|dikha|dikhao|dekhna|dikhana|batao|batana|list|kaunse|kaunsa|kitne|kya kya|kya-kya|agla|agle|next|schedule|dekhne)\b|\b(upcoming|aane wale)\b.*\btest(s)?\b/i;
const EXAM_PATTERN = /(jee main|jeemain|jee advanced|kya aayega|kya aaega|kitne marks)/i;
const ROUTINE_STRONG_PATTERN =
  /(routine|time table|timetable|time-table|class schedule|batch schedule|class timetable|batch timetable)/i;
const WEEKDAY_PATTERN = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i;
const ROUTINE_ANCHOR_PATTERN = /(routine|schedule|timetable|time table|class|subject|padhai|batao|dikha|kya hai|kya hoga)/i;
const RELATIVE_TIME_PATTERN =
  /(\baaj\b|\bkal\b|\bparso\b|\bparson\b|is week|this week|next week|agla hafta|agle hafte|is hafte|is hafta|last week|pichhle hafte|is mahine|agle mahine|\btarikh\b|is month|this month|next month)/i;
const MONTH_NAME_PATTERN =
  /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)/i;
const SCHEDULE_NOUN_PATTERN = /\b(test(s)?|exam(s)?|class(es)?|lecture(s)?|lect|aits|mock)\b/i;

export function isPlannerQuery(text: string): boolean {
  const t = text.toLowerCase();
  if (STRONG_PATTERN.test(t)) return true;
  if (TEST_PATTERN.test(t)) return true;
  if (TEST_INQUIRY_PATTERN.test(t)) return true;
  if (ROUTINE_STRONG_PATTERN.test(t)) return true;
  // "jee main kab hai" / "AITS-1 mein kya aayega" — an exam/test phrase present.
  if (EXAM_PATTERN.test(t) && (/\btest(s)?\b/.test(t) || /(jee main|jeemain|jee advanced|\baits\b|\bmock\b)/.test(t))) return true;
  // "kal koi test ya class hai kya", "aaj lecture hai kya", "july mein tests",
  // "test kab hai", "aits kab hai" — schedule questions with a time reference.
  if (SCHEDULE_NOUN_PATTERN.test(t) && (RELATIVE_TIME_PATTERN.test(t) || MONTH_NAME_PATTERN.test(t) || /\bkab\b/.test(t))) return true;
  // "uss din / <date> kya kya hai" — getDay: classes + tests + dated lectures
  // on a day/range at once. Test-only/class-only questions are excluded so they
  // stay on their specific tools.
  if (
    DAY_SUMMARY_STRONG.test(t) &&
    (RELATIVE_TIME_PATTERN.test(t) ||
      DATE_LITERAL_PATTERN.test(t) ||
      MONTH_NAME_PATTERN.test(t) ||
      /\b(uss din|us din|un din)\b/.test(t) ||
      /\b\d{1,2}\s+(se|to|lekar|leke|tak)\s+\d{1,2}\s+(tak|lekar|leke)\b/.test(t))
  )
    return true;
  if (DATE_LITERAL_PATTERN.test(t) && DAY_SUMMARY_SOFT.test(t) && !SCHEDULE_NOUN_EXCLUDE.test(t)) return true;
  // "date wise kya kya hai" / "tarikh ke hisaab se" — date-ordered overviews.
  if (/\b(date wise|date ke hisaab|tarikh ke hisaab|tarikh wise|date order|date-wise)\b/.test(t) && DAY_SUMMARY_SOFT.test(t)) return true;
  if (WEEKDAY_PATTERN.test(t) && ROUTINE_ANCHOR_PATTERN.test(t)) return true;
  // "kya kya subjects hai" / "sab subjects dikha" — subject list questions.
  if (/\bsubjects?\b/.test(t) && SUBJECT_VERB_PATTERN.test(t)) return true;
  if (SUBJECT_PATTERN.test(t) && SUBJECT_ANCHOR_PATTERN.test(t)) return true;
  return false;
}

// ===== Deterministic planner action routing =====
//
// The LLM decision hop sometimes drifts to the Day 1-90 task tools for planner
// questions ("friday ka schedule batao" → getPlan instead of getRoutine).
// These rules resolve the UNAMBIGUOUS cases straight to a planner action, so
// the right tool is used even when the model is weak. Ambiguous messages
// return null and go through the normal LLM decision hop.

const WEEKDAYS: Record<string, string> = {
  sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday',
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

const ROUTINE_SCHEDULE_ANCHOR = /\b(schedule|timetable|time table|class(es)?|subject(s)?|routine|lecture|time slot|slots)\b/i;
const ROUTINE_LIST_PHRASE = /(routine|time table|timetable|time-table|class schedule|batch schedule)/i;
const PLAN_DAY_WORD = /\b(day|din|plan|task|todo)\b|\bday\s*\d+\b/i;
const TEST_NOUN = /\btest(s)?\b|\bexam(s)?\b|\baits\b|\bmock\b/i;
const SUBJECT_CANON: Record<string, string> = {
  physics: 'Physics', chemistry: 'Chemistry', maths: 'Maths', math: 'Maths', mathematics: 'Maths',
  biology: 'Biology', bio: 'Biology', english: 'English', hindi: 'Hindi', science: 'Science',
  computer: 'Computer Science',
};
const SUBJECT_CONTENT_ANCHOR = /\b(kya kya|kya-kya|chapters?|topics?|syllabus|mein kya|me kya|padhna|covered|upload)\b/i;

function isoAddDaysUTC(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeekUTC(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const delta = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

/** Resolves a relative date phrase to an inclusive ["from","to"] range. */
function resolveTestRange(t: string, todayISO: string): { from: string; to: string } | null {
  if (/\baaj\b/.test(t)) return { from: todayISO, to: todayISO };
  if (/\bkal\b/.test(t)) return { from: isoAddDaysUTC(todayISO, 1), to: isoAddDaysUTC(todayISO, 1) };
  if (/\b(parso|parson)\b/.test(t)) return { from: isoAddDaysUTC(todayISO, 2), to: isoAddDaysUTC(todayISO, 2) };
  if (/is week|this week/.test(t)) {
    const start = startOfWeekUTC(todayISO);
    return { from: start, to: isoAddDaysUTC(start, 6) };
  }
  if (/is mahine|is month|this month/.test(t)) {
    const year = Number(todayISO.slice(0, 4));
    const month = Number(todayISO.slice(5, 7));
    const from = `${todayISO.slice(0, 7)}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return { from, to: isoAddDaysUTC(next, -1) };
  }
  const monthMatch = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
  if (monthMatch) {
    const month = MONTHS[monthMatch[1].toLowerCase()];
    const year = Number(todayISO.slice(0, 4));
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return { from, to: isoAddDaysUTC(next, -1) };
  }
  return null;
}

/**
 * Deterministically maps an unambiguous planner question to exactly one planner
 * tool action, or null when the LLM decision hop should handle it.
 *
 *   - weekday + schedule/class/routine → getRoutine for that day
 *   - "routine batao" / "time table"  → getRoutine (full week)
 *   - test schedule questions          → getTests (with a resolved from/to range)
 *   - subject + content anchor         → getSubject for the canonical subject
 */
export function plannerActionForQuery(text: string, todayISO: string): PlannerToolAction | null {
  const t = text.toLowerCase();
  if (!todayISO) return null;

  // 1. Weekday + schedule/class/timetable/routine → that weekday's routine.
  for (const [key, day] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${key}\\b`).test(t) && ROUTINE_SCHEDULE_ANCHOR.test(t) && !PLAN_DAY_WORD.test(t)) {
      return { action: 'getRoutine', day };
    }
  }

  // 1b. Day/date + "what's happening" phrasing → getDay: the day's classes +
  //     tests + dated lectures in ONE result ("aaj kya kya hai", "5 july ko kya
  //     hoga", "july mein kya kya hai", "1 se 10 tarikh kya kya hai"). Test-only
  //     and class-only questions are excluded so they keep landing on
  //     getTests/getRoutine.
  if (DAY_SUMMARY_STRONG.test(t)) {
    const range = resolveDayRange(t, todayISO);
    if (range && !SCHEDULE_NOUN_EXCLUDE.test(t) && (!PLAN_DAY_WORD.test(t) || DAY_COUNT_RANGE.test(t))) {
      return { action: 'getDay', from: range.from, to: range.to };
    }
    const single = resolveDayDate(t, todayISO);
    if (single && !SCHEDULE_NOUN_EXCLUDE.test(t) && !PLAN_DAY_WORD.test(t)) {
      return { action: 'getDay', date: single };
    }
    if ((RELATIVE_TIME_PATTERN.test(t) || MONTH_NAME_PATTERN.test(t)) && !SCHEDULE_NOUN_EXCLUDE.test(t) && !PLAN_DAY_WORD.test(t)) {
      const range = resolveTestRange(t, todayISO);
      if (range) return { action: 'getDay', from: range.from, to: range.to };
    }
  }
  // Explicit written date + a summary ask ("5 july ko kya hai") → getDay.
  if (DATE_LITERAL_PATTERN.test(t) && DAY_SUMMARY_SOFT.test(t) && !SCHEDULE_NOUN_EXCLUDE.test(t) && !PLAN_DAY_WORD.test(t)) {
    const single = resolveDayDate(t, todayISO);
    if (single) return { action: 'getDay', date: single };
  }

  // 2. Plain routine/timetable request (no weekday, no plan/task intent) →
  //    the full weekly routine.
  if (ROUTINE_LIST_PHRASE.test(t) && !PLAN_DAY_WORD.test(t) && !WEEKDAY_PATTERN.test(t)) {
    return { action: 'getRoutine' };
  }

  // 3. Test schedule questions ("tests dekho", "kal koi test hai kya",
  //    "july ke tests") → getTests, with an inclusive date range when the
  //    user named a time window.
  if (TEST_NOUN.test(t) && (RELATIVE_TIME_PATTERN.test(t) || MONTH_NAME_PATTERN.test(t) || /\bkab\b/.test(t) || TEST_INQUIRY_PATTERN.test(t))) {
    const range = resolveTestRange(t, todayISO);
    return range ? { action: 'getTests', from: range.from, to: range.to } : { action: 'getTests' };
  }

  // 4. Subject content question ("physics mein kya kya hai", "chemistry ka
  //    syllabus") → getSubject for the canonical subject name.
  if (SUBJECT_CONTENT_ANCHOR.test(t) && !PLAN_DAY_WORD.test(t)) {
    for (const [key, subject] of Object.entries(SUBJECT_CANON)) {
      if (new RegExp(`\\b${key}\\b`).test(t)) return { action: 'getSubject', subject };
    }
  }

  return null;
}

// ===== Date helpers (deterministic date-range filtering for tools) =====

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAY_PREFIX = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday),?\s+/i;

// ===== getDay routing — "uss din / <date> kya kya hai" =====
//
// getDay answers "is date ko kya kya hai" in ONE call: the day's routine
// classes + tests on that date + dated subject items/lectures, all grouped by
// date. These phrases must never hijack test-only ("kal koi test hai kya"),
// class-only ("monday ko kya class hai") or daily-plan ("aaj ka plan") queries.

/** Strong "what's happening" phrasing — unambiguously a day/date summary ask. */
const DAY_SUMMARY_STRONG = /\b(kya kya|kya-kya|kya hoga|kya hua|kya chal raha|kya kuch|kya chalega)\b/i;
/** Softer summary ask used only when an explicit written date is present. */
const DAY_SUMMARY_SOFT = /\b(kya|batao|batana|dikhao|dikha|dekhna|program|programme|kya hai|kya hoga)\b/i;
/** A written calendar date ("5 July", "July 5, 2026", "2026-07-05", "05/07/2026"). */
const DATE_LITERAL_PATTERN =
  /\b(\d{1,2}[\s/-](january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2})\b/i;
/** Test/class-specific questions stay on getTests/getRoutine — never getDay. */
const SCHEDULE_NOUN_EXCLUDE = /\b(test(s)?|exam(s)?|lecture(s)?|mock)\b/i;
/** "aaj se 5 din" / "kal se 3 din" — "din" here is a day COUNT, not a plan day. */
const DAY_COUNT_RANGE = /\b(aaj|kal|parso)\s+(se|to|lekar|leke|tak)\s+\d{1,2}\s+din\b/i;
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Resolves a single day from aaj/kal/parso or a written date in the message. */
function resolveDayDate(t: string, todayISO: string): string | null {
  if (/\baaj\b/.test(t)) return todayISO;
  if (/\bkal\b/.test(t)) return isoAddDaysUTC(todayISO, 1);
  if (/\b(parso|parson)\b/.test(t)) return isoAddDaysUTC(todayISO, 2);

  // "5 July" / "5 July 2026"
  const dm = t.match(
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b[,\s]*(\d{4})?\b/i,
  );
  if (dm) {
    const month = MONTHS[dm[2].toLowerCase()];
    if (!month) return null;
    const year = dm[3] ? Number(dm[3]) : Number(todayISO.slice(0, 4));
    return `${year}-${pad2(month)}-${pad2(Number(dm[1]))}`;
  }
  // "July 5, 2026"
  const md = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})[,\s]+(\d{4})\b/i,
  );
  if (md) {
    const month = MONTHS[md[1].toLowerCase()];
    if (!month) return null;
    return `${md[3]}-${pad2(month)}-${pad2(Number(md[2]))}`;
  }
  return normalizeDate(t);
}

/** Month name alternatives for range regexes. */
const MONTH_ALT =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';

/**
 * Resolves a date RANGE from the message — "aaj se 5 din", "kal se 3 din",
 * "1 se 10 tarikh", "1 se 10 july", "1 july se 10 july" — to an inclusive
 * ["from","to"]. Single-day/written-date phrases return null here (they use
 * resolveDayDate). Returns null when no range can be resolved.
 */
function resolveDayRange(t: string, todayISO: string): { from: string; to: string } | null {
  // "aaj se N din" / "kal se N din" — forward windows from today/tomorrow.
  if (/\baaj\b\s+(se|to|lekar|leke|tak)\b/.test(t) || /\bkal\b\s+(se|to|lekar|leke|tak)\b/.test(t)) {
    const nMatch = t.match(/(\d{1,2})\s+din/);
    const days = nMatch ? Math.min(Math.max(Number(nMatch[1]), 1), MAX_DAY_RANGE) : 1;
    const start = /\bkal\b\s+(se|to|lekar|leke|tak)\b/.test(t) ? isoAddDaysUTC(todayISO, 1) : todayISO;
    return { from: start, to: isoAddDaysUTC(start, days - 1) };
  }

  // "1 july se 10 july" / "1 july 2026 se 10 july 2026" — two written dates.
  const dm = t.match(
    new RegExp(`\\b(\\d{1,2})\\s+${MONTH_ALT}[a-z]*\\b[,\\s]*(\\d{4})?\\s+(se|to|lekar|leke|tak)\\s+(\\d{1,2})\\s+${MONTH_ALT}[a-z]*\\b[,\\s]*(\\d{4})?`, 'i'),
  );
  if (dm) {
    const m1 = MONTHS[dm[2].toLowerCase()];
    const m2 = MONTHS[dm[6].toLowerCase()];
    if (m1 && m2) {
      const year = dm[3] ? Number(dm[3]) : Number(todayISO.slice(0, 4));
      const a = `${year}-${pad2(m1)}-${pad2(Number(dm[1]))}`;
      const b = `${year}-${pad2(m2)}-${pad2(Number(dm[5]))}`;
      return a <= b ? { from: a, to: b } : { from: b, to: a };
    }
  }

  // "1 se 10 tarikh" / "1 se 10 july" / "1 se 10 ko" — day-of-month window
  // (anchored by tarikh/date/ko or an explicit month so "5 se 10 baje" never hits).
  const dom = t.match(
    new RegExp(`\\b(\\d{1,2})\\s+(se|to|lekar|leke|tak)\\s+(\\d{1,2})(?:\\s+(tarikh|date|ko)\\b|\\s+(?:${MONTH_ALT})[a-z]*\\b)?`, 'i'),
  );
  if (dom) {
    const a = Number(dom[1]);
    const b = Number(dom[3]);
    if (a >= 1 && a <= 31 && b >= 1 && b <= 31 && (dom[4] || dom[5])) {
      let month: number;
      if (dom[5]) {
        month = MONTHS[dom[5].toLowerCase()];
        if (!month) return null;
      } else {
        month = Number(todayISO.slice(5, 7));
      }
      const year = Number(todayISO.slice(0, 4));
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      return { from: `${year}-${pad2(month)}-${pad2(low)}`, to: `${year}-${pad2(month)}-${pad2(high)}` };
    }
  }

  // "5 se 14 tak kya kya hai" — bare day-of-month window (current month).
  // "tak/lekar/leke" + a day-summary anchor keeps clock time ("5 se 10 baje")
  // and time-slot plans ("5 se 10 tak padhunga") out.
  const bare = t.match(/\b(\d{1,2})\s+(se|to|lekar|leke|tak)\s+(\d{1,2})\s+(tak|lekar|leke)\b/i);
  if (bare) {
    const a = Number(bare[1]);
    const b = Number(bare[3]);
    if (a >= 1 && a <= 31 && b >= 1 && b <= 31 && !/\bbaje\b|\bghante\b|\b(am|pm)\b/i.test(t)) {
      const month = Number(todayISO.slice(5, 7));
      const year = Number(todayISO.slice(0, 4));
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      return { from: `${year}-${pad2(month)}-${pad2(low)}`, to: `${year}-${pad2(month)}-${pad2(high)}` };
    }
  }

  // Two explicit ISO / D-M-YYYY dates "2026-07-01 se 2026-07-10".
  const iso = t.match(/\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4})\s+(se|to|lekar|leke|tak)\s+(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4})\b/i);
  if (iso) {
    const from = normalizeDate(iso[1]);
    const to = normalizeDate(iso[3]);
    if (from && to) return from <= to ? { from, to } : { from: to, to: from };
  }

  return null;
}

/**
 * Parses a written date into a sortable "YYYY-MM-DD" key, or null when it can't
 * be understood. Handles ISO, "Weekday, Month D, YYYY", "D Month YYYY/YY" and
 * "D/M/YYYY" / "D-M-YYYY" — the formats coaching files usually carry.
 */
export function normalizeDate(text: string | undefined): string | null {
  if (!text) return null;
  let t = text.trim();
  if (!t) return null;
  const pad = (n: number): string => String(n).padStart(2, '0');

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;

  t = t.replace(WEEKDAY_PREFIX, '');

  m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return `${m[3]}-${pad(month)}-${pad(Number(m[2]))}`;
  }
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{2,4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(month)}-${pad(Number(m[1]))}`;
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`; // treat as D/M/YYYY

  return null;
}

/** True when a written date falls inside [from, to] (null bounds = open). */
export function inDateRange(date: string | undefined, from: string | null, to: string | null): boolean {
  const d = normalizeDate(date);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// ===== Text formatting for tool results =====

/** Caps keep tool summaries inside the decision hop's 1024-token budget. */
const MAX_ITEMS_TEXT = 250;
const MAX_TESTS_TEXT = 100;
const MAX_ROUTINE_DAYS_TEXT = 15;
const MAX_NAMES_TEXT = 20;

export function kindLabel(kind: PlannerKind): string {
  return kind === 'test' ? 'Test' : kind === 'routine' ? 'Routine' : 'Subject';
}

/** Human count label for UI/confirmation messages. */
export function plannerCountLabel(planner: SubjectPlanner): string {
  if (planner.kind === 'test') {
    const n = (planner.tests ?? []).length;
    return `${n} test${n === 1 ? '' : 's'}`;
  }
  if (planner.kind === 'routine') {
    const n = (planner.routine ?? []).length;
    return `${n} day${n === 1 ? '' : 's'}`;
  }
  return `${planner.items.length} item${planner.items.length === 1 ? '' : 's'}`;
}

export function plannerListToText(planners: SubjectPlanner[]): string {
  if (planners.length === 0) return 'Koi planner upload nahi hua hai abhi tak (subject, test ya routine).';
  const lines: string[] = [`Uploaded planners (${planners.length} total):`];
  const subjects = planners.filter((p) => p.kind === 'subject');
  const tests = planners.filter((p) => p.kind === 'test');
  const routines = planners.filter((p) => p.kind === 'routine');
  if (subjects.length > 0) {
    const bySubject = groupBySubject(subjects);
    lines.push(`\n📚 SUBJECT planners (${bySubject.size} subject${bySubject.size === 1 ? '' : 's'}):`);
    for (const [subject, list] of bySubject) {
      const totalItems = list.reduce((sum, p) => sum + p.items.length, 0);
      lines.push(
        `  - ${subject} (${list.length} planner${list.length === 1 ? '' : 's'}, ${totalItems} items): ${list.map((p) => `"${p.title}" (id:${p.id})`).join(', ')}`,
      );
    }
  }
  if (tests.length > 0) {
    lines.push(`\n🧪 TEST planners (${tests.length}):`);
    for (const p of tests) {
      const names = (p.tests ?? []).map((t) => t.name);
      const shown = names.slice(0, MAX_NAMES_TEXT).join(', ') + (names.length > MAX_NAMES_TEXT ? ` … aur ${names.length - MAX_NAMES_TEXT} aur` : '');
      lines.push(`  - ${p.title} (batch: ${p.subject}, id:${p.id}) — ${names.length} tests: ${shown}`);
    }
  }
  if (routines.length > 0) {
    lines.push(`\n🗓️ ROUTINE planners (${routines.length}):`);
    for (const p of routines) {
      const days = (p.routine ?? []).map((r) => r.day);
      const shown = days.slice(0, MAX_NAMES_TEXT).join(', ') + (days.length > MAX_NAMES_TEXT ? ` … aur ${days.length - MAX_NAMES_TEXT} aur` : '');
      lines.push(`  - ${p.title} (id:${p.id}) — ${days.length} days: ${shown}`);
    }
  }
  lines.push('\nUse getSubject / getPlanner / getTest / getRoutine with the exact ids/names above for details.');
  return lines.join('\n');
}

export function testRowToText(test: PlannerTestRow, indent = 0): string {
  const pad = '  '.repeat(indent);
  const meta = [test.date, test.pattern, test.testType].filter(Boolean).join(' · ');
  const lines = [`${pad}• ${test.name}${meta ? ` — ${meta}` : ''}`];
  for (const [subject, topics] of Object.entries(test.syllabus ?? {})) {
    if (!topics || topics.length === 0) continue;
    lines.push(`${pad}    ${subject}: ${topics.join(', ')}`);
  }
  return lines.join('\n');
}

export function plannerToText(planner: SubjectPlanner): string {
  const head = `Planner: "${planner.title}" (kind: ${kindLabel(planner.kind)}, subject: ${planner.subject}, id:${planner.id})`;
  const desc = planner.description ? `Description: ${planner.description}` : '';
  if (planner.kind === 'test') {
    const tests = planner.tests ?? [];
    const shown = tests.slice(0, MAX_TESTS_TEXT).map((t) => testRowToText(t, 1));
    if (tests.length > MAX_TESTS_TEXT) shown.push(`  … aur ${tests.length - MAX_TESTS_TEXT} tests (total ${tests.length})`);
    return [head, desc, `Tests (${tests.length}):`, ...shown].filter(Boolean).join('\n');
  }
  if (planner.kind === 'routine') {
    const routine = (planner.routine ?? []).map((r) => ({ batch: planner.subject, day: r.day, slots: r.slots }));
    return [head, desc, `Weekly routine (${routine.length} days):`, routineToText(routine)].filter(Boolean).join('\n');
  }
  const lines = [head, desc, `Items (${planner.items.length}):`].filter(Boolean);
  const sorted = sortPlannerItems(planner.items);
  for (const item of sorted.slice(0, MAX_ITEMS_TEXT)) {
    const typeTag = item.type === 'topic' ? '' : ` [${item.type}]`;
    const weekTag = item.week !== undefined ? ` Week ${item.week}:` : '';
    const dateTag = item.date ? ` 📅 ${item.date}` : '';
    const doneTag = item.done ? ' ✅ done' : '';
    lines.push(`  -${weekTag}${dateTag} ${item.title}${typeTag}${doneTag}${item.details ? ` — ${item.details}` : ''}`);
  }
  if (planner.items.length > MAX_ITEMS_TEXT) {
    lines.push(`  … aur ${planner.items.length - MAX_ITEMS_TEXT} items (total ${planner.items.length})`);
  }
  return lines.join('\n');
}

export function groupBySubject(planners: SubjectPlanner[]): Map<string, SubjectPlanner[]> {
  const map = new Map<string, SubjectPlanner[]>();
  for (const p of planners) {
    const list = map.get(p.subject) ?? [];
    list.push(p);
    map.set(p.subject, list);
  }
  return map;
}

/**
 * Extracts the first parseable date found inside free-form text. Lecture rows
 * often carry their date only inside `details` ("Lec 2 · Physical Chemistry ·
 * 17 Jun 2026 · Rahul Dudi Sir") — this lets sorting (and date-range answers)
 * see those dates too. Splitting on separators keeps the scan cheap and avoids
 * matching random numbers inside names like "Rahul Dudi Sir".
 */
export function normalizeDateInText(text: string | undefined): string | null {
  if (!text) return null;
  for (const part of text.split(/[·|,/;\n]+/)) {
    const iso = normalizeDate(part);
    if (iso) return iso;
  }
  return null;
}

/**
 * Display order for subject items: dated items first (chronological), then
 * undated items by week + title. Keeps a lecture schedule readable as a
 * calendar instead of grouped by week/title. A date inside `details` counts
 * when the item has no explicit `date` field (common for imported lectures).
 */
export function sortPlannerItems(items: PlannerItem[]): PlannerItem[] {
  return [...items].sort((a, b) => {
    const da = normalizeDate(a.date) ?? normalizeDateInText(a.details);
    const db = normalizeDate(b.date) ?? normalizeDateInText(b.details);
    if (da && db) return da.localeCompare(db) || a.title.localeCompare(b.title);
    if (da) return -1;
    if (db) return 1;
    return (a.week ?? 0) - (b.week ?? 0) || a.title.localeCompare(b.title);
  });
}

export function subjectToText(planners: SubjectPlanner[]): string {
  if (planners.length === 0) return 'Is subject ka koi planner nahi hai.';
  return planners.map((p) => plannerToText(p)).join('\n\n');
}

/** For getSubject: which uploaded tests cover a given subject (optionally within a date range). */
export function testsCoveringSubjectText(planners: SubjectPlanner[], subject: string, from?: string | null, to?: string | null): string {
  const wanted = subject.trim().toLowerCase();
  const lines: string[] = [];
  let count = 0;
  for (const p of planners) {
    for (const t of p.tests ?? []) {
      if (count >= MAX_TESTS_TEXT) break;
      if ((from || to) && !inDateRange(t.date, from ?? null, to ?? null)) continue;
      const entry = Object.entries(t.syllabus ?? {}).find(([s]) => s.toLowerCase() === wanted);
      if (!entry) continue;
      const [subj, topics] = entry;
      count += 1;
      lines.push(`• ${t.name}${t.date ? ` — ${t.date}` : ''}${t.pattern ? ` · ${t.pattern}` : ''}`);
      if (topics && topics.length > 0) lines.push(`    ${subj}: ${topics.join(', ')}`);
    }
  }
  return lines.length > 0 ? [`Is subject ke tests:`, ...lines].join('\n') : '';
}

export function testRowsToText(tests: PlannerTestRow[]): string {
  if (tests.length === 0) return 'Koi test nahi mila.';
  const shown = tests.slice(0, MAX_TESTS_TEXT).map((t) => testRowToText(t));
  if (tests.length > MAX_TESTS_TEXT) shown.push(`… aur ${tests.length - MAX_TESTS_TEXT} tests (total ${tests.length})`);
  return shown.join('\n\n');
}

export function routineToText(rows: { batch?: string; day: string; slots: { time: string; activity: string }[] }[]): string {
  if (rows.length === 0) return 'Koi routine row nahi hai.';
  const shown = rows.slice(0, MAX_ROUTINE_DAYS_TEXT);
  const lines = shown.map((r) => {
    const slots = (r.slots ?? []).map((s) => `    ${s.time}: ${s.activity}`).join('\n') || '    (no slots)';
    return `${r.day}${r.batch ? ` (${r.batch})` : ''}:\n${slots}`;
  });
  if (rows.length > MAX_ROUTINE_DAYS_TEXT) lines.push(`… aur ${rows.length - MAX_ROUTINE_DAYS_TEXT} days (total ${rows.length})`);
  return lines.join('\n\n');
}

// ===== getDay — "uss din kya kya hai" (classes + tests + lectures at once) =====

const MAX_DAY_RANGE = 31;

/** Weekday name ("Monday") for an ISO date. */
export function weekdayForISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function formatISODate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Everything scheduled on each date in [from, to], in one result:
 * routine classes for the weekday + tests on that date + dated subject items.
 * Dates with nothing scheduled are skipped (single-day queries still say so).
 */
export function dayScheduleToText(planners: SubjectPlanner[], from: string, to: string): string {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to && dates.length < MAX_DAY_RANGE) {
    dates.push(cursor);
    cursor = isoAddDaysUTC(cursor, 1);
  }

  const classesByWeekday = new Map<string, { batch: string; time: string; activity: string }[]>();
  for (const p of planners) {
    if (p.kind !== 'routine') continue;
    for (const row of p.routine ?? []) {
      const key = row.day.trim().toLowerCase();
      const list = classesByWeekday.get(key) ?? [];
      for (const slot of row.slots ?? []) list.push({ batch: p.subject, time: slot.time, activity: slot.activity });
      classesByWeekday.set(key, list);
    }
  }

  const testsByISO = new Map<string, PlannerTestRow[]>();
  for (const p of planners) {
    for (const test of p.tests ?? []) {
      const iso = normalizeDate(test.date);
      if (!iso) continue;
      const list = testsByISO.get(iso) ?? [];
      list.push(test);
      testsByISO.set(iso, list);
    }
  }

  const itemsByISO = new Map<string, { subject: string; title: string; type: PlannerItemType; details?: string }[]>();
  for (const p of planners) {
    if (p.kind !== 'subject') continue;
    for (const item of p.items) {
      const iso = normalizeDate(item.date);
      if (!iso) continue;
      const list = itemsByISO.get(iso) ?? [];
      list.push({ subject: p.subject, title: item.title, type: item.type, details: item.details });
      itemsByISO.set(iso, list);
    }
  }

  const lines: string[] = [];
  let any = false;
  for (const d of dates) {
    const parts: string[] = [];
    const classes = classesByWeekday.get(weekdayForISO(d).toLowerCase()) ?? [];
    if (classes.length > 0) {
      parts.push(`  🏫 Classes: ${classes.map((c) => `${c.time} ${c.activity}${c.batch ? ` (${c.batch})` : ''}`).join('; ')}`);
    }
    for (const test of (testsByISO.get(d) ?? []).slice(0, 3)) {
      const meta = [test.pattern, test.testType].filter(Boolean).join(' · ');
      const syllabi = Object.entries(test.syllabus ?? {})
        .filter(([, topics]) => topics.length > 0)
        .map(([subject, topics]) => `${subject}: ${topics.join(', ')}`)
        .join(' | ');
      parts.push(`  🧪 Test: ${test.name}${meta ? ` (${meta})` : ''}${syllabi ? ` — ${syllabi}` : ''}`);
    }
    const items = itemsByISO.get(d) ?? [];
    if (items.length > 0) {
      const grouped = new Map<string, string[]>();
      for (const item of items.slice(0, 8)) {
        const tag = item.type === 'topic' ? '' : ` [${item.type}]`;
        const list = grouped.get(item.subject) ?? [];
        list.push(`${item.title}${tag}`);
        grouped.set(item.subject, list);
      }
      parts.push(`  📖 ${[...grouped.entries()].map(([subject, titles]) => `${subject}: ${titles.join(', ')}`).join('; ')}`);
    }
    if (parts.length === 0) {
      if (dates.length === 1) {
        return `${formatISODate(d)} (${d}): is din koi class, test ya lecture scheduled nahi hai.`;
      }
      continue;
    }
    any = true;
    lines.push(`${formatISODate(d)} (${d}):`);
    lines.push(...parts);
  }
  if (!any) return `Is range (${from} se ${to}) mein koi class, test ya lecture schedule nahi mila.`;
  return lines.join('\n');
}

/** Available subject names for retry suggestions: subject-kind subjects + test syllabus subjects. */
export function availableSubjects(planners: SubjectPlanner[]): string[] {
  const names = new Set<string>();
  for (const p of planners) {
    if (p.kind === 'subject') names.add(p.subject);
    for (const subject of Object.keys(p.tests?.[0]?.syllabus ?? {})) names.add(subject);
    for (const t of p.tests ?? []) for (const subject of Object.keys(t.syllabus ?? {})) names.add(subject);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ===== Copyable conversion prompt (for any external AI) =====

export const PLANNER_CONVERSION_PROMPT = `Convert my coaching planner file into the LevelUp Planner JSON format.

The file attached below can be ANYTHING — a PDF, an Excel/CSV export, text pasted from a screenshot, printed notes, Hinglish or English — and it may contain EVERYTHING in ONE file:
- lecture/subject schedules for one or many subjects (chapter, topic, lecture number, date, faculty),
- a test schedule (test name, date, test type, pattern, and the syllabus per subject),
- a weekly class time-table (days → time slots → subject).

Convert the WHOLE file in ONE shot. Do not stop at the first table and do not pick just one kind — every part of the file becomes planner objects in the same JSON.

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no explanations, matching exactly this structure:

{
  "version": 2,
  "type": "levelup-subject-planner",
  "planners": [
    {
      "kind": "subject",
      "subject": "Physics",
      "title": "Class 11 Physics — full syllabus",
      "description": "Optional short note about this planner",
      "items": [
        { "title": "Kinematics", "type": "chapter", "week": 1, "details": "Page 12-40, 30 questions" },
        { "title": "Free fall practice", "type": "task", "week": 1 }
      ]
    },
    {
      "kind": "test",
      "subject": "Lakshya JEE 2.0 2027",
      "title": "Full Test Schedule",
      "tests": [
        {
          "name": "Short Test-1",
          "date": "Sunday, July 5, 2026",
          "testType": "Part Test",
          "pattern": "Short Test",
          "syllabus": {
            "Physics": ["Electrostatic Introduction", "Electrostatic Potential"],
            "Chemistry": ["Binary Solution", "Concentration Terms"],
            "Maths": ["Determinants (Complete Chapter)"]
          }
        }
      ]
    },
    {
      "kind": "routine",
      "subject": "Routine",
      "title": "Class Timetable",
      "routine": [
        {
          "day": "MONDAY",
          "slots": [
            { "time": "04.00 PM - 05.45 PM", "activity": "PHYSICS" },
            { "time": "06.15 PM - 8.00 PM", "activity": "MATHEMATICS" }
          ]
        }
      ]
    }
  ]
}

RULES:
- Convert the ENTIRE file in one go. If it contains a lecture schedule for Physics AND Chemistry, a test schedule AND a weekly timetable, output ONE JSON containing all of them as separate planner objects (one "subject" planner per subject + one "test" planner + one "routine" planner). Do NOT leave out any table, any row, any column, and do NOT ask the user to split the file.
- SUBJECT kind: one planner object per subject. For lecture rows use "type": "lecture", the topic name in "title", and put the lecture number, date, faculty name and sub-subject in "details". ALSO copy the row's date into the item's "date" field (e.g. "date": "Tuesday, June 16, 2026") so date-range questions work. Keep chapter/topic names verbatim.
- TEST kind: one planner object whose "tests" array holds EVERY test row — keep the exact test name, date, test type and pattern, and split the syllabus by the subject columns (Physics/Chemistry/Maths). Keep every topic verbatim, including annotations like "(Complete Chapter)".
- ROUTINE kind: one planner object whose "routine" array holds EVERY day row and every time slot — keep day names and times exactly as written.
- Preserve EVERYTHING as-is: original spelling, capitalisation, Hinglish/English mix, dates, times, faculty names. Do NOT translate, rename, summarise, merge or drop anything.
- Use the same batch/subject names consistently across all planner objects.
- Return ONLY the JSON. No text before or after it.`;

export function plannerUid(prefix = 'pl'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

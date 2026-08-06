// Deterministic chat tool protocol. The LLM may answer a task-related query
// with one JSON tool action — or, for multi-part requests, an array of actions
// executed together. The app executes them locally and feeds the combined
// result back for a Hinglish summary. Works on ANY provider because it never
// relies on native function-calling support.

import { z } from 'zod';
import { ROMAN_SCRIPT_RULE } from './chat';

const taskMetadataSchema = {
  description: z.string().min(1).max(500).optional(),
  habitId: z.string().min(1).optional(),
  phase: z.enum(['jee-core', 'l-mindset', 'light-execution', 'peak-performance']).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  energyLevel: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string().min(1)).max(12).optional(),
  prerequisites: z.array(z.string().min(1)).max(12).optional(),
  taskType: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Review', 'Recovery', 'Reflection', 'Challenge']).optional(),
  revisionSuitability: z.number().min(0).max(1).optional(),
  backlogSuitability: z.number().min(0).max(1).optional(),
  thinkingSkills: z.array(z.enum(['planning', 'focus', 'discipline', 'recall', 'analysis', 'reasoning', 'verification', 'reflection', 'systems', 'creativity'])).max(4).optional(),
  jeeRelevance: z.object({ subject: z.string().min(1).optional(), examWindow: z.boolean().optional(), score: z.number().min(0).max(1) }).optional(),
};

export const chatToolActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('getPlan'), day: z.number().int() }),
  z.object({ action: z.literal('getRange'), fromDay: z.number().int(), toDay: z.number().int() }),
  z.object({ action: z.literal('addTask'), day: z.number().int(), intent: z.string().min(1), durationMin: z.number().int().min(1).max(600).optional(), ...taskMetadataSchema }),
  z.object({
    action: z.literal('bulkAddTasks'),
    day: z.number().int(),
    intents: z.array(z.string().min(1)).min(1).max(100),
    durationMin: z.number().int().min(1).max(600).optional(),
    tags: taskMetadataSchema.tags,
    taskType: taskMetadataSchema.taskType,
    difficulty: taskMetadataSchema.difficulty,
    energyLevel: taskMetadataSchema.energyLevel,
  }),
  z.object({ action: z.literal('removeTask'), day: z.number().int(), taskId: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('bulkRemoveTasks'), day: z.number().int(), taskIds: z.array(z.string().min(1)).min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('setDayMode'), day: z.number().int(), mode: z.enum(['study', 'rest']), confirmed: z.boolean().optional() }),
  z.object({
    action: z.literal('editTask'),
    day: z.number().int(),
    taskId: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    durationMin: z.number().int().min(1).max(600).optional(),
    dayTo: z.number().int().min(1).max(90).optional(),
    ...taskMetadataSchema,
  }),
  z.object({ action: z.literal('markDone'), day: z.number().int(), taskId: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('bulkMarkDone'), day: z.number().int(), taskIds: z.array(z.string().min(1)).min(1).optional(), confirmed: z.boolean().optional() }),
  // Task Bank Management (view, edit, delete any task)
  z.object({ action: z.literal('getAllTasks'), day: z.number().int() }),
  z.object({ action: z.literal('getTaskBank'), category: z.string().optional() }),
  z.object({ action: z.literal('editAnyTask'), taskId: z.string().min(1), title: z.string().min(1).max(200).optional(), durationMin: z.number().int().min(1).max(600).optional(), category: z.string().optional(), ...taskMetadataSchema }),
  z.object({ action: z.literal('deleteAnyTask'), taskId: z.string().min(1), confirmed: z.boolean().optional() }),
  // Block management actions
  z.object({
    action: z.literal('createBlock'),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500).optional(),
    days: z.number().int().min(1).max(90).optional(),
    dayStart: z.number().int().min(91).optional(),
    focusAreas: z.array(z.string()).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard', 'extreme']).optional(),
    goals: z.array(z.string()).optional(),
    habits: z.array(z.string()).optional(),
  }),
  z.object({ action: z.literal('deleteBlock'), blockId: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('activateBlock'), blockId: z.string().min(1) }),
  z.object({ action: z.literal('editBlock'), blockId: z.string().min(1), name: z.string().min(1).max(100).optional(), description: z.string().min(1).max(500).optional(), dayStart: z.number().int().min(91).optional(), dayEnd: z.number().int().min(91).optional(), days: z.number().int().min(1).max(90).optional(), difficulty: z.enum(['easy', 'medium', 'hard', 'extreme']).optional(), goals: z.array(z.string()).optional(), habits: z.array(z.string()).optional() }),
  z.object({ action: z.literal('listBlocks') }),
  z.object({ action: z.literal('extendBlock'), blockId: z.string().min(1), days: z.number().int().min(1).max(30) }),
  // Read-only uploaded-coaching-planner actions (subjects / tests / routine).
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
  z.object({ action: z.literal('getContext') }),
]);

export type ChatToolAction = z.infer<typeof chatToolActionSchema>;

/** Wrapper the model may emit to request several actions in one reply. */
export const chatToolBatchSchema = z.object({
  actions: z.array(chatToolActionSchema).min(1).max(100),
});

export type ChatToolBatch = z.infer<typeof chatToolBatchSchema>;

export interface ChatToolResult {
  ok: boolean;
  /** Human/machine-readable structured summary fed back to the LLM. */
  summary: string;
  /** True when the action is a preview and must be retried with confirmed:true. */
  requiresConfirmation?: boolean;
  /** Version id recorded for an applied mutation. */
  versionId?: string;
  /** Days whose task-id action failed because the id wasn't in that day's
   *  plan. Lets the chat service auto-fetch the day's plan and retry once with
   *  the real ids — the "pehle plan dekho, phir edit karo" chaining. */
  missingTaskIdDays?: number[];
  /** True when this failure is FIXABLE by the model re-emitting better JSON —
   *  e.g. a wrong/guessed id, a missing edit field, or a block not found. Lets
   *  the chat service feed the exact error back and let the model retry. */
  retryable?: boolean;
  /** Per-action execution results — lets the chat service show the model
   *  exactly which actions succeeded and which failed, so a retry only
   *  re-emits the failures instead of double-applying the batch. */
  results?: ChatToolActionResult[];
}

/** Per-action outcome recorded by runMany. */
export interface ChatToolActionResult {
  action: string;
  ok: boolean;
  summary: string;
  requiresConfirmation?: boolean;
  missingTaskIdDays?: number[];
  /** Same semantics as ChatToolResult.retryable. */
  retryable?: boolean;
}

/** Description of the tool protocol embedded in the system prompt. */
export const CHAT_TOOL_INSTRUCTIONS = `You can VIEW or MODIFY the study plan for ANY day (1-90) AND manage custom study blocks.

When the user asks about the plan for a day, or wants to add/remove/edit/complete tasks,
your ENTIRE reply must be exactly one JSON object, no extra text.

ALL TOOLS (quick reference — pick the MOST specific one):
- getContext — current journey snapshot: date, journey day/phase/streak, today's tasks + progress, XP/consistency/habits, weak habits, gaps, blocks, planners. Use for "mera progress/status/context batao".
- getPlan{day} — one day's plan. getRange{fromDay,toDay} — plan for a range (≤10 days).
- getAllTasks{day} — ALL tasks (AI + user) for a day. getTaskBank — whole bank (optionally by category).
- addTask / bulkAddTasks{day,intents} — add one/many tasks to a day. editTask / editAnyTask — edit a task.
- removeTask / bulkRemoveTasks — hide tasks for ONE day (bank safe). deleteAnyTask — delete from bank (destructive).
- markDone / bulkMarkDone — complete tasks. setDayMode{day,mode:rest|study} — holiday toggle.
- listBlocks / createBlock / editBlock / extendBlock / activateBlock / deleteBlock — custom study blocks.
- listPlanners / getSubject / getPlanner / getTest / getTests / getRoutine / getDay — uploaded coaching planners (read-only).

CURRENT CONTEXT:
- When the user asks about their overall progress/status/context ("mera progress kya hai", "status batao", "context batao", "mera streak kitna hai", "overview de"): {"action":"getContext"} — returns the complete journey snapshot (date, day/phase/streak, today's tasks + progress, XP, habits, gaps, blocks, planners). Prefer it over getPlan for whole-journey questions.

TASK MANAGEMENT:
- Plan for a day: {"action":"getPlan","day":N}
- Overview of a range: {"action":"getRange","fromDay":A,"toDay":B} (max 10 days per call; auto-splits if larger)
- View ALL tasks for a day (AI + user created): {"action":"getAllTasks","day":N}
- View entire task bank: {"action":"getTaskBank"} or {"action":"getTaskBank","category":"physics"}
- Add a task: {"action":"addTask","day":N,"intent":"<what task>","durationMin":30}. durationMin is REQUIRED; infer a sensible value if the user did not say it. The task appears ONLY on Day N.
  Optional full task info you SHOULD include when known: description, habitId, phase, difficulty (1-5), energyLevel (low/medium/high), tags, prerequisites, taskType, revisionSuitability (0-1), backlogSuitability (0-1), thinkingSkills, jeeRelevance:{subject,examWindow,score}.
- Add multiple tasks at once: {"action":"bulkAddTasks","day":N,"intents":["maths 10 questions","thermo revision"],"durationMin":30}. durationMin is REQUIRED; infer if needed. All appear ONLY on Day N. Optional shared info: tags, taskType, difficulty, energyLevel.
- Edit a task (title/duration, move day, or metadata): {"action":"editTask","day":N,"taskId":"<id from plan>","title":"New title","durationMin":20,"dayTo":5,"difficulty":3,"tags":["physics"]}. "dayTo" moves it so it only appears on that exact day. If you do not have enough info, first use getPlan/getAllTasks/getTaskBank, then retry with a real id and fields to change.
- Remove a task from ONE day: {"action":"removeTask","day":N,"taskId":"<id from plan>"}. This ONLY hides it for Day N — the Task Bank is NEVER modified and the same task still appears on other days. Destructive: first call without confirmed to get a preview; only call with "confirmed":true after the user explicitly confirms.
- Remove multiple tasks from one day: {"action":"bulkRemoveTasks","day":N,"taskIds":["id1","id2"]}. Same confirmation rule and bank-safe behavior.
- Mark a day as a REST/HOLIDAY day: {"action":"setDayMode","day":N,"mode":"rest"}. On a rest day no auto curriculum or AI tasks appear, only tasks the user explicitly scheduled. To make it a normal study day again use "mode":"study". If the user says Sunday/holiday/chhuti, this is the right tool. Changing a day is safe and undoable.
- Mark a task done: {"action":"markDone","day":N,"taskId":"<id from plan>"}
- Mark multiple/all tasks done for one day: {"action":"bulkMarkDone","day":N,"taskIds":["id1","id2"],"confirmed":true}. If the user says all/saare tasks, omit taskIds to target all visible plan tasks. This is bulk edit: first call without confirmed to preview; only call with "confirmed":true after explicit confirmation.

TASK BANK MANAGEMENT (full control):
- View all tasks: {"action":"getTaskBank"} - shows entire task bank with IDs
- View by category: {"action":"getTaskBank","category":"physics"}
- Edit any dynamic task in bank: {"action":"editAnyTask","taskId":"<taskId>","title":"New Title","durationMin":45,"category":"chemistry","difficulty":3,"energyLevel":"medium","tags":["chemistry"]}. You can also update description, habitId, phase, prerequisites, taskType, revisionSuitability, backlogSuitability, thinkingSkills, jeeRelevance. Base/seed tasks cannot be edited directly; add/edit creates dynamic copies only.
- Delete any task from bank: {"action":"deleteAnyTask","taskId":"<taskId>"} - DESTRUCTIVE, needs confirmation

CUSTOM BLOCK MANAGEMENT (for post-journey study, after 90 days):
- List all blocks: {"action":"listBlocks"} - shows all blocks with their status
- Create a custom block: {"action":"createBlock","name":"Physics Mastery","description":"15-day physics focus","days":15,"focusAreas":["physics"],"difficulty":"medium"}
  - name: block name (required)
  - description: block description (optional but include if user gave purpose)
  - days: duration in days (optional, default 15)
  - dayStart: exact post-journey start day, >=91 (optional; otherwise app appends after last block)
  - focusAreas: array of "physics","chemistry","maths","revision","mock","concept","problem" (optional, auto-detected from name)
  - difficulty: "easy","medium","hard","extreme" (optional, default "medium")
  - habits/goals: custom arrays (optional)
  - Example: "create a 15 day physics block" → auto-detects physics focus
  - Example: "banao ek chemistry revision block 7 din ka" → auto-detects chemistry, revision
- Edit a block: {"action":"editBlock","blockId":"<id>","name":"New Name","description":"New details","difficulty":"hard","days":20,"dayStart":91,"dayEnd":110,"goals":["goal1"],"habits":["habit1"]} - can update metadata and dates. If you do not know blockId, use listBlocks first.
- Extend a block: {"action":"extendBlock","blockId":"<id>","days":5} - adds more days to the end and shifts later blocks forward.
- Delete a block: {"action":"deleteBlock","blockId":"<block-id>"}. Destructive: needs confirmation. If deleting the active block, the app automatically activates the next available block or clears active block.
- Activate a block: {"action":"activateBlock","blockId":"<block-id>"}. Makes this block guide your daily study.

Full control examples:
- "saare tasks dikhao day 5 ke" → getAllTasks for day 5
- "task bank mein kya kya hai" → getTaskBank
- "physics wale tasks dekho" → getTaskBank with category
- "task xyz ka naam badal do" → editAnyTask
- "ye task delete karo" → deleteAnyTask (needs confirm)
- "10 din ka plan dikhao" → getRange with 10 days
- "edit block block-xxx make it harder" → editBlock with difficulty:hard
- "add 5 more days to physics block" → extendBlock with days:5
- "delete the chemistry block" → deleteBlock (needs confirm)
- "show all my blocks" → listBlocks
- "activate revision block" → activateBlock (use exact block id from listBlocks)

Task ids come from today's plan context or from a plan you saw in this chat (format "id:<taskId>", e.g. d1_t1, mock_1, ai-xxxxx). If a day's plan is NOT visible to you yet, DO NOT refuse — still emit the requested action with your best guess for the task id. The system will automatically fetch that day's plan (with the real ids) and let you retry with the correct id in the next step.

SEVERAL changes in ONE request (e.g. "3 tasks add karo, ek hatao, aur 2 mark done"):
emit EVERY change together in an actions array, e.g.
{"actions":[{"action":"addTask","day":5,"intent":"maths 10 questions","durationMin":30},{"action":"addTask","day":5,"intent":"thermo revision","durationMin":40},{"action":"removeTask","day":5,"taskId":"d1_t1","confirmed":true},{"action":"markDone","day":5,"taskId":"d1_t2"}]}
Multi-action rules:
- Do EVERYTHING the user asked for in the same reply — never execute only one of several requested changes.
- Max 100 actions per reply. Actions run top-to-bottom and all results come back combined with task ids.
- Destructive/bulk actions (removeTask, bulkRemoveTasks, setDayMode, bulkMarkDone, deleteBlock, deleteAnyTask) still need "confirmed":true once the user has explicitly agreed; without it the WHOLE batch is only previewed and NOTHING is applied.
- For a range longer than 10 days, auto-splits into multiple calls.

The tool result returns updated plans/task-bank rows with task ids and full task metadata when relevant. Sundays (Day 7, 14, 21...) are MOCK test days, NOT automatically holidays: on a mock Sunday the mock protocol tasks appear AND you can still add tasks with addTask/bulkAddTasks. Only use setDayMode "rest" when the user actually wants a holiday/rest day.
For ANYTHING else (concepts, motivation, general questions, block suggestions, study strategies) reply normally in Hinglish (always ROMAN script). ${ROMAN_SCRIPT_RULE}`;

/** Correction prompt used when the model answered with prose instead of a tool action. */
export const CHAT_TOOL_RETRY =
  'You just answered with normal text, but this message was about the study plan and MUST be a tool action. ' +
  'Do NOT refuse, do NOT explain your limitations, do NOT apologize. ' +
  'If the user asks to add/remove/complete a task, that is fully supported and safe. ' +
  'Your ENTIRE reply must be exactly one JSON object chosen from the allowed actions above — ' +
  'either ONE action (e.g. {"action":"removeTask","day":10,"taskId":"d1_t1"}), ' +
  'or {"actions":[...]} when the user asked for several changes at once. ' +
  'The task ids come from the plan (e.g. d1_t1, mock_1, ai-xxxxx).';

/** Planner-tools section appended to the system prompt ONLY when the student
 *  has imported coaching planners — so the model can read them in the SAME
 *  decision hop as the task tools (never a separate flow). Read-only. */
export const CHAT_PLANNER_INSTRUCTIONS = `UPLOADED COACHING PLANNERS (read-only): the student may have imported coaching files — SUBJECT planners (chapters/topics/lectures per subject, each item may carry a date), a TEST planner (test name, date, pattern, per-subject syllabus) and a ROUTINE planner (weekly class time-table, day → slots → subject):

{"action":"listPlanners"}                                   # all planners with ids, grouped by kind
{"action":"listPlanners","type":"test"}                     # planners of one kind only: subject | test | routine
{"action":"getSubject","subject":"Physics"}                 # a subject's planner items AND the tests covering it
{"action":"getSubject","subject":"Physics","from":"2026-07-01","to":"2026-07-31"}  # only items/tests inside the date range
{"action":"getPlanner","plannerId":"<id>"}                  # one planner's full content (id comes from listPlanners)
{"action":"getPlanner","plannerId":"<id>","from":"2026-07-01","to":"2026-07-31"}  # same, only dated items/tests inside the range
{"action":"getTest","testName":"JEE Main-1"}                # one test by name (exact or partial)
{"action":"getTests"}                                       # ALL tests, sorted by date
{"action":"getTests","from":"2026-07-01","to":"2026-08-15","subject":"Maths"}  # tests inside a date range, optionally one subject
{"action":"getRoutine","day":"Monday"}                      # weekly routine (omit day for the full week)
{"action":"getDay","date":"2026-07-05"}                     # EVERYTHING on one day at once: routine classes + tests + dated lectures/items
{"action":"getDay","from":"2026-07-05","to":"2026-07-11"}   # same for a whole date range (max 31 days)

DATE RANGES: use "from"/"to" (inclusive, YYYY-MM-DD) on getTests/getSubject/getPlanner/getDay whenever the data could be large or the user names a window ("is week ke tests", "july ke tests", "kal koi test hai", "1 se 10 tarikh kya kya hai"). Resolve "aaj"/"kal"/"is week" from the date given below. For the weekly routine, pass the weekday the user asked about ("monday ko kya class hai" → getRoutine day:"Monday"). For "uss din kya kya hai" / "aaj kya kya hai" / "5 july ko kya hoga" / "1 se 10 tarikh kya kya hai" → getDay (combines classes + tests + lectures for that day or range).
Pick the MOST SPECIFIC action that answers the question — "tests dekho" → getTests, "physics mein kya kya hai" → getSubject, "routine batao" → getRoutine, "aaj kya kya hai" → getDay. Only use listPlanners when you need real ids / exact subject or test names. If nothing is uploaded, answer normally in Hinglish (ROMAN script) instead of JSON. ${ROMAN_SCRIPT_RULE}`;

// ---- Tool catalog for the chat "select tools" (@ mentions) picker ----

export interface ChatToolMeta {
  id: string;
  label: string;
  description: string;
  example: string;
  /** Destructive / bulk tools still require the user's explicit "confirmed":true. */
  confirmationRequired?: boolean;
  /** Read-only tools never mutate the student's plan/bank/blocks. */
  readOnly?: boolean;
}

/** The full, user-pickable tool set — mirrors CHAT_TOOL_INSTRUCTIONS + planner tools. */
export const CHAT_TOOL_CATALOG: ChatToolMeta[] = [
  { id: 'getContext', label: 'Journey status', description: 'Current journey snapshot: date, day/phase/streak, today\'s tasks + progress, XP/habits, gaps, blocks, planners.', example: '{"action":"getContext"}', readOnly: true },
  { id: 'getPlan', label: 'Day plan', description: 'One day ka plan with real task ids.', example: '{"action":"getPlan","day":3}', readOnly: true },
  { id: 'getRange', label: 'Range overview', description: 'Plan overview for a day range (max 10 days).', example: '{"action":"getRange","fromDay":1,"toDay":7}', readOnly: true },
  { id: 'getAllTasks', label: 'All tasks of a day', description: 'AI + user tasks for one day.', example: '{"action":"getAllTasks","day":3}', readOnly: true },
  { id: 'getTaskBank', label: 'Task bank', description: 'Poora task bank (category filter optional).', example: '{"action":"getTaskBank","category":"physics"}', readOnly: true },
  { id: 'addTask', label: 'Add task', description: 'Ek task add karo ek day ke plan mein (sirf usi din).', example: '{"action":"addTask","day":3,"intent":"physics revision","durationMin":40}' },
  { id: 'bulkAddTasks', label: 'Bulk add tasks', description: 'Ek saath kai tasks add karo ek day par.', example: '{"action":"bulkAddTasks","day":3,"intents":["maths 10 questions","thermo revision"],"durationMin":30}' },
  { id: 'editTask', label: 'Edit day task', description: 'Ek day ke planned task ka title/duration/dayTo/metadata badlo.', example: '{"action":"editTask","day":3,"taskId":"d1_t1","durationMin":25}' },
  { id: 'editAnyTask', label: 'Edit bank task', description: 'Task bank ke kisi bhi task ko edit karo (title, duration, category, metadata).', example: '{"action":"editAnyTask","taskId":"ai-123","title":"New title","durationMin":45}' },
  { id: 'removeTask', label: 'Remove from day', description: 'Ek task ko sirf is day se hatao (bank kabhi delete nahi hota).', example: '{"action":"removeTask","day":3,"taskId":"d1_t1"}', confirmationRequired: true },
  { id: 'bulkRemoveTasks', label: 'Bulk remove from day', description: 'Kai tasks ko ek day se hatao.', example: '{"action":"bulkRemoveTasks","day":3,"taskIds":["d1_t1","d1_t2"]}', confirmationRequired: true },
  { id: 'deleteAnyTask', label: 'Delete bank task', description: 'Task bank se task permanently delete karo.', example: '{"action":"deleteAnyTask","taskId":"ai-123"}', confirmationRequired: true },
  { id: 'markDone', label: 'Mark done', description: 'Ek task ko complete mark karo.', example: '{"action":"markDone","day":3,"taskId":"d1_t1"}' },
  { id: 'bulkMarkDone', label: 'Bulk mark done', description: 'Kai tasks ko complete mark karo.', example: '{"action":"bulkMarkDone","day":3,"taskIds":["d1_t1","d1_t2"]}', confirmationRequired: true },
  { id: 'setDayMode', label: 'Rest/study day', description: 'Day ko rest (chhuti) ya study day banao.', example: '{"action":"setDayMode","day":3,"mode":"rest"}' },
  { id: 'listBlocks', label: 'List blocks', description: 'Saare custom study blocks dikhao.', example: '{"action":"listBlocks"}', readOnly: true },
  { id: 'createBlock', label: 'Create block', description: 'Custom study block banao (post-journey).', example: '{"action":"createBlock","name":"Physics Mastery","days":15,"focusAreas":["physics"],"difficulty":"medium"}' },
  { id: 'editBlock', label: 'Edit block', description: 'Block ka naam/days/difficulty/habits badlo.', example: '{"action":"editBlock","blockId":"bk-1","days":20,"difficulty":"hard"}' },
  { id: 'extendBlock', label: 'Extend block', description: 'Block mein extra days jodo.', example: '{"action":"extendBlock","blockId":"bk-1","days":5}' },
  { id: 'activateBlock', label: 'Activate block', description: 'Block ko active banao.', example: '{"action":"activateBlock","blockId":"bk-1"}' },
  { id: 'deleteBlock', label: 'Delete block', description: 'Custom block delete karo.', example: '{"action":"deleteBlock","blockId":"bk-1"}', confirmationRequired: true },
  { id: 'listPlanners', label: 'List planners', description: 'Uploaded coaching planners dikhao.', example: '{"action":"listPlanners"}', readOnly: true },
  { id: 'getSubject', label: 'Subject detail', description: 'Uploaded planner se subject detail (topics, chapters, tests).', example: '{"action":"getSubject","subject":"Physics"}', readOnly: true },
  { id: 'getPlanner', label: 'Planner detail', description: 'Kisi planner ka poora structure.', example: '{"action":"getPlanner","plannerId":"<id>"}', readOnly: true },
  { id: 'getTest', label: 'Test detail', description: 'Uploaded planner se ek test ka detail.', example: '{"action":"getTest","testName":"JEE Main-1"}', readOnly: true },
  { id: 'getTests', label: 'Tests list', description: 'Uploaded planner se tests list (date range optional).', example: '{"action":"getTests","from":"2026-07-01","to":"2026-07-31"}', readOnly: true },
  { id: 'getRoutine', label: 'Routine', description: 'Uploaded planner se weekly routine.', example: '{"action":"getRoutine","day":"Monday"}', readOnly: true },
  { id: 'getDay', label: 'Day detail', description: 'Uploaded planner se ek din ka poora detail (classes + tests + lectures).', example: '{"action":"getDay","date":"2026-07-05"}', readOnly: true },
];

/**
 * Decision-hop system prompt when the user pinned a set of tools with "@"
 * mentions: ONLY those tools may be used this run, and the model must reply
 * with exactly one JSON object (or an actions array) built from them.
 */
export function chatToolScopeInstructions(onlyTools: string[]): string {
  const selected = CHAT_TOOL_CATALOG.filter((t) => onlyTools.includes(t.id));
  const lines = selected.map((t) => {
    const confirm = t.confirmationRequired ? ' [needs the user\'s "confirmed":true first]' : '';
    const ro = t.readOnly ? ' (read-only)' : '';
    return `- ${t.id} — ${t.description}${ro}${confirm}. Example: ${t.example}`;
  });
  const multiToolRule =
    selected.length > 1
      ? `\nMULTIPLE tools are selected. Use EVERY selected tool that the user's request touches — never run just one when the request needs several. ` +
        `When several are needed, emit them TOGETHER in one {"actions":[...]} array: READ/view tools first (getPlan, getDay, getTests, getSubject, getTaskBank, getContext...), then MODIFY tools after them (addTask, editTask, markDone, removeTask...). ` +
        `Example: request "aaj ke tasks batao aur ek revision add karo" with getDay+addTask selected → {"actions":[{"action":"getDay",...},{"action":"addTask",...}]}. ` +
        `Do NOT silently drop a selected tool the request asks about.\n`
      : '';
  return (
    `The user selected ONLY these tools for this run. Your ENTIRE reply must be exactly one JSON object ` +
    `(single action, or an {"actions":[...]} array when several changes are requested) that uses ONLY the selected tools below.\n` +
    `NEVER use any tool that is NOT listed. If the request cannot be fulfilled with the selected tools, reply with a short normal-text message in Hinglish (always ROMAN script) explaining which tool is missing.\n` +
    multiToolRule +
    `\nSelected tools:\n${lines.join('\n')}\n\n` +
    ROMAN_SCRIPT_RULE
  );
}

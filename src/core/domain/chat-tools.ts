// Deterministic chat tool protocol. The LLM may answer a task-related query
// with one JSON tool action — or, for multi-part requests, an array of actions
// executed together. The app executes them locally and feeds the combined
// result back for a Hinglish summary. Works on ANY provider because it never
// relies on native function-calling support.

import { z } from 'zod';

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
  z.object({ action: z.literal('addTask'), day: z.number().int(), intent: z.string().min(1), durationMin: z.number().int().min(1).max(600), ...taskMetadataSchema }),
  z.object({
    action: z.literal('bulkAddTasks'),
    day: z.number().int(),
    intents: z.array(z.string().min(1)).min(1).max(100),
    durationMin: z.number().int().min(1).max(600),
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
For ANYTHING else (concepts, motivation, general questions, block suggestions, study strategies) reply normally in Hinglish.`;

/** Correction prompt used when the model answered with prose instead of a tool action. */
export const CHAT_TOOL_RETRY =
  'You just answered with normal text, but this message was about the study plan and MUST be a tool action. ' +
  'Do NOT refuse, do NOT explain your limitations, do NOT apologize. ' +
  'If the user asks to add/remove/complete a task, that is fully supported and safe. ' +
  'Your ENTIRE reply must be exactly one JSON object chosen from the allowed actions above — ' +
  'either ONE action (e.g. {"action":"removeTask","day":10,"taskId":"d1_t1"}), ' +
  'or {"actions":[...]} when the user asked for several changes at once. ' +
  'The task ids come from the plan (e.g. d1_t1, mock_1, ai-xxxxx).';

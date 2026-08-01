// Deterministic chat tool protocol. The LLM may answer a task-related query
// with one JSON tool action — or, for multi-part requests, an array of actions
// executed together. The app executes them locally and feeds the combined
// result back for a Hinglish summary. Works on ANY provider because it never
// relies on native function-calling support.

import { z } from 'zod';

export const chatToolActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('getPlan'), day: z.number().int() }),
  z.object({ action: z.literal('getRange'), fromDay: z.number().int(), toDay: z.number().int() }),
  z.object({ action: z.literal('addTask'), day: z.number().int(), intent: z.string().min(1), durationMin: z.number().int().min(1).max(600).optional() }),
  z.object({
    action: z.literal('bulkAddTasks'),
    day: z.number().int(),
    intents: z.array(z.string().min(1)).min(1).max(6),
    durationMin: z.number().int().min(1).max(600).optional(),
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
  }),
  z.object({ action: z.literal('markDone'), day: z.number().int(), taskId: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('bulkMarkDone'), day: z.number().int(), taskIds: z.array(z.string().min(1)).min(1).optional(), confirmed: z.boolean().optional() }),
  // Block management actions
  z.object({
    action: z.literal('createBlock'),
    name: z.string().min(1).max(100),
    days: z.number().int().min(1).max(90).optional(),
    focusAreas: z.array(z.string()).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard', 'extreme']).optional(),
    goals: z.array(z.string()).optional(),
    habits: z.array(z.string()).optional(),
  }),
  z.object({ action: z.literal('deleteBlock'), blockId: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('activateBlock'), blockId: z.string().min(1) }),
]);

export type ChatToolAction = z.infer<typeof chatToolActionSchema>;

/** Wrapper the model may emit to request several actions in one reply. */
export const chatToolBatchSchema = z.object({
  actions: z.array(chatToolActionSchema).min(1).max(6),
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
}

/** Description of the tool protocol embedded in the system prompt. */
export const CHAT_TOOL_INSTRUCTIONS = `You can VIEW or MODIFY the study plan for ANY day (1-90) AND manage custom study blocks.

When the user asks about the plan for a day, or wants to add/remove/edit/complete tasks,
your ENTIRE reply must be exactly one JSON object, no extra text.

ONE action (single-object form):
- Plan for a day: {"action":"getPlan","day":N}
- Overview of a range: {"action":"getRange","fromDay":A,"toDay":B} (max 7 days per call; for a wider span send SEVERAL getRange actions, one 7-day window each, in the actions array — a single oversized range is auto-split too)
- Add a task: {"action":"addTask","day":N,"intent":"<what task>","durationMin":30}. The task appears ONLY on Day N.
- Add multiple tasks at once: {"action":"bulkAddTasks","day":N,"intents":["maths 10 questions","thermo revision"],"durationMin":30}. All appear ONLY on Day N.
- Edit a task (title/duration, or move to another day): {"action":"editTask","day":N,"taskId":"<id from plan>","durationMin":20,"dayTo":5}. "dayTo" moves it so it only appears on that exact day.
- Remove a task from ONE day: {"action":"removeTask","day":N,"taskId":"<id from plan>"}. This ONLY hides it for Day N — the Task Bank is NEVER modified and the same task still appears on other days. Destructive: first call without confirmed to get a preview; only call with "confirmed":true after the user explicitly confirms.
- Remove multiple tasks from one day: {"action":"bulkRemoveTasks","day":N,"taskIds":["id1","id2"]}. Same confirmation rule and bank-safe behavior.
- Mark a day as a REST/HOLIDAY day: {"action":"setDayMode","day":N,"mode":"rest"}. On a rest day no auto curriculum or AI tasks appear, only tasks the user explicitly scheduled. To make it a normal study day again use "mode":"study". If the user says Sunday/holiday/chhuti, this is the right tool. Changing a day is safe and undoable.
- Mark a task done: {"action":"markDone","day":N,"taskId":"<id from plan>"}
- Mark multiple/all tasks done for one day: {"action":"bulkMarkDone","day":N,"taskIds":["id1","id2"],"confirmed":true}. If the user says all/saare tasks, omit taskIds to target all visible plan tasks. This is bulk edit: first call without confirmed to preview; only call with "confirmed":true after explicit confirmation.

CUSTOM BLOCK MANAGEMENT (for post-journey study, after 90 days):
- Create a custom block: {"action":"createBlock","name":"Physics Mastery","days":15,"focusAreas":["physics"],"difficulty":"medium"}
  - name: block name (required)
  - days: duration in days (optional, default 15)
  - focusAreas: array of "physics","chemistry","maths","revision","mock","concept","problem" (optional, auto-detected from name)
  - difficulty: "easy","medium","hard","extreme" (optional, default "medium")
  - habits/goals: custom arrays (optional)
  - Example: "create a 15 day physics block" → auto-detects physics focus
  - Example: "banao ek chemistry revision block 7 din ka" → auto-detects chemistry, revision
- Delete a block: {"action":"deleteBlock","blockId":"<block-id>"}. Must activate another block first if deleting active block. Destructive: needs confirmation.
- Activate a block: {"action":"activateBlock","blockId":"<block-id>"}. Makes this block guide your daily study.

Task ids come from today's plan context or from a plan you saw in this chat (format "id:<taskId>", e.g. d1_t1, mock_1, ai-xxxxx). If a day's plan is NOT visible to you yet, DO NOT refuse — still emit the requested action with your best guess for the task id. The system will automatically fetch that day's plan (with the real ids) and let you retry with the correct id in the next step.

SEVERAL changes in ONE request (e.g. "3 tasks add karo, ek hatao, aur 2 mark done"):
emit EVERY change together in an actions array, e.g.
{"actions":[{"action":"addTask","day":5,"intent":"maths 10 questions","durationMin":30},{"action":"addTask","day":5,"intent":"thermo revision","durationMin":40},{"action":"removeTask","day":5,"taskId":"d1_t1","confirmed":true},{"action":"markDone","day":5,"taskId":"d1_t2"}]}
Multi-action rules:
- Do EVERYTHING the user asked for in the same reply — never execute only one of several requested changes.
- Max 6 actions per reply. Actions run top-to-bottom and all results come back combined with task ids.
- Destructive/bulk actions (removeTask, bulkRemoveTasks, setDayMode, bulkMarkDone, deleteBlock) still need "confirmed":true once the user has explicitly agreed; without it the WHOLE batch is only previewed and NOTHING is applied.
- For a range longer than 7 days, use multiple getRange actions (7 days each) in one batch instead of failing.

The tool result always returns the updated plan with task ids. Sundays (Day 7, 14, 21...) are MOCK test days, NOT automatically holidays: on a mock Sunday the mock protocol tasks appear AND you can still add tasks with addTask/bulkAddTasks. Only use setDayMode "rest" when the user actually wants a holiday/rest day.
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

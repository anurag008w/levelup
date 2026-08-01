// Deterministic chat tool protocol. The LLM may answer a task-related query
// with exactly one JSON tool action; the app executes it locally and feeds the
// result back for a Hinglish summary. Works on ANY provider because it never
// relies on native function-calling support.

import { z } from 'zod';

export const chatToolActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('getPlan'), day: z.number().int() }),
  z.object({ action: z.literal('getRange'), fromDay: z.number().int(), toDay: z.number().int() }),
  z.object({ action: z.literal('addTask'), day: z.number().int(), intent: z.string().min(1), durationMin: z.number().int().min(1).max(600).optional() }),
  z.object({ action: z.literal('removeTask'), day: z.number().int(), taskId: z.string().min(1), confirmed: z.boolean().optional() }),
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
]);

export type ChatToolAction = z.infer<typeof chatToolActionSchema>;

export interface ChatToolResult {
  ok: boolean;
  /** Human/machine-readable structured summary fed back to the LLM. */
  summary: string;
  /** True when the action is a preview and must be retried with confirmed:true. */
  requiresConfirmation?: boolean;
  /** Version id recorded for an applied mutation. */
  versionId?: string;
}

/** Description of the tool protocol embedded in the system prompt. */
export const CHAT_TOOL_INSTRUCTIONS = `You can VIEW or MODIFY the study plan for ANY day (1-90).

When the user asks about the plan for a day, or wants to add/remove/edit/complete tasks,
your ENTIRE reply must be exactly one JSON object, no extra text:
- Plan for a day: {"action":"getPlan","day":N}
- Overview of a range (max 7 days): {"action":"getRange","fromDay":A,"toDay":B}
- Add a task: {"action":"addTask","day":N,"intent":"<what task>","durationMin":30}
- Edit a task (built-in or user/AI-added; change title/duration/day): {"action":"editTask","day":N,"taskId":"<id from plan>","durationMin":20,"dayTo":5}
- Remove a task (built-in or user/AI-added): {"action":"removeTask","day":N,"taskId":"<id from plan>"}. This is destructive: first call without confirmed to get a preview; only call with "confirmed":true after the user explicitly confirms.
- Mark a task done: {"action":"markDone","day":N,"taskId":"<id from plan>"}
- Mark multiple/all tasks done for one day: {"action":"bulkMarkDone","day":N,"taskIds":["id1","id2"],"confirmed":true}. If the user says all/saare tasks, omit taskIds to target all visible plan tasks. This is bulk edit: first call without confirmed to preview; only call with "confirmed":true after explicit confirmation.

For ANYTHING else (concepts, motivation, general questions) reply normally in Hinglish.`;

/** Correction prompt used when the model answered with prose instead of a tool action. */
export const CHAT_TOOL_RETRY =
  'You just answered with normal text, but this message was about the study plan and MUST be a tool action. ' +
  'Do NOT refuse, do NOT explain your limitations, do NOT apologize. ' +
  'If the user asks to add/remove/complete a task, that is fully supported and safe. ' +
  'Your ENTIRE reply must be exactly one JSON object chosen from the allowed actions above. ' +
  'The task ids come from the plan (e.g. {"action":"removeTask","day":10,"taskId":"d1_t1"}).';

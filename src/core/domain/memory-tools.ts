// Deterministic AI memory tool protocol. The LLM answers a memory-related query
// with one JSON action — read/edit/delete/pin memory entries — which the app
// executes locally and feeds back for a Hinglish summary. Works on ANY provider
// because it never relies on native function-calling support. Kept separate
// from the plan tools so the two protocols never fight in one decision hop.

import { z } from 'zod';

export const memoryToolActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('readMemory') }),
  z.object({
    action: z.literal('addMemory'),
    content: z.string().min(1).max(500),
    type: z.enum(['goal', 'preference', 'observation']).optional(),
    importance: z.number().min(0).max(1).optional(),
  }),
  z.object({ action: z.literal('editMemory'), id: z.string().min(1), content: z.string().min(1).max(500) }),
  z.object({ action: z.literal('deleteMemory'), id: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal('pinMemory'), id: z.string().min(1) }),
  z.object({ action: z.literal('unpinMemory'), id: z.string().min(1) }),
]);

export type MemoryToolAction = z.infer<typeof memoryToolActionSchema>;

/** Wrapper the model may emit to request several memory actions in one reply. */
export const memoryToolBatchSchema = z.object({
  actions: z.array(memoryToolActionSchema).min(1),
});

/** Safety cap applied when executing batches (beyond this, extras are dropped). */
export const MAX_MEMORY_TOOL_ACTIONS = 20;

export type MemoryToolBatch = z.infer<typeof memoryToolBatchSchema>;

export interface MemoryToolResult {
  ok: boolean;
  /** Structured summary fed back to the LLM (include memory ids so it can answer follow-ups). */
  summary: string;
  /** True when the action is a preview and must be retried with confirmed:true. */
  requiresConfirmation?: boolean;
}

export const MEMORY_TOOL_INSTRUCTIONS = `You have access to the student's saved AI memory — condensed facts from earlier coaching chats, plus user-entered entries.

You can ADD a fact, READ the memory, EDIT an entry's text, DELETE an entry, or PIN an entry into long-term memory (and UNPIN it).

Available actions (reply with exactly ONE JSON object, no prose, no markdown):

{"action":"readMemory"}                                        # list the student's memory
{"action":"addMemory","content":"<fact to remember>"}          # save a NEW fact ("yaad rakho X")
{"action":"addMemory","content":"<fact>","type":"goal"}        # save as a goal/preference/observation (optional)
{"action":"editMemory","id":"<entryId>","content":"<new text>"} # rewrite an entry (user asked to change it)
{"action":"deleteMemory","id":"<entryId>","confirmed":true}     # delete an entry
{"action":"pinMemory","id":"<entryId>"}                         # keep this in long-term memory
{"action":"unpinMemory","id":"<entryId>"}                       # remove from long-term memory

RULES:
- readMemory first whenever the user asks what you remember or about saved memory.
- When the user says "yaad rakho X" / "yaad rakhna X" / "mat bhoolna X", ADD it with addMemory instead of just talking.
- For edits/deletes you MUST use the real entry id from readMemory. Never invent ids.
- Deleting is destructive: if the user did not explicitly ask to delete, do nothing.
- After executing, explain what you did in short Hinglish (always ROMAN script).`;

/** Keywords that route a user message to the memory tool decision hop. */
const MEMORY_QUERY_PATTERN =
  /(?:yaad rakho|yaad hai|yaad rakh|yaad kar|yaad karo|yaad rahe|kaise yaad|kya yaad|yaad se|yaad rakhega|mat bhool|bhool mat|bhoolna|note kar|note le|likh le|save kar|store kar|memory|memories|long[- ]?term|pehle bola|pehle bata|delete (?:kar|karo).*memory|edit.*memory|memory.*edit|memory.*delete|surakshit|bhaagne)/i;

export function isMemoryQuery(text: string): boolean {
  return MEMORY_QUERY_PATTERN.test(text);
}

export function memoryEntriesToText(
  entries: Array<{ id: string; type: string; content: string; longTerm?: boolean; blockId?: string }>,
  limit = 30,
): string {
  const lines = entries.slice(0, limit).map((e) => {
    const pin = e.longTerm ? ' [long-term]' : '';
    return `- [${e.type}${pin}] ${e.content} (id:${e.id})`;
  });
  return lines.length > 0 ? lines.join('\n') : '(memory khaali hai)';
}

// Structured chat-transcript encoding. Every finished chat is archived in AI
// memory as a JSON transcript (with timestamps + session id) so it can be
// reconstructed exactly and shown read-only in the chat history later — even
// after the live session is gone. The encoder is deterministic and the parser
// is defensive: any malformed/legacy payload is skipped, never thrown on.

import { cleanImportText } from './import-utils';
import type { ChatMessage, ChatSession } from './chat';

/** Memory tag that links an entry to its chat session, e.g. "session:abc". */
export const SESSION_TAG_PREFIX = 'session:';

export function sessionMemoryTag(sessionId: string): string {
  return `${SESSION_TAG_PREFIX}${sessionId}`;
}

export const CHAT_TRANSCRIPT_VERSION = 1;

export interface ChatTranscript {
  version: typeof CHAT_TRANSCRIPT_VERSION;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

/** Encodes a session into a stable, round-trippable JSON transcript string. */
export function buildChatTranscript(session: Pick<ChatSession, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'messages'>): string {
  const payload: ChatTranscript = {
    version: CHAT_TRANSCRIPT_VERSION,
    sessionId: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      ...(m.model ? { model: m.model } : {}),
      ...(m.reasoning ? { reasoning: m.reasoning } : {}),
      ...(m.tool ? { tool: m.tool } : {}),
      ...(m.stopped ? { stopped: true } : {}),
      // Blob `previewUrl`s are volatile and useless after a reload, so only the
      // durable fields are archived. Extracted text is kept as the renderable
      // fallback for files the model couldn't ingest.
      ...(m.attachments && m.attachments.length > 0
        ? {
            attachments: m.attachments.map((a) => ({
              id: a.id,
              name: a.name,
              kind: a.kind,
              ...(a.content ? { content: a.content } : {}),
            })),
          }
        : {}),
    })),
  };
  return JSON.stringify(payload);
}

/**
 * Reconstructs a session from a stored transcript. Returns null for anything
 * that is not a valid versioned transcript (legacy plain-text dumps, edited
 * memory, etc.) so callers can fall back gracefully.
 */
export function parseChatTranscript(content: string): ChatTranscript | null {
  if (typeof content !== 'string' || !content.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanImportText(content));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (p.version !== CHAT_TRANSCRIPT_VERSION) return null;
  if (typeof p.sessionId !== 'string' || typeof p.title !== 'string' || !Array.isArray(p.messages)) return null;

  const messages: ChatMessage[] = [];
  for (const raw of p.messages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const m = raw as Record<string, unknown>;
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;

    const attachments: ChatMessage['attachments'] = [];
    if (Array.isArray(m.attachments)) {
      for (const rawAtt of m.attachments) {
        if (!rawAtt || typeof rawAtt !== 'object' || Array.isArray(rawAtt)) continue;
        const a = rawAtt as Record<string, unknown>;
        if (typeof a.id !== 'string' || !a.id || typeof a.name !== 'string' || !a.name) continue;
        const kind = a.kind === 'text' || a.kind === 'image' || a.kind === 'file' || a.kind === 'binary' ? a.kind : 'file';
        attachments.push({
          id: a.id,
          name: a.name,
          kind,
          ...(typeof a.content === 'string' ? { content: a.content } : {}),
        });
      }
    }

    messages.push({
      id: typeof m.id === 'string' && m.id ? m.id : `archived-${messages.length}`,
      role: m.role,
      content: m.content,
      createdAt: typeof m.createdAt === 'string' && m.createdAt ? m.createdAt : new Date(0).toISOString(),
      ...(typeof m.model === 'string' ? { model: m.model } : {}),
      ...(typeof m.reasoning === 'string' ? { reasoning: m.reasoning } : {}),
      ...(typeof m.tool === 'string' ? { tool: m.tool } : {}),
      ...(m.stopped === true ? { stopped: true } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  return {
    version: CHAT_TRANSCRIPT_VERSION,
    sessionId: p.sessionId,
    title: p.title,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : (p.createdAt as string) || '',
    messages,
  };
}

/**
 * A read-only conversation surfaced from memory: either a full archived
 * transcript (source: 'transcript') or a set of AI-condensed blocks for a chat
 * whose full transcript is no longer around (source: 'ai-summary').
 */
export interface ArchivedConversation {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  source: 'transcript' | 'ai-summary';
  /** Id of the first memory entry backing this conversation. */
  memoryEntryId?: string;
}

/** Extracts a "[Title]" label from the first line of a memory block. */
export function extractBlockTitle(content: string): string | null {
  const first = content.split('\n')[0]?.trim();
  const match = first?.match(/^\[(.+)\]$/);
  return match ? match[1].trim() : null;
}

/** Strips a leading "[Title]" header line from a memory block's body. */
export function stripBlockTitle(content: string): string {
  return content.replace(/^\[[^\]]+\]\s*\n?/, '');
}

/**
 * Id of the transcript message that is STILL GROWING — the tail of the latest
 * snapshot when it is an assistant utterance. A user turn (or any non-assistant
 * tail) means the previous reply is final and returns null, so the UI flips its
 * bubble from cheap plain text to the single markdown parse.
 */
export function liveStreamingTailId(latest: { id: string; role: 'user' | 'assistant' }[]): string | null {
  const tail = latest[latest.length - 1];
  return tail && tail.role === 'assistant' && tail.id ? tail.id : null;
}

import { INTERNAL_SYSTEM_PROMPT } from '../../core/domain/chat';
import type { ChatMessage, ChatSession, ChatPreferences, ChatStoreState } from '../../core/domain/chat';
import {
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSIONS,
  defaultChatPrefs,
} from '../../core/domain/chat';
import type { LLMMessage, LLMRequest, ThinkingLevel } from '../../core/domain/llm';
import { isAbortError } from '../../core/domain/llm';
import { CHAT_TOOL_INSTRUCTIONS, CHAT_TOOL_RETRY } from '../../core/domain/chat-tools';
import type { ChatToolResult } from '../../core/domain/chat-tools';
import { createStreamSanitizer, sanitizeTimestampLeaks } from './leak-sanitizer';
import type { Clock } from '../../core/ports/clock';
import type { ChatRepository, StateStore } from '../../core/ports/repositories';
import type { LLMService } from '../ai/llm.service';
import type { ProviderSettingsService } from '../ai/provider-settings.service';
import type { MemoryService } from '../ai/memory.service';
import type { ChatToolsService } from './chat-tools.service';

const HISTORY_FOR_PROMPT = 30;
const MEMORY_FOR_PROMPT = 8;
const MEMORY_USER_MAX_CHARS = 500;
const MEMORY_AI_MAX_CHARS = 400;
/** Max decision hops per message: initial guess + plan-fetch replans. */
const MAX_TOOL_HOPS = 3;

/**
 * Chat feature service: session persistence + LLM streaming. Chat data lives in
 * its own repository so big transcripts never bloat the app-state snapshot.
 */
export class ChatService {
  private readonly repo: ChatRepository;
  private readonly llm: LLMService;
  private readonly settings: ProviderSettingsService;
  private readonly contextProvider: () => string;
  private readonly clock: Clock;
  private readonly tools: ChatToolsService | null;
  private readonly memory: MemoryService | null;
  private readonly store: StateStore | null;
  /** In-memory snapshot so mutations survive across persist() calls. */
  private cache: ChatStoreState | null = null;

  constructor(
    repo: ChatRepository,
    llm: LLMService,
    settings: ProviderSettingsService,
    contextProvider: () => string,
    clock: Clock,
    tools: ChatToolsService | null = null,
    memory: MemoryService | null = null,
    store: StateStore | null = null,
  ) {
    this.repo = repo;
    this.llm = llm;
    this.settings = settings;
    this.contextProvider = contextProvider;
    this.clock = clock;
    this.tools = tools;
    this.memory = memory;
    this.store = store;
  }

  private state(): ChatStoreState {
    if (this.cache === null) this.cache = this.repo.load();
    return this.cache;
  }

  listSessions(): ChatSession[] {
    return this.state().sessions.map(cloneSession);
  }

  getSession(id: string): ChatSession | null {
    return this.state().sessions.find((s) => s.id === id) ?? null;
  }

  createSession(title = ''): ChatSession {
    const now = this.clock.now().toISOString();
    const session: ChatSession = {
      id: uid(),
      title,
      messages: [],
      prefs: defaultChatPrefs(),
      createdAt: now,
      updatedAt: now,
    };
    const state = this.state();
    state.sessions.unshift(session);
    if (state.sessions.length > MAX_SESSIONS) state.sessions.length = MAX_SESSIONS;
    this.repo.save(state);
    return session;
  }

  deleteSession(id: string): void {
    const state = this.state();
    state.sessions = state.sessions.filter((s) => s.id !== id);
    this.repo.save(state);
  }

  clearSession(id: string): void {
    const session = this.getSession(id);
    if (!session) return;
    session.messages = [];
    session.updatedAt = this.clock.now().toISOString();
    this.persist();
  }

  /** Removes a single message (used by the message context menu). */
  deleteMessage(sessionId: string, messageId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    session.messages.splice(idx, 1);
    session.updatedAt = this.clock.now().toISOString();
    this.persist();
  }

  /** Deletes a message and everything after it (edit-from-here / regenerate). */
  deleteMessagesFrom(sessionId: string, messageId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    session.messages = session.messages.slice(0, idx);
    session.updatedAt = this.clock.now().toISOString();
    this.persist();
  }

  updatePrefs(id: string, prefs: ChatPreferences): void {
    const session = this.getSession(id);
    if (!session) return;
    session.prefs = prefs;
    session.updatedAt = this.clock.now().toISOString();
    this.persist();
  }

  /**
   * Sends a message and streams the answer. Appends the user message up front;
   * on a hard error the user message is rolled back so retry stays clean.
   * When the caller aborts mid-stream the partial text is kept as a `stopped`
   * assistant message instead of failing.
   *
   * Plan/task related messages take a "tool decision hop": one non-streaming
   * call decides whether the reply is a single tool action (view/modify any
   * day's tasks). Actions are executed deterministically, then the result is
   * streamed back as a Hinglish summary. Everything else streams as usual.
   */
  async send(
    sessionId: string,
    text: string,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
    onStatus?: (status: string) => void,
    onReasoningDelta?: (delta: string) => void,
  ): Promise<ChatMessage> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Chat session not found');

    const now = this.clock.now().toISOString();
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, createdAt: now };
    session.messages.push(userMsg);
    const titleWasEmpty = session.title.length === 0;
    if (titleWasEmpty) session.title = deriveTitle(text);
    session.updatedAt = now;
    this.persist();
    this.remember(text, 'user', sessionId);

    let partial = '';

    try {
      // Tool decision hop for plan/task queries.
      if (this.tools && this.tools.isTaskQuery(text)) {
        onStatus?.('AI soch raha hai…');
        const decision = await this.llm.complete(this.buildDecisionRequest(session, signal));
        let actions = this.tools.parseTools(decision.text);
        let answer = decision.text;
        if (actions.length === 0 && answer) {
          // The model talked instead of emitting an action — retry once with a
          // strict correction so plan tools work even on weaker models.
          onStatus?.('Tool decision retry kar raha hai…');
          const retry = await this.llm.complete(this.buildRetryRequest(session, decision.text, signal));
          actions = this.tools.parseTools(retry.text);
          if (retry.text) answer = retry.text;
        }
        if (actions.length === 0) {
          if (answer) {
            const assistant: ChatMessage = {
              id: uid(),
              role: 'assistant',
              content: sanitizeTimestampLeaks(answer),
              createdAt: this.clock.now().toISOString(),
              model: decision.model,
            };
            this.appendAssistant(session, assistant);
            return assistant;
          }
          throw new Error('AI khaali reply diya');
        }
        onStatus?.(
          actions.length > 1
            ? `${actions.length} tools chala raha hai…`
            : `Tool chala raha hai: ${actions[0].action}`,
        );
        // Tool agent loop: if the model guessed task ids that aren't in a
        // day's plan, fetch that day's plan deterministically and let the model
        // retry with the REAL ids — "pehle plan dekho, phir edit karo" without
        // the user having to show the plan first. The failed attempt is rolled
        // back before re-running so the corrected batch never double-applies;
        // if the model gives up, the partial mutations are kept so the summary
        // below matches the real state.
        let toolResult: ChatToolResult | null = null;
        for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
          const preRun = this.store?.get();
          toolResult = await this.tools.runMany(actions);
          const postRun = this.store?.get();
          const missing = toolResult.missingTaskIdDays ?? [];
          const canReplan = missing.length > 0 && !toolResult.requiresConfirmation && this.store !== null && preRun !== undefined && postRun !== undefined;
          if (!canReplan) break;
          onStatus?.('Pehle plan fetch kar raha hai…');
          const plans = this.tools.renderPlans(missing);
          const replan = await this.llm.complete(this.buildReplanRequest(session, plans, toolResult.summary, signal));
          const next = this.tools.parseTools(replan.text);
          if (next.length === 0) {
            this.store!.save(postRun);
            break;
          }
          this.store!.save(preRun);
          actions = next;
        }
        if (!toolResult) throw new Error('Tool execution failed');
        onStatus?.('Jawab likh raha hai…');
        let reasoning = '';
        const streamSani = createStreamSanitizer();
        const summaryRequest = this.buildSummaryRequest(session, toolResult.summary, (delta) => {
          const clean = streamSani.push(delta);
          if (clean) {
            partial += clean;
            onDelta?.(clean);
          }
        }, signal, (delta) => {
          reasoning += delta;
          onReasoningDelta?.(delta);
        });
        const summary = await this.llm.stream(summaryRequest);
        if (!summary.text && !summary.reasoning) {
          throw new Error('AI ka reply khaali aaya — max tokens barhao ya thinking off karo.');
        }
        const assistant: ChatMessage = {
          id: uid(),
          role: 'assistant',
          content: sanitizeTimestampLeaks(summary.text),
          createdAt: this.clock.now().toISOString(),
          model: summary.model,
          reasoning: (summary.reasoning ?? reasoning) || undefined,
          tool: actions.map((a) => a.action).join(','),
        };
        this.appendAssistant(session, assistant);
        return assistant;
      }

      // Default streaming path.
      let reasoning = '';
      const streamSani = createStreamSanitizer();
      const request = this.buildRequest(session, (delta) => {
        const clean = streamSani.push(delta);
        if (clean) {
          partial += clean;
          onDelta?.(clean);
        }
      }, signal, (delta) => {
        reasoning += delta;
        onReasoningDelta?.(delta);
      });
      const resp = await this.llm.stream(request);
      if (!resp.text && !resp.reasoning) {
        throw new Error('AI ka reply khaali aaya — max tokens barhao ya thinking off karo.');
      }
      const assistant: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: sanitizeTimestampLeaks(resp.text),
        createdAt: this.clock.now().toISOString(),
        model: resp.model,
        reasoning: (resp.reasoning ?? reasoning) || undefined,
      };
      this.appendAssistant(session, assistant);
      return assistant;
    } catch (err) {
      if (isAbortError(err)) {
        if (partial) {
          const assistant: ChatMessage = {
            id: uid(),
            role: 'assistant',
            content: partial,
            createdAt: this.clock.now().toISOString(),
            model: undefined,
            stopped: true,
          };
          this.appendAssistant(session, assistant);
          return assistant;
        }
        session.messages.pop();
        if (titleWasEmpty) session.title = '';
        this.persist();
        throw err;
      }
      session.messages.pop();
      if (titleWasEmpty) session.title = '';
      this.persist();
      throw err;
    }
  }

  private buildDecisionRequest(session: ChatSession, signal?: AbortSignal): LLMRequest {
    const request: LLMRequest = {
      messages: this.buildMessages(session, CHAT_TOOL_INSTRUCTIONS),
      temperature: session.prefs.temperature,
      maxTokens: 500,
      providerId: session.prefs.providerId,
      signal,
      // Decision hops must be fast, deterministic JSON — thinking only risks
      // a budget clash and prose contamination.
      thinking: 'off',
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    return request;
  }

  private buildRetryRequest(session: ChatSession, previousReply: string, signal?: AbortSignal): LLMRequest {
    const system =
      `${CHAT_TOOL_INSTRUCTIONS}\n\n${CHAT_TOOL_RETRY}\n\n` +
      `Your previous reply was:\n${previousReply}\n\nReplace it with exactly one JSON object now.`;
    const request: LLMRequest = {
      messages: this.buildMessages(session, system),
      temperature: session.prefs.temperature,
      maxTokens: 500,
      providerId: session.prefs.providerId,
      signal,
      thinking: 'off',
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    return request;
  }

  /**
   * Decision-hop follow-up after a task-id action failed: shows the day's real
   * plan (with task ids) and asks the model to re-emit the corrected JSON.
   */
  private buildReplanRequest(session: ChatSession, plans: string, failure: string, signal?: AbortSignal): LLMRequest {
    const system =
      `${CHAT_TOOL_INSTRUCTIONS}\n\n` +
      `Your previous tool call failed because the task id was NOT in that day's plan.\n` +
      `Below is the affected day's exact plan with REAL task ids (format "id:<taskId>").\n` +
      `Re-emit your ENTIRE reply as exactly one JSON object (or an actions array) using a VALID task id from the plan. ` +
      `Do NOT explain, refuse or apologize — just the corrected JSON.`;
    const messages = this.buildMessages(session, system);
    messages.push({ role: 'user', content: `Previous tool result:\n${failure}\n\nPlan with task ids:\n${plans}` });
    const request: LLMRequest = {
      messages,
      temperature: session.prefs.temperature,
      maxTokens: 500,
      providerId: session.prefs.providerId,
      signal,
      thinking: 'off',
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    return request;
  }

  private buildSummaryRequest(
    session: ChatSession,
    toolSummary: string,
    onDelta: ((d: string) => void) | undefined,
    signal?: AbortSignal,
    onReasoningDelta?: (d: string) => void,
  ): LLMRequest {
    const system =
      `A plan tool executed and returned:\n${toolSummary}\n\n` +
      `Reply to the user's request in concise Hinglish. Tell them what was done (or why it failed).`;
    const request: LLMRequest = {
      messages: this.buildMessages(session, system),
      temperature: session.prefs.temperature,
      maxTokens: Math.max(1, Math.min(session.prefs.maxTokens ?? 4096, 8192)),
      providerId: session.prefs.providerId,
      onDelta,
      onReasoningDelta,
      signal,
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    const thinking = this.resolveThinking(session);
    if (thinking) request.thinking = thinking;
    return request;
  }

  private buildMessages(session: ChatSession, extraSystemPrompt = ''): LLMMessage[] {
    const messages: LLMMessage[] = [{ role: 'system', content: composeSystemPrompt(session.prefs.systemPrompt, extraSystemPrompt) }];
    if (session.prefs.includeContext) {
      const ctx = this.contextProvider();
      if (ctx) messages.push({ role: 'system', content: `Today's Human OS context: ${ctx}` });
    }
    const mem = this.recall(session.id);
    if (mem) messages.push({ role: 'system', content: `Earlier conversations yaad hain (bas reference lo, repeat mat karo):\n${mem}` });
    const history = session.messages.slice(-HISTORY_FOR_PROMPT).map((m): LLMMessage => ({
      role: m.role,
      content: `${formatMsgTime(m.createdAt)} ${m.content}`,
    }));
    messages.push(...history);
    return messages;
  }

  private resolveModel(session: ChatSession): string | undefined {
    if (session.prefs.providerId) {
      const config = this.settings.getProviderById(session.prefs.providerId);
      if (config) return session.prefs.model ?? config.model ?? undefined;
    }
    return session.prefs.model ?? undefined;
  }

  /** Chat preference wins; otherwise the provider's configured thinking level. */
  private resolveThinking(session: ChatSession): ThinkingLevel | undefined {
    if (session.prefs.thinking) return session.prefs.thinking;
    const provider = session.prefs.providerId
      ? this.settings.getProviderById(session.prefs.providerId)
      : this.settings.getActiveProvider();
    return provider?.thinking;
  }

  private buildRequest(
    session: ChatSession,
    onDelta: ((d: string) => void) | undefined,
    signal?: AbortSignal,
    onReasoningDelta?: (d: string) => void,
  ): LLMRequest {
    const request: LLMRequest = {
      messages: this.buildMessages(session),
      temperature: session.prefs.temperature,
      maxTokens: Math.max(1, Math.min(session.prefs.maxTokens ?? 4096, 8192)),
      providerId: session.prefs.providerId,
      onDelta,
      onReasoningDelta,
      signal,
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    const thinking = this.resolveThinking(session);
    if (thinking) request.thinking = thinking;
    return request;
  }

  private appendAssistant(session: ChatSession, assistant: ChatMessage): void {
    session.messages.push(assistant);
    const overflow = session.messages.length - MAX_MESSAGES_PER_SESSION;
    if (overflow > 0) session.messages.splice(0, overflow);
    session.updatedAt = this.clock.now().toISOString();
    this.persist();
    this.remember(assistant.content, 'ai', session.id);
  }

  /** Persists a chat exchange into AI memory so later conversations recall it. */
  private remember(content: string, source: 'user' | 'ai', sessionId: string): void {
    if (!this.memory || !this.store) return;
    const cleaned = stripAttachmentBlocks(content).trim();
    if (!cleaned) return;
    const state = this.store.get();
    const next = this.memory.add(state, {
      type: 'conversation',
      source,
      content: cleaned.slice(0, source === 'user' ? MEMORY_USER_MAX_CHARS : MEMORY_AI_MAX_CHARS),
      importance: source === 'user' ? 0.5 : 0.4,
      tags: ['chat', sessionId],
    });
    this.store.save(next);
  }

  /** Recent memories from OTHER sessions, so history stays in the transcript. */
  private recall(sessionId: string): string {
    if (!this.memory || !this.store) return '';
    const state = this.store.get();
    const recent = this.memory.relevant(state, { max: 12 });
    const lines = recent
      .filter((e) => e.context.tags.includes('chat') && !e.context.tags.includes(sessionId))
      .slice(0, MEMORY_FOR_PROMPT)
      .map((e) => `- ${e.source === 'user' ? '[user] ' : '[ai] '}${truncateMemory(e.content)}`);
    return lines.join('\n');
  }

  private persist(): void {
    this.repo.save(this.state());
  }
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    prefs: { ...defaultChatPrefs(), ...session.prefs },
    messages: session.messages.map((message) => ({ ...message })),
  };
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

/** Local clock time of a message, e.g. "[05:42 PM]". Lets the model know when each message was sent. */
function formatMsgTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '[time unknown]';
    return `[${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}]`;
  } catch {
    return '[time unknown]';
  }
}

function composeSystemPrompt(userPersona: string, extraSystemPrompt = ''): string {
  const blocks = [INTERNAL_SYSTEM_PROMPT];
  const persona = userPersona.trim();
  if (persona) blocks.push(`User-editable persona / custom instructions:\n${persona}`);
  const extra = extraSystemPrompt.trim();
  if (extra) blocks.push(extra);
  return blocks.join('\n\n');
}

function stripAttachmentBlocks(text: string): string {
  return text
    .replace(/<attached_file>[\s\S]*?<\/attached_file>/g, '')
    .replace(/<attached_image>[\s\S]*?<\/attached_image>/g, '')
    .trim();
}

function truncateMemory(s: string, max = 300): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

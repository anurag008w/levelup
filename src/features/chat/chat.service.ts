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
import type { Clock } from '../../core/ports/clock';
import type { ChatRepository } from '../../core/ports/repositories';
import type { LLMService } from '../ai/llm.service';
import type { ProviderSettingsService } from '../ai/provider-settings.service';
import type { ChatToolsService } from './chat-tools.service';

const HISTORY_FOR_PROMPT = 30;

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
  /** In-memory snapshot so mutations survive across persist() calls. */
  private cache: ChatStoreState | null = null;

  constructor(
    repo: ChatRepository,
    llm: LLMService,
    settings: ProviderSettingsService,
    contextProvider: () => string,
    clock: Clock,
    tools: ChatToolsService | null = null,
  ) {
    this.repo = repo;
    this.llm = llm;
    this.settings = settings;
    this.contextProvider = contextProvider;
    this.clock = clock;
    this.tools = tools;
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

    let partial = '';

    try {
      // Tool decision hop for plan/task queries.
      if (this.tools && this.tools.isTaskQuery(text)) {
        onStatus?.('AI soch raha hai…');
        const decision = await this.llm.complete(this.buildDecisionRequest(session, signal));
        let action = this.tools.parseTool(decision.text);
        let answer = decision.text;
        if (!action && answer) {
          // The model talked instead of emitting an action — retry once with a
          // strict correction so plan tools work even on weaker models.
          onStatus?.('Tool decision retry kar raha hai…');
          const retry = await this.llm.complete(this.buildRetryRequest(session, decision.text, signal));
          action = this.tools.parseTool(retry.text);
          if (retry.text) answer = retry.text;
        }
        if (!action) {
          if (answer) {
            const assistant: ChatMessage = {
              id: uid(),
              role: 'assistant',
              content: answer,
              createdAt: this.clock.now().toISOString(),
              model: decision.model,
            };
            this.appendAssistant(session, assistant);
            return assistant;
          }
          throw new Error('AI khaali reply diya');
        }
        onStatus?.(`Tool chala raha hai: ${action.action}`);
        const toolResult = await this.tools.run(action);
        onStatus?.('Jawab likh raha hai…');
        let reasoning = '';
        const summaryRequest = this.buildSummaryRequest(session, toolResult.summary, (delta) => {
          partial += delta;
          onDelta?.(delta);
        }, signal, (delta) => {
          reasoning += delta;
          onReasoningDelta?.(delta);
        });
        const summary = await this.llm.stream(summaryRequest);
        const assistant: ChatMessage = {
          id: uid(),
          role: 'assistant',
          content: summary.text,
          createdAt: this.clock.now().toISOString(),
          model: summary.model,
          reasoning: (summary.reasoning ?? reasoning) || undefined,
          tool: action.action,
        };
        this.appendAssistant(session, assistant);
        return assistant;
      }

      // Default streaming path.
      let reasoning = '';
      const request = this.buildRequest(session, (delta) => {
        partial += delta;
        onDelta?.(delta);
      }, signal, (delta) => {
        reasoning += delta;
        onReasoningDelta?.(delta);
      });
      const resp = await this.llm.stream(request);
      const assistant: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: resp.text,
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
      maxTokens: Math.max(1, Math.min(session.prefs.maxTokens ?? 2048, 8192)),
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
    const history = session.messages.slice(-HISTORY_FOR_PROMPT).map((m): LLMMessage => ({ role: m.role, content: m.content }));
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
      maxTokens: Math.max(1, Math.min(session.prefs.maxTokens ?? 2048, 8192)),
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

function composeSystemPrompt(userPersona: string, extraSystemPrompt = ''): string {
  const blocks = [INTERNAL_SYSTEM_PROMPT];
  const persona = userPersona.trim();
  if (persona) blocks.push(`User-editable persona / custom instructions:\n${persona}`);
  const extra = extraSystemPrompt.trim();
  if (extra) blocks.push(extra);
  return blocks.join('\n\n');
}

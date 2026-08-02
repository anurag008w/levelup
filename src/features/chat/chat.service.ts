import { DEFAULT_USER_PERSONA, INTERNAL_SYSTEM_PROMPT } from '../../core/domain/chat';
import type { ChatMessage, ChatSession, ChatPreferences, ChatStoreState, ChatAttachment, GlobalChatPrefs } from '../../core/domain/chat';
import {
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSIONS,
  applyGlobalChatPrefs,
  defaultChatPrefs,
} from '../../core/domain/chat';
import type { LLMMessage, LLMRequest, LLMResponse, ThinkingLevel, ContentPart } from '../../core/domain/llm';
import { isAbortError } from '../../core/domain/llm';
import { CHAT_TOOL_INSTRUCTIONS, CHAT_TOOL_RETRY } from '../../core/domain/chat-tools';
import type { ChatToolResult } from '../../core/domain/chat-tools';
import { createStreamSanitizer, sanitizeAssistantLeaks } from './leak-sanitizer';
import type { Clock } from '../../core/ports/clock';
import type { ChatRepository, StateStore } from '../../core/ports/repositories';
import type { LLMService } from '../ai/llm.service';
import type { ProviderSettingsService } from '../ai/provider-settings.service';
import type { MemoryService } from '../ai/memory.service';
import type { ChatToolsService } from './chat-tools.service';
import type { MemoryToolsService } from './memory-tools.service';
import { MEMORY_TOOL_INSTRUCTIONS } from '../../core/domain/memory-tools';
import type { MemoryToolResult } from '../../core/domain/memory-tools';

const HISTORY_FOR_PROMPT = 30;
const MEMORY_FOR_PROMPT = 8;
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
  private readonly memoryTools: MemoryToolsService | null;
  private readonly store: StateStore | null;
  /** Lazily extracts text from a raw file (blob URL) when the direct file path fails. */
  private readonly extractAttachmentText?: (blobUrl: string, name: string) => Promise<string>;
  /** Sessions where a direct file send already fell back to text — use text from now on. */
  private readonly fileFallbackSessions = new Set<string>();
  /** In-memory snapshot so mutations survive across persist() calls. */
  private cache: ChatStoreState | null = null;
  /** Sessions created while "auto-save chats" is off — never written to disk. */
  private ephemeral = new Map<string, ChatSession>();
  /** In-flight transcript persistence awaited by the next send (first reply). */
  private pendingSummary: Promise<number> | null = null;

  constructor(
    repo: ChatRepository,
    llm: LLMService,
    settings: ProviderSettingsService,
    contextProvider: () => string,
    clock: Clock,
    tools: ChatToolsService | null = null,
    memory: MemoryService | null = null,
    store: StateStore | null = null,
    extractAttachmentText?: (blobUrl: string, name: string) => Promise<string>,
    memoryTools: MemoryToolsService | null = null,
  ) {
    this.repo = repo;
    this.llm = llm;
    this.settings = settings;
    this.contextProvider = contextProvider;
    this.clock = clock;
    this.tools = tools;
    this.memory = memory;
    this.store = store;
    this.extractAttachmentText = extractAttachmentText;
    this.memoryTools = memoryTools;
  }

  private state(): ChatStoreState {
    if (this.cache === null) this.cache = this.repo.load();
    return this.cache;
  }

  listSessions(): ChatSession[] {
    return this.state().sessions.map(cloneSession).concat(Array.from(this.ephemeral.values()).map(cloneSession));
  }

  getSession(id: string): ChatSession | null {
    return this.state().sessions.find((s) => s.id === id) ?? this.ephemeral.get(id) ?? null;
  }

  createSession(title = '', prefs: ChatPreferences = defaultChatPrefs()): ChatSession {
    const now = this.clock.now().toISOString();
    const session: ChatSession = {
      id: uid(),
      title,
      messages: [],
      prefs: normalizePrefs(prefs),
      createdAt: now,
      updatedAt: now,
    };
    // "Auto-save chats" off → keep the session ephemeral (still usable for the
    // current chat, but it never lands in history and is gone after reload).
    if (this.autoSaveChats()) {
      const state = this.state();
      state.sessions.unshift(session);
      if (state.sessions.length > MAX_SESSIONS) state.sessions.length = MAX_SESSIONS;
      this.repo.save(state);
    } else {
      if (this.ephemeral.size >= MAX_SESSIONS) {
        const oldest = Array.from(this.ephemeral.keys())[0];
        if (oldest) this.ephemeral.delete(oldest);
      }
      this.ephemeral.set(session.id, session);
    }
    return session;
  }

  deleteSession(id: string): void {
    const state = this.state();
    state.sessions = state.sessions.filter((s) => s.id !== id);
    this.repo.save(state);
    this.ephemeral.delete(id);
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
   * Applies the global chat settings (temperature, max tokens, personas,
   * journey-context flag) to every session's prefs. Session-only fields such
   * as providerId, model and thinking are left untouched. Keeps the Settings
   * tab and the AI Coach in sync.
   */
  applyGlobalPrefs(global: GlobalChatPrefs): void {
    const state = this.state();
    const applyTo = (session: ChatSession): ChatSession => {
      session.prefs = applyGlobalChatPrefs(normalizePrefs(session.prefs), global);
      session.updatedAt = this.clock.now().toISOString();
      return session;
    };
    let touched = false;
    for (const session of state.sessions) {
      applyTo(session);
      touched = true;
    }
    if (this.ephemeral.size > 0) {
      for (const session of this.ephemeral.values()) applyTo(session);
      touched = true;
    }
    if (touched) this.persist();
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
    attachments?: ChatAttachment[],
  ): Promise<ChatMessage> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Chat session not found');

    // When a fresh chat was just created, prior conversations are being
    // condensed into memory — let that finish so this reply can use it.
    if (this.pendingSummary) {
      const pending = this.pendingSummary;
      this.pendingSummary = null;
      await pending;
    }

    const now = this.clock.now().toISOString();
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, createdAt: now, attachments };
    session.messages.push(userMsg);
    const titleWasEmpty = session.title.length === 0;
    if (titleWasEmpty) session.title = deriveTitle(text);
    session.updatedAt = now;
    this.persist();

    let partial = '';

    try {
      // Memory tool decision hop — the AI can read/edit/delete/pin its memory
      // on command ("memory mein kya hai", "ye delete karo", "yaad rakho").
      // Skipped entirely when AI memory is turned off in settings.
      if (this.memoryTools && this.memoryEnabled() && this.memoryTools.isMemoryQuery(text)) {
        onStatus?.('AI memory soch raha hai…');
        const decision = await this.llm.complete(await this.buildMemoryDecisionRequest(session, signal));
        let actions = this.memoryTools.parseTools(decision.text);
        let answer = decision.text;
        if (actions.length === 0 && answer) {
          onStatus?.('Memory tool retry kar raha hai…');
          const retry = await this.llm.complete(await this.buildMemoryDecisionRequest(session, signal, decision.text));
          actions = this.memoryTools.parseTools(retry.text);
          if (retry.text) answer = retry.text;
        }
        if (actions.length === 0) {
          if (answer) {
            const assistant: ChatMessage = {
              id: uid(),
              role: 'assistant',
              content: sanitizeAssistantLeaks(answer),
              createdAt: this.clock.now().toISOString(),
              model: decision.model,
            };
            this.appendAssistant(session, assistant);
            return assistant;
          }
          throw new Error('AI memory ka jawab nahi de paya — simple language mein pucho.');
        }
        onStatus?.('Memory update kar raha hai…');
        const memoryResult: MemoryToolResult = await this.memoryTools.runMany(actions);
        // Destructive actions need one explicit confirmation round.
        if (memoryResult.requiresConfirmation) {
          const confirm = await this.llm.complete(await this.buildMemoryConfirmRequest(session, memoryResult.summary, signal));
          const confirmedActions = this.memoryTools.parseTools(confirm.text);
          if (confirmedActions.length > 0) {
            const confirmed = await this.memoryTools.runMany(confirmedActions);
            memoryResult.summary = confirmed.summary || memoryResult.summary;
          }
        }
        const memoryAssistant: ChatMessage = {
          id: uid(),
          role: 'assistant',
          content: sanitizeAssistantLeaks(memoryResult.summary),
          createdAt: this.clock.now().toISOString(),
          model: decision.model,
        };
        this.appendAssistant(session, memoryAssistant);
        return memoryAssistant;
      }

      // Tool decision hop for plan/task queries.
      if (this.tools && this.tools.isTaskQuery(text)) {
        onStatus?.('AI soch raha hai…');
        const decision = await this.llm.complete(await this.buildDecisionRequest(session, signal));
        let actions = this.tools.parseTools(decision.text);
        let answer = decision.text;
        if (actions.length === 0 && answer) {
          // The model talked instead of emitting an action — retry once with a
          // strict correction so plan tools work even on weaker models.
          onStatus?.('Tool decision retry kar raha hai…');
          const retry = await this.llm.complete(await this.buildRetryRequest(session, decision.text, signal));
          actions = this.tools.parseTools(retry.text);
          if (retry.text) answer = retry.text;
        }
        if (actions.length === 0) {
          if (answer) {
            const assistant: ChatMessage = {
              id: uid(),
              role: 'assistant',
              content: sanitizeAssistantLeaks(answer),
              createdAt: this.clock.now().toISOString(),
              model: decision.model,
            };
            this.appendAssistant(session, assistant);
            return assistant;
          }
          throw new Error('AI ne JSON nahi diya — API key + model check karo, ya simple language mein pucho.');
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
          const replan = await this.llm.complete(await this.buildReplanRequest(session, plans, toolResult.summary, signal));
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
        const summaryRequest = await this.buildSummaryRequest(session, toolResult.summary, (delta) => {
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
        // Release any trailing chunk the sanitizer held back as a possible
        // partial timestamp — otherwise the streamed tail is silently dropped.
        const streamTail = streamSani.flush();
        if (streamTail) {
          partial += streamTail;
          onDelta?.(streamTail);
        }
        if (!summary.text && !summary.reasoning) {
          throw new Error('AI ka reply khaali aaya — max tokens barhao ya thinking off karo.');
        }
        const assistant: ChatMessage = {
          id: uid(),
          role: 'assistant',
          content: sanitizeAssistantLeaks(summary.text),
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
      const runStream = async (): Promise<LLMResponse> => {
        const streamSani = createStreamSanitizer();
        const request = await this.buildRequest(session, (delta) => {
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
        // Release any trailing chunk the sanitizer held back as a possible
        // partial timestamp — otherwise the streamed tail is silently dropped.
        const streamTail = streamSani.flush();
        if (streamTail) {
          partial += streamTail;
          onDelta?.(streamTail);
        }
        return resp;
      };
      let resp: LLMResponse;
      try {
        resp = await runStream();
      } catch (err) {
        // User aborts must propagate as-is — no fallback retry on cancel.
        if (isAbortError(err)) throw err;
        // The direct file send can fail when the model doesn't accept files or
        // is down/rate-limited. Fall back to client-extracted text once.
        const fellBack = await this.applyFileFallback(session);
        if (!fellBack) throw err;
        onStatus?.('File extract karke dobara try kar raha hoon…');
        resp = await runStream();
      }
      if (!resp.text && !resp.reasoning) {
        throw new Error('AI ka reply khaali aaya — max tokens barhao ya thinking off karo.');
      }
      const assistant: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: sanitizeAssistantLeaks(resp.text),
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
            content: sanitizeAssistantLeaks(partial),
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

  private async buildDecisionRequest(session: ChatSession, signal?: AbortSignal): Promise<LLMRequest> {
    const request: LLMRequest = {
      messages: await this.buildMessages(session, CHAT_TOOL_INSTRUCTIONS),
      temperature: session.prefs.temperature,
      maxTokens: 1024,
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

  private async buildMemoryDecisionRequest(session: ChatSession, signal?: AbortSignal, previousReply?: string): Promise<LLMRequest> {
    const extra = previousReply
      ? `\n\nYour previous reply was:\n${previousReply}\n\nThat was not a valid action. Reply with exactly ONE JSON object from the list above now.`
      : '';
    const system = `${MEMORY_TOOL_INSTRUCTIONS}\n\nRead the student's question above and decide the single best action.${extra}`;
    const request: LLMRequest = {
      messages: await this.buildMessages(session, system),
      temperature: session.prefs.temperature,
      maxTokens: 1024,
      providerId: session.prefs.providerId,
      signal,
      thinking: 'off',
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    return request;
  }

  /** Confirmation follow-up after a destructive memory action preview. */
  private async buildMemoryConfirmRequest(session: ChatSession, preview: string, signal?: AbortSignal): Promise<LLMRequest> {
    const system =
      `${MEMORY_TOOL_INSTRUCTIONS}\n\n` +
      `The user is being asked to confirm a memory deletion.\n` +
      `Tool preview:\n${preview}\n\n` +
      `If the user agreed, re-emit the exact same action with "confirmed":true. Otherwise reply with no JSON and explain in Hinglish.`;
    const request: LLMRequest = {
      messages: await this.buildMessages(session, system),
      temperature: session.prefs.temperature,
      maxTokens: 1024,
      providerId: session.prefs.providerId,
      signal,
      thinking: 'off',
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    return request;
  }

  private async buildRetryRequest(session: ChatSession, previousReply: string, signal?: AbortSignal): Promise<LLMRequest> {
    const system =
      `${CHAT_TOOL_INSTRUCTIONS}\n\n${CHAT_TOOL_RETRY}\n\n` +
      `Your previous reply was:\n${previousReply}\n\nReplace it with exactly one JSON object now.`;
    const request: LLMRequest = {
      messages: await this.buildMessages(session, system),
      temperature: session.prefs.temperature,
      maxTokens: 1024,
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
  private async buildReplanRequest(session: ChatSession, plans: string, failure: string, signal?: AbortSignal): Promise<LLMRequest> {
    const system =
      `${CHAT_TOOL_INSTRUCTIONS}\n\n` +
      `Your previous tool call failed because the task id was NOT in that day's plan.\n` +
      `Below is the affected day's exact plan with REAL task ids (format "id:<taskId>").\n` +
      `Re-emit your ENTIRE reply as exactly one JSON object (or an actions array) using a VALID task id from the plan. ` +
      `Do NOT explain, refuse or apologize — just the corrected JSON.`;
    const messages = await this.buildMessages(session, system);
    messages.push({ role: 'user', content: `Previous tool result:\n${failure}\n\nPlan with task ids:\n${plans}` });
    const request: LLMRequest = {
      messages,
      temperature: session.prefs.temperature,
      maxTokens: 1024,
      providerId: session.prefs.providerId,
      signal,
      thinking: 'off',
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    return request;
  }

  private async buildSummaryRequest(
    session: ChatSession,
    toolSummary: string,
    onDelta: ((d: string) => void) | undefined,
    signal?: AbortSignal,
    onReasoningDelta?: (d: string) => void,
  ): Promise<LLMRequest> {
    const system =
      `A plan tool executed and returned:\n${toolSummary}\n\n` +
      `Reply to the user's request in concise Hinglish. Tell them what was done (or why it failed).`;
    const thinking = this.resolveThinking(session);
    const request: LLMRequest = {
      messages: await this.buildMessages(session, system),
      temperature: session.prefs.temperature,
      maxTokens: this.effectiveMaxTokens(session, thinking),
      providerId: session.prefs.providerId,
      onDelta,
      onReasoningDelta,
      signal,
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    if (thinking) request.thinking = thinking;
    return request;
  }

  private async buildMessages(session: ChatSession, extraSystemPrompt = ''): Promise<LLMMessage[]> {
    const prefs = normalizePrefs(session.prefs);
    const messages: LLMMessage[] = [{ role: 'system', content: composeSystemPrompt(prefs.systemPrompt, prefs.userPersona, extraSystemPrompt) }];
    if (session.prefs.includeContext) {
      const ctx = this.contextProvider();
      if (ctx) messages.push({ role: 'system', content: `Today's LevelUp context: ${ctx}` });
    }
    if (this.memoryEnabled()) {
      const mem = this.recall(session.id);
      if (mem) messages.push({ role: 'system', content: `Earlier conversations yaad hain (bas reference lo, repeat mat karo):\n${mem}` });
    }

    const history: LLMMessage[] = [];
    for (const m of session.messages.slice(-this.historyLength())) {
      // If message has attachments, convert to ContentPart array
      if (m.attachments && m.attachments.length > 0) {
        const parts: ContentPart[] = [];
        if (m.content) parts.push({ type: 'text', text: `${formatMsgTime(m.createdAt)} ${m.content}` });
        for (const att of m.attachments) {
          if (att.kind === 'image' && att.previewUrl) {
            // Convert blob URL to data URL for LLM
            const dataUrl = await this.blobToDataUrl(att.previewUrl);
            if (dataUrl) {
              parts.push({ type: 'image', image: dataUrl });
            }
          } else if (att.kind === 'file' && att.previewUrl) {
            if (this.fileFallbackSessions.has(session.id)) {
              // Direct file send already failed for this session — use extracted text.
              const text = await this.extractAttachmentText?.(att.previewUrl, att.name);
              if (text) parts.push({ type: 'text', text: `\n[Attached file: ${att.name}]\n${text}` });
            } else {
              const dataUrl = await this.blobToDataUrl(att.previewUrl);
              if (dataUrl) {
                parts.push({ type: 'file', file: { filename: att.name, file_data: dataUrl } });
              }
            }
          } else if (att.kind === 'text') {
            parts.push({ type: 'text', text: `\n[Attached file: ${att.name}]\n` });
          }
        }
        history.push({ role: m.role, content: parts });
      } else {
        history.push({
          role: m.role,
          content: `${formatMsgTime(m.createdAt)} ${m.content}`,
        });
      }
    }
    messages.push(...history);
    return messages;
  }

  private async blobToDataUrl(blobUrl: string): Promise<string | null> {
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  /**
   * After a direct file send fails (model doesn't accept files, down, or
   * rate-limited), rewrites the last user message to inline the extracted text
   * and strips the raw file parts so the retry uses plain text. Returns true
   * when a retry with extracted content is possible.
   */
  private async applyFileFallback(session: ChatSession): Promise<boolean> {
    const last = session.messages[session.messages.length - 1];
    if (!last || last.role !== 'user') return false;
    const fileAtts = (last.attachments ?? []).filter((a) => a.kind === 'file');
    if (fileAtts.length === 0) return false;

    const blocks: string[] = [];
    let extractedAny = false;
    for (const att of fileAtts) {
      let text = att.content ?? '';
      if (!text && this.extractAttachmentText && att.previewUrl) {
        try {
          text = await this.extractAttachmentText(att.previewUrl, att.name);
        } catch {
          text = '';
        }
      }
      if (text.trim()) {
        extractedAny = true;
        blocks.push(`<attached_file>\nAttachment: ${att.name}\n\n${text.trim()}\n</attached_file>`);
      }
    }

    last.attachments = last.attachments!.filter((a) => a.kind !== 'file');
    if (extractedAny) {
      last.content = `${last.content}\n\n${blocks.join('\n\n')}`;
      this.fileFallbackSessions.add(session.id);
    }
    this.persist();
    return extractedAny;
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

  private async buildRequest(
    session: ChatSession,
    onDelta: ((d: string) => void) | undefined,
    signal?: AbortSignal,
    onReasoningDelta?: (d: string) => void,
  ): Promise<LLMRequest> {
    const thinking = this.resolveThinking(session);
    const request: LLMRequest = {
      messages: await this.buildMessages(session),
      temperature: session.prefs.temperature,
      maxTokens: this.effectiveMaxTokens(session, thinking),
      providerId: session.prefs.providerId,
      onDelta,
      onReasoningDelta,
      signal,
    };
    const model = this.resolveModel(session);
    if (model) request.model = model;
    if (thinking) request.thinking = thinking;
    return request;
  }

  /**
   * Reasoning models spend part of the max_tokens budget on the hidden chain
   * of thought, silently cutting the visible answer. When thinking is on,
   * reserve headroom by doubling the budget so the visible reply isn't
   * truncated mid-sentence. Capped at 32768 — the current top-of-the-line
   * output limits for Gemini 2.5 / Claude / GPT-5-class models.
   */
  private effectiveMaxTokens(session: ChatSession, thinking: string | null | undefined): number {
    const base = Math.max(1, Math.min(session.prefs.maxTokens ?? 8192, 32768));
    if (!thinking || thinking === 'off') return base;
    return Math.min(base * 2, 65536);
  }

  private appendAssistant(session: ChatSession, assistant: ChatMessage): void {
    session.messages.push(assistant);
    const overflow = session.messages.length - MAX_MESSAGES_PER_SESSION;
    if (overflow > 0) session.messages.splice(0, overflow);
    session.updatedAt = this.clock.now().toISOString();
    this.persist();
  }

  /**
   * Persists every finished chat into AI memory as its RAW transcript — both
   * the student's and the coach's words, verbatim, no AI condensation.
   * Triggered on every "new chat" action and on the memory panel's manual
   * button. Only sessions the app has NOT yet stored are processed (dedup by
   * `memorySummarizedAt`).
   *
   * Never fails as a whole: per-session errors are swallowed and the session
   * is left unmarked so the next run retries it instead of permanently
   * skipping it. Resolves to the number of sessions stored.
   */
  async summarizePriorChats(): Promise<number> {
    if (!this.store || !this.memory || !this.memoryEnabled()) return 0;
    if (this.pendingSummary) return this.pendingSummary;
    const targets = this.state().sessions.filter((s) => s.messages.length > 0 && !s.memorySummarizedAt);
    if (targets.length === 0) return 0;
    const task = (async () => {
      let done = 0;
      for (const session of targets) {
        try {
          await this.persistSessionToMemory(session);
          done += 1;
        } catch {
          // Leave memorySummarizedAt unset so the next run retries.
        }
      }
      this.pendingSummary = null;
      return done;
    })();
    this.pendingSummary = task;
    return task;
  }

  /** Number of finished chats not yet condensed into memory. */
  pendingSummaries(): number {
    if (!this.memoryEnabled()) return 0;
    return this.state().sessions.filter((s) => s.messages.length > 0 && !s.memorySummarizedAt).length;
  }

  /** Whether the global "AI Memory" setting is on (defaults to on). */
  private memoryEnabled(): boolean {
    const chat = this.store?.get().aiSettings.chat;
    return chat ? chat.memoryEnabled !== false : true;
  }

  /** Whether new chats should be persisted to history (defaults to on). */
  private autoSaveChats(): boolean {
    const chat = this.store?.get().aiSettings.chat;
    return chat ? chat.autoSaveChats !== false : true;
  }

  /** How many past messages to send to the model (global setting, 0 = none). */
  private historyLength(): number {
    const chat = this.store?.get().aiSettings.chat;
    const configured = chat?.conversationHistoryLength;
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      return Math.max(0, Math.floor(configured));
    }
    return HISTORY_FOR_PROMPT;
  }

  /** Dumps a finished chat's raw transcript into memory as one block. */
  private async persistSessionToMemory(session: ChatSession): Promise<void> {
    let memState = this.memory!.removeConversationByTag(this.store!.get(), session.id);
    const transcript = this.buildRawTranscript(session);
    memState = this.memory!.add(memState, {
      type: 'conversation',
      source: 'system',
      content: transcript,
      importance: 0.6,
      tags: ['chat', session.id],
      blockId: `chat:${session.id}`,
    });
    this.store!.save(memState);
    const target = this.state().sessions.find((s) => s.id === session.id);
    if (target) {
      target.memorySummarizedAt = this.clock.now().toISOString();
      this.persist();
    }
  }

  /** Both sides verbatim (Student / AI Coach lines), capped to a sane size. */
  private buildRawTranscript(session: ChatSession): string {
    try {
      const body = session.messages
        .map((m) => `${m.role === 'user' ? 'Student' : 'AI Coach'}: ${m.content}`)
        .join('\n');
      return body.length > 6000 ? `${body.slice(0, 6000)}…` : body;
    } catch {
      return 'Empty conversation.';
    }
  }

  /** Recent memories from OTHER sessions, so history stays in the transcript. */
  private recall(sessionId: string): string {
    if (!this.memory || !this.store) return '';
    const state = this.store.get();
    const all = [...state.memory.summaries, ...state.memory.entries]
      .filter((e) => e.context.tags.includes('chat') && !e.context.tags.includes(sessionId))
      .sort((a, b) => Number(Boolean(b.longTerm)) - Number(Boolean(a.longTerm)) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, MEMORY_FOR_PROMPT);
    return all.map((e) => `- ${e.longTerm ? '[long-term] ' : ''}${truncateMemory(e.content)}`).join('\n');
  }

  private persist(): void {
    this.repo.save(this.state());
  }
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    prefs: normalizePrefs(session.prefs),
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

function normalizePrefs(prefs: Partial<ChatPreferences>): ChatPreferences {
  const defaults = defaultChatPrefs();
  const merged = { ...defaults, ...prefs };

  // Sessions created before editable system persona used `systemPrompt` as the
  // user persona. Keep non-default custom text as user instructions, while new
  // sessions get Divya as the editable system persona and a blank user persona.
  const legacyDefault = 'Mere JEE coach bano. Hinglish mein concise, direct aur step-by-step samjhao. Maths ke answers LaTeX + short explanation ke saath do.';
  const legacySystemPrompt = prefs.systemPrompt;
  const isOldDivyaDefault =
    !!legacySystemPrompt &&
    legacySystemPrompt.startsWith('Tum Divya ho — LevelUp ki warm, sharp aur motivating girl JEE study coach.') &&
    legacySystemPrompt.includes('TIMESTAMP USER KO KABHI MAT DIKHAO');
  const hasLegacyUserPersona = prefs.userPersona === undefined && !!legacySystemPrompt && legacySystemPrompt !== INTERNAL_SYSTEM_PROMPT;
  if (hasLegacyUserPersona) {
    merged.systemPrompt = INTERNAL_SYSTEM_PROMPT;
    merged.userPersona = legacySystemPrompt === legacyDefault || isOldDivyaDefault ? DEFAULT_USER_PERSONA : legacySystemPrompt;
  }

  return merged;
}

function composeSystemPrompt(systemPersona: string, userPersona = '', extraSystemPrompt = ''): string {
  const blocks = [systemPersona.trim() || INTERNAL_SYSTEM_PROMPT];
  const persona = userPersona.trim();
  if (persona) blocks.push(`User persona / custom instructions:\n${persona}`);
  const extra = extraSystemPrompt.trim();
  if (extra) blocks.push(extra);
  return blocks.join('\n\n');
}

function truncateMemory(s: string, max = 300): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

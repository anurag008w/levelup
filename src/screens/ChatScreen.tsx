import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Eraser, MessageSquarePlus, Pause, Send, Settings2, User, Wrench, X } from 'lucide-react';
import type { ChatMessage, ChatPreferences, ChatSession } from '../core/domain/chat';
import { DEFAULT_SYSTEM_PROMPT } from '../core/domain/chat';
import type { ModelInfo } from '../core/domain/llm';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import EmptyState from '../components/ui/EmptyState';
import AddProviderForm from '../components/AddProviderForm';
import ChatMarkdown from '../components/ChatMarkdown';

export default function ChatScreen() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => container.chat.listSessions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const [providerCount, setProviderCount] = useState(container.providerSettings.listStoredProviders().length);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);
  const providers = useMemo(
    () => (void providerCount, container.providerSettings.listStoredProviders()),
    [providerCount],
  );

  useEffect(() => {
    if (!activeId && sessions.length > 0) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, streamText, streaming]);

  function refresh() {
    setSessions(container.chat.listSessions());
  }

  function newChat() {
    const session = container.chat.createSession();
    refresh();
    setActiveId(session.id);
    setDraft('');
    setError('');
  }

  function openSession(id: string) {
    setActiveId(id);
    setError('');
  }

  function removeSession(id: string) {
    container.chat.deleteSession(id);
    if (activeId === id) setActiveId(null);
    refresh();
  }

  function clearMessages() {
    if (active && confirm('Is chat ke saare messages delete karne hain?')) {
      container.chat.clearSession(active.id);
      refresh();
    }
  }

  function updatePrefs(patch: Partial<ChatPreferences>) {
    if (!active) return;
    const next = { ...active.prefs, ...patch };
    container.chat.updatePrefs(active.id, next);
    refresh();
  }

  async function loadCatalog() {
    if (!active?.prefs.providerId) return;
    const config = container.providerSettings.getProviderById(active.prefs.providerId);
    if (!config || config.hidden) return;
    try {
      setCatalog(await container.modelCache.getModels(config));
    } catch {
      setCatalog([]);
    }
  }

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.prefs.providerId]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming || !active) return;
    setError('');
    setDraft('');
    setStreaming(true);
    setStreamText('');
    setStreamReasoning('');
    setStatus('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await container.chat.send(
        active.id,
        text,
        (delta) => setStreamText((prev) => prev + delta),
        controller.signal,
        (s) => setStatus(s),
        (reasoning) => setStreamReasoning((prev) => prev + reasoning),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setStreamText('');
      setStreamReasoning('');
      setStatus('');
      refresh();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function keydown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const hasMessages = active !== null && active.messages.length > 0;
  const lastAssistantStreaming = streaming && streamText.length > 0;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 pb-28 pt-6 fade-up">
      <ScreenHeader
        eyebrow="HUMAN OS"
        title="AI Chat"
        subtitle="Apna JEE coach — plan, doubts aur motivation."
        right={
          <button onClick={newChat} className="btn btn-primary px-3 py-2 text-xs font-bold">
            <MessageSquarePlus size={14} />
            New
          </button>
        }
      />

      <p className="mb-3 rounded-lg border border-peak/20 bg-peak/5 px-3 py-2 text-[10px] leading-relaxed text-muted">
        Task add/remove/mark yahan se bhi kar sakte ho — jaise &quot;aaj ek 30min revision task add karo&quot; ya &quot;day 5 ka plan batao&quot;.
      </p>

      {sessions.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`chip shrink-0 cursor-pointer gap-1.5 py-1.5 pl-3 pr-2 transition-colors ${s.id === activeId ? '!text-text' : ''}`}
              style={s.id === activeId ? { borderColor: 'var(--color-l)', color: 'var(--color-text)' } : undefined}
              onClick={() => openSession(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openSession(s.id);
              }}
            >
              {s.title || 'Naya chat'}
              <button
                className="rounded-full p-0.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s.id);
                }}
                aria-label="Delete chat"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {active && (
        <button
          onClick={() => setShowOptions((v) => !v)}
          className="mb-3 flex w-full items-center justify-between rounded-xl border border-border bg-panel px-3.5 py-2.5 text-xs transition-colors hover:border-light"
        >
          <span className="flex items-center gap-1.5 font-semibold">
            <Settings2 size={14} color="var(--color-light)" />
            Chat Options
          </span>
          <span className="text-muted">{showOptions ? 'chhupao' : 'kholo'}</span>
        </button>
      )}

      {active && showOptions && (
        <OptionsPanel
          prefs={active.prefs}
          providers={providers}
          catalog={catalog}
          onChange={updatePrefs}
          onLoadCatalog={() => void loadCatalog()}
          onProviderAdded={() => setProviderCount((c) => c + 1)}
        />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-border bg-panel/40 px-3 py-3">
        {!active && (
          <EmptyState
            icon={<Bot size={28} color="var(--color-muted)" />}
            title="Naya chat shuru karo"
            hint="Provider configure karke apna JEE plan, concepts aur doubts discuss karo."
          />
        )}

        {active && !hasMessages && !streaming && (
          <EmptyState
            icon={<Bot size={28} color="var(--color-muted)" />}
            title="Aaj ka plan poochho"
            hint="Concept samjho, motivation lo ya plan discuss karo — sab Hinglish mein."
          />
        )}

        {active &&
          active.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

        {streaming && !lastAssistantStreaming && (
          <div className="mb-2 flex items-end gap-2">
            <Avatar role="assistant" />
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-l pulse-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-l pulse-dot" style={{ animationDelay: '0.2s' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-l pulse-dot" style={{ animationDelay: '0.4s' }} />
              {status && <span className="ml-1 text-[11px] text-muted">{status}</span>}
            </div>
          </div>
        )}

        {lastAssistantStreaming && (
          <div className="mb-2 flex items-end gap-2">
            <Avatar role="assistant" />
            <div className="max-w-[80%] rounded-xl border border-border bg-bg px-3 py-2.5">
              {streamReasoning && <ThinkingBlock text={streamReasoning} />}
              <div className="whitespace-pre-wrap text-sm text-text">
                {streamText}
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-light align-middle" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {active && (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keydown}
            placeholder="Message likho… (Enter = bhejo)"
            className="field max-h-32 flex-1 resize-none"
          />
          {streaming ? (
            <button
              onClick={stop}
              className="btn flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-panel"
              aria-label="Stop generating"
            >
              <Pause size={18} color="var(--color-light)" />
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={draft.trim().length === 0}
              className="btn flex h-10 w-10 shrink-0 items-center justify-center bg-l"
              aria-label="Send message"
            >
              <Send size={18} color="var(--color-bg)" />
            </button>
          )}
        </div>
      )}

      {active && (
        <button
          onClick={clearMessages}
          className="mx-auto mt-3 flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-text"
        >
          <Eraser size={12} />
          Chat clear karo
        </button>
      )}
    </div>
  );
}

function Avatar({ role }: { role: ChatMessage['role'] }) {
  const isUser = role === 'user';
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{
        backgroundColor: isUser ? 'rgba(242,166,90,0.15)' : 'rgba(178,146,242,0.15)',
        border: `1px solid ${isUser ? 'var(--color-light-dim)' : 'var(--color-peak)'}`,
      }}
    >
      {isUser ? <User size={13} color="var(--color-light)" /> : <Bot size={13} color="var(--color-peak)" />}
    </span>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-peak/20 bg-peak/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold text-muted transition-colors hover:text-text"
      >
        <span>AI soch raha hai ({text.length} chars)</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t border-peak/15 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          <ChatMarkdown text={text} />
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`mb-2 flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <Avatar role="assistant" />}
      <div
        className={`max-w-[80%] rounded-xl px-3 py-2.5 text-sm ${
          isUser
            ? 'border border-light/40 bg-panel text-text'
            : 'border border-border bg-bg text-text'
        }`}
      >
        {message.reasoning && <ThinkingBlock text={message.reasoning} />}
        {message.tool && (
          <span
            className="mb-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ borderColor: 'rgba(79,209,197,0.35)', backgroundColor: 'rgba(79,209,197,0.1)', color: 'var(--color-l)' }}
          >
            <Wrench size={10} />
            tool: {message.tool}
          </span>
        )}
        <div className={isUser ? '' : 'markdown-body'}>
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <ChatMarkdown text={message.content} />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {message.model && <span className="font-mono text-[9px] text-muted">{message.model}</span>}
          {message.stopped && (
            <span className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted">stopped</span>
          )}
          {message.role === 'assistant' && <Check size={10} color="var(--color-success)" />}
        </div>
      </div>
      {isUser && <Avatar role="user" />}
    </div>
  );
}

function OptionsPanel({
  prefs,
  providers,
  catalog,
  onChange,
  onLoadCatalog,
  onProviderAdded,
}: {
  prefs: ChatPreferences;
  providers: Array<{ id: string; label: string; enabled?: boolean }>;
  catalog: ModelInfo[];
  onChange: (patch: Partial<ChatPreferences>) => void;
  onLoadCatalog: () => void;
  onProviderAdded: () => void;
}) {
  return (
    <div className="mb-3 space-y-3 rounded-xl border border-border bg-panel p-3.5 text-xs fade-up">
      <div>
        <label className="mb-1 block font-semibold text-muted">Provider</label>
        <select
          className="field"
          value={prefs.providerId ?? ''}
          onChange={(e) => onChange({ providerId: e.target.value || null })}
        >
          <option value="">App default (active provider)</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.enabled === false ? ' (off)' : ''}
            </option>
          ))}
        </select>
        <AddProviderForm
          onAdd={() => {
            onProviderAdded();
          }}
        />
      </div>

      <div>
        <label className="mb-1 flex items-center justify-between font-semibold text-muted">
          <span>Model</span>
          <button onClick={onLoadCatalog} className="text-muted underline-offset-2 hover:text-text hover:underline">
            catalog dikhao
          </button>
        </label>
        <input
          list="chat-model-catalog"
          value={prefs.model ?? ''}
          onChange={(e) => onChange({ model: e.target.value || null })}
          placeholder="Khaali chhodo to provider default"
          className="field"
        />
        <datalist id="chat-model-catalog">
          {catalog.map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
      </div>

      <div>
        <label className="mb-1 flex items-center justify-between font-semibold text-muted">
          <span>Temperature</span>
          <span className="font-mono text-light">{prefs.temperature.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={prefs.temperature}
          onChange={(e) => onChange({ temperature: Number(e.target.value) })}
          className="w-full accent-[var(--color-light)]"
        />
        <p className="mt-0.5 text-[10px] text-muted">Kam = precise, zyada = creative</p>
      </div>

      <div>
        <label className="mb-1 block font-semibold text-muted">Persona / System prompt</label>
        <textarea
          rows={3}
          value={prefs.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          className="field resize-none"
        />
        <button
          onClick={() => onChange({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}
          className="mt-1 text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Default persona reset
        </button>
      </div>

      <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-2.5 py-2">
        <span className="font-semibold text-muted">Aaj ka context include karein</span>
        <label className="relative inline-flex cursor-pointer">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={prefs.includeContext}
            onChange={(e) => onChange({ includeContext: e.target.checked })}
          />
          <span className="h-5 w-9 rounded-full bg-grid transition-colors peer-checked:bg-[rgba(79,209,197,0.5)]" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-l" />
        </label>
      </label>
    </div>
  );
}

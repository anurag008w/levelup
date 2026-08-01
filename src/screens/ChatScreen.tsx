import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Download, Eraser, FileText, Image, MessageSquarePlus, Paperclip, Pause, Send, Settings2, Sigma, Sparkles, User, Wrench, X } from 'lucide-react';
import type { ChatMessage, ChatPreferences, ChatSession } from '../core/domain/chat';
import type { ThinkingLevel } from '../core/domain/llm';
import { DEFAULT_USER_PERSONA, INTERNAL_SYSTEM_PROMPT } from '../core/domain/chat';
import type { ModelInfo } from '../core/domain/llm';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import EmptyState from '../components/ui/EmptyState';
import AddProviderForm from '../components/AddProviderForm';
import ChatMarkdown from '../components/ChatMarkdown';

interface DraftAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: 'text' | 'image' | 'binary';
  content?: string;
  previewUrl?: string;
}

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'tex']);
const MAX_TEXT_ATTACHMENT_CHARS = 24_000;

export default function ChatScreen() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => container.chat.listSessions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const [providerCount, setProviderCount] = useState(container.providerSettings.listStoredProviders().length);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setAttachments([]);
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
    const text = buildPromptWithAttachments(draft.trim(), attachments);
    if (!text || streaming || !active) return;
    setError('');
    setDraft('');
    setAttachments([]);
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


  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError('');
    try {
      const next = await Promise.all(Array.from(files).map(readAttachment));
      setAttachments((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  function insertPromptTemplate(template: string) {
    setDraft((prev) => (prev.trim() ? `${prev.trim()}

${template}` : template));
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

      <div className="mb-3 rounded-2xl border border-peak/20 bg-gradient-to-br from-peak/10 via-panel to-l/5 p-3 text-[10px] leading-relaxed text-muted">
        <div className="mb-2 flex items-center gap-2 font-display text-sm font-bold text-text">
          <Sparkles size={15} color="var(--color-peak)" />
          Doubts, maths, files aur creations
        </div>
        <p>Task tools ke saath LaTeX maths, markdown notes, file uploads aur downloadable answers bhi supported hain.</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <QuickAction icon={<Sigma size={12} />} label="Math solve" onClick={() => insertPromptTemplate('Is maths problem ko step-by-step solve karo, fractions ko LaTeX me dikhao: \\(\\frac{2}{3} + 3\\times3\\)')} />
          <QuickAction icon={<FileText size={12} />} label="MD summary" onClick={() => insertPromptTemplate('Uploaded notes ko clean markdown summary + formula sheet me convert karo.')} />
          <QuickAction icon={<Download size={12} />} label="Canvas file" onClick={() => insertPromptTemplate('Is content se ek downloadable .md/.txt style file bana do, headings aur tables ke saath.')} />
        </div>
      </div>

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
            <div className="max-w-[90%] rounded-2xl border border-border bg-bg px-3 py-2.5 shadow-sm">
              {streamReasoning && <ThinkingBlock text={streamReasoning} />}
              <div className="markdown-body text-sm text-text">
                <ChatMarkdown text={streamText} />
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
        <div className="mt-3 rounded-2xl border border-border bg-panel p-2 shadow-lg shadow-black/10">
          {attachments.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-bg"
              aria-label="Attach files"
              title="Attach files like ChatGPT. Text/MD/code files are read into the prompt."
            >
              <Paperclip size={17} color="var(--color-light)" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.tex,.pdf,.ppt,.pptx,.doc,.docx,image/*"
              className="hidden"
              onChange={(e) => void attachFiles(e.target.files)}
            />
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={keydown}
              placeholder="Maths ya doubt likho… e.g. (2/3) + 3*3, ya file attach karo"
              className="field max-h-36 flex-1 resize-none border-0 bg-bg"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="btn flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-bg"
                aria-label="Stop generating"
              >
                <Pause size={18} color="var(--color-light)" />
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={draft.trim().length === 0 && attachments.length === 0}
                className="btn flex h-10 w-10 shrink-0 items-center justify-center bg-l disabled:opacity-40"
                aria-label="Send message"
              >
                <Send size={18} color="var(--color-bg)" />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-muted">Markdown/LaTeX supported: <span className="font-mono">\\frac&#123;2&#125;&#123;3&#125;</span>, tables, code blocks. Text/MD files AI ko content ke saath milte hain.</p>
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


function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1 rounded-lg border border-border bg-bg/70 px-2 py-1.5 font-semibold text-text transition-colors hover:border-l"
    >
      {icon}
      {label}
    </button>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: DraftAttachment; onRemove: () => void }) {
  const isImage = attachment.kind === 'image';
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl border border-border bg-bg px-2 py-1.5 text-[10px]">
      {isImage && attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt="" className="h-7 w-7 rounded-lg object-cover" />
      ) : isImage ? (
        <Image size={15} color="var(--color-light)" />
      ) : (
        <FileText size={15} color="var(--color-l)" />
      )}
      <div className="max-w-32 min-w-0">
        <p className="truncate font-semibold text-text">{attachment.name}</p>
        <p className="text-muted">{formatBytes(attachment.size)} · {attachment.kind}</p>
      </div>
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 text-muted hover:bg-danger/10 hover:text-danger" aria-label="Remove attachment">
        <X size={11} />
      </button>
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
        className={`max-w-[90%] rounded-2xl px-3 py-2.5 text-sm shadow-sm ${
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
          <ChatMarkdown text={message.content} />
        </div>
        <div className="mt-1 flex items-center gap-2">
          {message.model && <span className="font-mono text-[9px] text-muted">{message.model}</span>}
          {message.stopped && (
            <span className="rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted">stopped</span>
          )}
          {message.role === 'assistant' && (
            <>
              <Check size={10} color="var(--color-success)" />
              <button onClick={() => downloadMessage(message)} className="ml-auto inline-flex items-center gap-1 rounded bg-panel px-1.5 py-0.5 text-[9px] text-muted hover:text-text">
                <Download size={9} /> save .md
              </button>
            </>
          )}
        </div>
      </div>
      {isUser && <Avatar role="user" />}
    </div>
  );
}


async function readAttachment(file: File): Promise<DraftAttachment> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isText = file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension);
  if (isText) {
    const raw = await file.text();
    const truncated = raw.length > MAX_TEXT_ATTACHMENT_CHARS;
    return {
      id: uid('att'),
      name: file.name,
      type: file.type || extension || 'text',
      size: file.size,
      kind: 'text',
      content: truncated ? `${raw.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[Attachment truncated after ${MAX_TEXT_ATTACHMENT_CHARS} characters]` : raw,
    };
  }
  if (file.type.startsWith('image/')) {
    return { id: uid('att'), name: file.name, type: file.type, size: file.size, kind: 'image', previewUrl: URL.createObjectURL(file) };
  }
  return { id: uid('att'), name: file.name, type: file.type || extension || 'binary', size: file.size, kind: 'binary' };
}

function buildPromptWithAttachments(draft: string, attachments: DraftAttachment[]): string {
  if (attachments.length === 0) return draft;
  const blocks = attachments.map((a, idx) => {
    const header = `Attachment ${idx + 1}: ${a.name} (${a.type || 'unknown'}, ${formatBytes(a.size)})`;
    if (a.kind === 'text') return `<attached_file>\n${header}\n\n${a.content ?? ''}\n</attached_file>`;
    if (a.kind === 'image') return `<attached_image>\n${header}\nImage preview attached in UI. If your model cannot view images here, ask the user for text/OCR or describe what is needed.\n</attached_image>`;
    return `<attached_file>\n${header}\nBinary document uploaded. Ask for text export if exact contents are required.\n</attached_file>`;
  });
  return [draft || 'In uploaded attachments ko analyze karo.', ...blocks].join('\n\n');
}

function downloadMessage(message: ChatMessage) {
  const blob = new Blob([message.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `human-os-ai-${new Date(message.createdAt).toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampTokens(value: number): number {
  if (!Number.isFinite(value)) return 2048;
  return Math.max(1, Math.min(Math.round(value), 8192));
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
          onAdd={(config) => {
            container.providerSettings.upsertProvider(config);
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
        <label className="mb-1 flex items-center justify-between font-semibold text-muted">
          <span>Max tokens</span>
          <span className="font-mono text-light">{prefs.maxTokens ?? 2048}</span>
        </label>
        <input
          type="number"
          min={1}
          max={8192}
          step={128}
          value={prefs.maxTokens ?? 2048}
          onChange={(e) => onChange({ maxTokens: clampTokens(Number(e.target.value)) })}
          className="field"
        />
        <p className="mt-0.5 text-[10px] text-muted">Response budget; 1 se 8192 tokens tak.</p>
      </div>

      <div>
        <label className="mb-1 block font-semibold text-muted">Thinking / reasoning</label>
        <select
          className="field"
          value={prefs.thinking ?? ''}
          onChange={(e) => onChange({ thinking: (e.target.value || undefined) as ThinkingLevel | undefined })}
        >
          <option value="">Provider default</option>
          <option value="off">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div>
        <div className="mb-2 rounded-lg border border-border bg-bg px-2.5 py-2">
          <p className="mb-1 font-semibold text-muted">Internal system prompt</p>
          <p className="line-clamp-3 text-[10px] leading-relaxed text-muted">{INTERNAL_SYSTEM_PROMPT}</p>
          <p className="mt-1 text-[10px] text-light">Locked — app safety, tools, context aur attachment rules yahan se aate hain.</p>
        </div>
        <label className="mb-1 block font-semibold text-muted">Your persona / Custom instructions</label>
        <textarea
          rows={4}
          value={prefs.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          placeholder="e.g. Mujhe JEE maths step-by-step Hinglish mein samjhao; formulas LaTeX mein do."
          className="field resize-none"
        />
        <button
          onClick={() => onChange({ systemPrompt: DEFAULT_USER_PERSONA })}
          className="mt-1 text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Default user persona reset
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

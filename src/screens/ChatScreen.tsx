import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileText,
  Image,
  ImagePlus,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  PenLine,
  RefreshCw,
  Send,
  Settings2,
  Share,
  Sigma,
  Sparkles,
  StickyNote,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { ChatMessage, ChatPreferences, ChatSession } from '../core/domain/chat';
import type { ModelInfo, ThinkingLevel } from '../core/domain/llm';
import { DEFAULT_USER_PERSONA, INTERNAL_SYSTEM_PROMPT, defaultChatPrefs } from '../core/domain/chat';
import { container } from '../di/container';
import { redoLastAiAction, undoLastAiAction } from '../core/domain/ai-actions';
import ChatMarkdown from '../components/ChatMarkdown';
import FileCard from '../components/FileCard';
import AddProviderForm from '../components/AddProviderForm';
import { detectFileDoc, looksLikeMarkdown } from '../components/markdown-utils';
import { haptic, hapticError, hapticSuccess } from '../lib/haptics';
import { extractPdfText } from '../lib/pdf';

interface DraftAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: 'text' | 'image' | 'binary';
  content?: string;
  previewUrl?: string;
}

interface MenuState {
  message: ChatMessage;
  x: number;
  y: number;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
  'sh', 'bash', 'bat', 'ps1', 'sql', 'toml', 'ini', 'cfg', 'log', 'tex', 'env', 'properties',
]);
const MAX_TEXT_ATTACHMENT_CHARS = 24_000;
const VISIBLE_MESSAGES = 40;

const MATH_TEMPLATE =
  'Is maths problem ko step-by-step solve karo, LaTeX me dikhao: \\(\\frac{2}{3} + 3\\times3\\)';
const MD_TEMPLATE = 'Uploaded notes ko clean markdown summary + formula sheet me convert karo.';
const CANVAS_TEMPLATE = 'Is content se ek downloadable .md/.txt file bana do, headings aur tables ke saath.';

const SUGGESTIONS = [
  {
    label: 'Solve JEE question',
    prompt: 'Ek JEE-level maths problem bana kar step-by-step solve karo, LaTeX me. Example: \\(\\int_0^1 x^2\\,dx\\)',
  },
  { label: 'Create revision plan', prompt: 'Aaj ke liye ek tight revision plan banao — weak topics pe focus karo.' },
  { label: 'Summarize notes', prompt: 'Uploaded notes ko clean markdown summary + formula sheet me convert karo.' },
  { label: 'Explain concept', prompt: 'Ek JEE concept ko simple Hinglish me explain karo with example.' },
  { label: 'Generate flashcards', prompt: 'Is topic ke flashcards generate karo — Q&A pairs me.' },
];

const ATTACH_TOOLS: { id: string; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'math', label: 'Math Solver', hint: 'LaTeX solve', icon: <Sigma size={20} /> },
  { id: 'image', label: 'Image', hint: 'Upload photo', icon: <Image size={20} /> },
  { id: 'pdf', label: 'PDF', hint: 'Docs upload', icon: <FileText size={20} /> },
  { id: 'canvas', label: 'Canvas', hint: 'File output', icon: <PenLine size={20} /> },
  { id: 'markdown', label: 'Markdown', hint: 'Notes → MD', icon: <NotebookPen size={20} /> },
  { id: 'camera', label: 'Camera', hint: 'Live photo', icon: <Camera size={20} /> },
  { id: 'gallery', label: 'Gallery', hint: 'Pick photo', icon: <ImagePlus size={20} /> },
  { id: 'notes', label: 'Notes', hint: 'Text files', icon: <StickyNote size={20} /> },
];

export default function ChatScreen() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => container.chat.listSessions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamReasoning, setStreamReasoning] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<{ sessionId: string; messageId: string; originalDraft: string } | null>(null);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [processing, setProcessing] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const [providerCount, setProviderCount] = useState(container.providerSettings.listStoredProviders().length);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);
  const providers = useMemo(
    () => (void providerCount, container.providerSettings.listStoredProviders()),
    [providerCount],
  );
  const messages = active?.messages ?? [];
  const hasMessages = active !== null && messages.length > 0;
  const lastAssistantStreaming = streaming && streamText.length > 0;
  const aiEnabled = container.providerSettings.isAiEnabled();

  const modelChip = useMemo(() => {
    const pid = active?.prefs.providerId ?? null;
    const provider = pid ? providers.find((p) => p.id === pid) : container.providerSettings.getActiveProvider();
    if (!provider) return { label: 'AI off', model: null as string | null };
    return { label: provider.label, model: (active?.prefs.model ?? provider.model ?? null) as string | null };
  }, [active?.prefs.providerId, active?.prefs.model, providers]);

  useEffect(() => {
    if (!activeId && sessions.length > 0) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, streamText, streaming]);

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.prefs.providerId]);

  useEffect(() => {
    setDraft('');
    setEditing(null);
    setAttachments([]);
    setError('');
    setVisibleFrom(0);
  }, [activeId]);

  useEffect(() => {
    const open = showSettings || showAttach || showHistory || showProviderPicker || menu !== null;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [showSettings, showAttach, showHistory, showProviderPicker, menu]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft]);

  function refresh() {
    setSessions(container.chat.listSessions());
  }

  function ensureSession(): ChatSession {
    let s = active;
    if (!s) {
      s = container.chat.createSession();
      refresh();
      setActiveId(s.id);
    }
    return s;
  }

  function newChat() {
    haptic();
    const session = container.chat.createSession();
    refresh();
    setActiveId(session.id);
    setDraft('');
    revokeAttachmentUrls(attachments);
    setAttachments([]);
    setError('');
    setShowHistory(false);
    focusComposer();
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

  function resetPrefs() {
    if (!active) return;
    container.chat.updatePrefs(active.id, defaultChatPrefs());
    refresh();
    haptic();
    setNotice('Chat settings reset ho gaye');
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

  async function send() {
    const pendingDraft = draft;
    const pendingAttachments = attachments;
    const text = buildPromptWithAttachments(pendingDraft.trim(), pendingAttachments);
    if (!text || streaming) return;
    const s = ensureSession();
    const editTarget = editing && editing.sessionId === s.id ? editing : null;
    setShowAttach(false);
    if (editTarget) {
      container.chat.deleteMessagesFrom(s.id, editTarget.messageId);
      setEditing(null);
      refresh();
    }
    await doSend(s.id, text, pendingDraft, pendingAttachments);
  }

  async function doSend(
    sessionId: string,
    text: string,
    pendingDraft: string,
    pendingAttachments: DraftAttachment[],
  ) {
    if (!text || streaming) return;
    let sent = false;
    setError('');
    setDraft('');
    setAttachments([]);
    setStreaming(true);
    setStreamText('');
    setStreamReasoning('');
    setStatus('');
    const controller = new AbortController();
    abortRef.current = controller;

    // Convert DraftAttachment to ChatAttachment for LLM
    const chatAttachments: { id: string; name: string; kind: 'text' | 'image' | 'binary'; previewUrl?: string }[] = 
      pendingAttachments.map(a => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        previewUrl: a.previewUrl,
      }));

    const pending = container.chat.send(
      sessionId,
      text,
      (delta) => setStreamText((prev) => prev + delta),
      controller.signal,
      (s) => setStatus(s),
      (reasoning) => setStreamReasoning((prev) => prev + reasoning),
      chatAttachments,
    );
    // chat.send() pushes the user message synchronously before its first await,
    // so re-read sessions now — the user's own message appears immediately
    // while the AI streams, instead of only after the reply completes.
    refresh();
    try {
      await pending;
      sent = true;
    } catch (err) {
      setDraft(pendingDraft);
      setAttachments(pendingAttachments);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (sent) revokeAttachmentUrls(pendingAttachments);
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

  function regenerate() {
    if (!active || streaming) return;
    const msgs = active.messages;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') return;
    const userMsg = msgs[msgs.length - 2];
    if (!userMsg || userMsg.role !== 'user') return;
    container.chat.deleteMessagesFrom(active.id, userMsg.id);
    refresh();
    haptic();
    void doSend(active.id, userMsg.content, '', []);
  }

  function deleteMessage(message: ChatMessage) {
    if (!active) return;
    container.chat.deleteMessage(active.id, message.id);
    refresh();
    haptic();
    setNotice('Message delete ho gaya');
  }

  function editMessage(message: ChatMessage) {
    if (!active || streaming) return;
    const editDraft = stripAttachmentBlocks(message.content);
    setEditing({ sessionId: active.id, messageId: message.id, originalDraft: draft });
    setDraft(editDraft);
    setAttachments([]);
    setShowAttach(false);
    setError('');
    setNotice('Editing mode — send karne par is message ke baad wali chat replace hogi.');
    haptic();
    focusComposer();
  }

  function cancelEdit() {
    if (!editing) return;
    setDraft(editing.originalDraft);
    setEditing(null);
    setError('');
    setNotice('Edit cancel ho gaya — chat unchanged.');
    haptic();
    focusComposer();
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setNotice('Copied');
      hapticSuccess();
    } catch {
      hapticError();
    }
  }

  function shareMessage(message: ChatMessage) {
    if ('share' in navigator) {
      navigator
        .share({ text: message.content })
        .then(() => {})
        .catch(() => {});
    } else {
      void copyMessage(message);
    }
  }

  function downloadMessage(message: ChatMessage) {
    downloadText(message.content, `levelup-ai-${new Date(message.createdAt).toISOString().slice(0, 10)}.md`);
  }

  function exportChat() {
    if (!active) return;
    const md = [
      `# ${active.title || 'LevelUp chat'}`,
      '',
      ...active.messages.map((m) => `**${m.role === 'user' ? 'User' : 'AI'}:**\n\n${m.content}`),
      '',
    ].join('\n\n');
    downloadText(md, `levelup-chat-${(active.title || 'session').slice(0, 30).replace(/[^\w-]+/g, '_')}.md`);
    setNotice('Chat export ho gaya');
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError('');
    const pending = Array.from(files);
    setProcessing((prev) => [...prev, ...pending.map((f) => f.name)]);
    try {
      const next = await Promise.all(pending.map(readAttachment));
      setAttachments((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing((prev) => prev.filter((name) => !pending.some((f) => f.name === name)));
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

  function pickFiles(accept: string, capture?: string) {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    else input.removeAttribute('capture');
    input.click();
  }

  function insertPromptTemplate(template: string) {
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${template}` : template));
  }

  function attachTool(id: string) {
    setShowAttach(false);
    haptic();
    switch (id) {
      case 'math':
        insertPromptTemplate(MATH_TEMPLATE);
        break;
      case 'canvas':
        insertPromptTemplate(CANVAS_TEMPLATE);
        break;
      case 'markdown':
        insertPromptTemplate(MD_TEMPLATE);
        break;
      case 'image':
      case 'gallery':
        pickFiles('image/*');
        break;
      case 'camera':
        pickFiles('image/*', 'environment');
        break;
      case 'pdf':
        pickFiles('.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.zip');
        break;
      case 'notes':
        pickFiles('.txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.h,.cs,.go,.rs,.rb,.php,.swift,.kt,.sh,.bash,.bat,.ps1,.sql,.toml,.ini,.cfg,.log,.tex,.env,.properties');
        break;
    }
    focusComposer();
  }

  function focusComposer() {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function keydown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const [visibleFrom, setVisibleFrom] = useState(0);
  const windowedMessages = messages.length <= VISIBLE_MESSAGES ? messages : messages.slice(-visibleFrom || -VISIBLE_MESSAGES);
  const showEarlier = messages.length > VISIBLE_MESSAGES;

  function openMenu(e: { clientX: number; clientY: number }, message: ChatMessage) {
    setMenu({
      message,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 200)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 280)),
    });
  }

  return (
    <div className="chat-shell fade-up">
      {/* Top bar */}
      <header className="chat-topbar">
        <button
          type="button"
          onClick={newChat}
          className="icon-btn"
          aria-label="New chat"
          title="New chat"
        >
          <MessageSquarePlus size={19} color="var(--color-l)" />
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left"
          aria-label="Open chat history"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-l/10 text-l"><Sparkles size={16} /></span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[15px] font-bold leading-none">{active?.title || 'AI Coach'}</span>
            <span className="mt-0.5 block truncate text-[10px] font-medium text-muted">ChatGPT-style maths, notes & files</span>
          </span>
          <ChevronDown size={13} className="shrink-0 text-muted" />
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex h-8 max-w-[9.5rem] shrink-0 items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 text-[10px] font-semibold text-muted transition-colors hover:border-border-strong"
          aria-label="Model settings"
          title="Model settings"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: aiEnabled ? 'var(--color-success)' : 'var(--color-muted-dim)' }}
          />
          <span className="truncate">
            {modelChip.label}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="icon-btn"
          aria-label="Chat settings"
          title="Chat settings"
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      {/* Conversation */}
      <main ref={scrollRef} className="chat-thread" aria-label="Messages">
        {!hasMessages && !streaming ? (
          <EmptyChat onPick={(t) => setDraft(t)} />
        ) : (
          <div className="mx-auto max-w-[48rem] py-4">
            {showEarlier && (
              <div className="mb-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    haptic();
                    setVisibleFrom((v) => Math.max(VISIBLE_MESSAGES, (v || VISIBLE_MESSAGES) + VISIBLE_MESSAGES));
                    requestAnimationFrame(() => {
                      const el = scrollRef.current;
                      if (el) el.scrollTop = 0;
                    });
                  }}
                  className="rounded-full border border-border bg-panel px-3.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-text"
                >
                  Earlier messages
                </button>
              </div>
            )}
            {windowedMessages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                isLast={i === windowedMessages.length - 1}
                onMenu={openMenu}
                onCopy={(msg) => void copyMessage(msg)}
                onEdit={editMessage}
                onRegenerate={regenerate}
                onDelete={deleteMessage}
                onDownload={downloadMessage}
                onShare={(msg) => shareMessage(msg)}
              />
            ))}
            {streaming &&
              (lastAssistantStreaming ? (
                <StreamBubble reasoning={streamReasoning} text={streamText} />
              ) : (
                <TypingBubble status={status} />
              ))}
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="chat-composer-wrap">
        {(error || notice) && (
          <div
            className={`mb-2 flex justify-center text-center ${error ? 'text-danger' : 'text-muted'}`}
            role={error ? 'alert' : 'status'}
          >
            <span className="rounded-full border border-border bg-panel px-3 py-1.5 text-[11px]">
              {error || notice}
            </span>
          </div>
        )}
        <div className="chat-input chat-composer rounded-[1.5rem] p-1.5">
          {(processing.length > 0 || attachments.length > 0) && (
            <div className="no-scrollbar mb-1.5 flex gap-2 overflow-x-auto px-1 pt-1">
              {processing.map((name) => (
                <span
                  key={`proc-${name}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-l/30 bg-l/10 px-2 py-1 text-[10px] font-semibold text-l"
                  role="status"
                >
                  <span className="spinner" aria-hidden="true" />
                  <span className="truncate">{name}</span>
                </span>
              ))}
              {attachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}
          {editing && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-2xl border border-light/25 bg-light/10 px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-semibold text-light">Editing message</p>
                <p className="truncate text-[10px] text-muted">Cancel dabane se niche wali chat safe rahegi.</p>
              </div>
              <button type="button" className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs" onClick={cancelEdit}>
                <X size={13} /> Cancel
              </button>
            </div>
          )}
          <div className="flex items-end gap-1">
            <button
              type="button"
              onClick={() => setShowAttach(true)}
              className="icon-btn shrink-0"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip size={19} color="var(--color-muted)" />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={keydown}
              placeholder="Maths, doubts ya notes likho…"
              className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-snug text-text outline-none placeholder:text-muted-dim"
              aria-label="Message"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-danger/40 bg-danger/10 transition-transform active:scale-90"
                aria-label="Stop generating"
              >
                <X size={17} color="var(--color-danger)" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-l transition-transform active:scale-90"
                aria-label={editing ? 'Send edited message' : 'Send message'}
              >
                <Send size={17} color="#06201e" />
              </button>
            )}
          </div>
        </div>
        <p className="pb-1 pt-1 text-center text-[9px] tracking-wide text-muted-dim">
          AI Coach · LaTeX maths · files · 100% local
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.tex,.ppt,.pptx,.doc,.docx,.xls,.xlsx,image/*"
        className="hidden"
        onChange={(e) => void attachFiles(e.target.files)}
      />

      {/* Overlays */}
      {active && showSettings && (
        <SettingsSheet
          prefs={active.prefs}
          providers={providers}
          catalog={catalog}
          onChange={updatePrefs}
          onReset={resetPrefs}
          onLoadCatalog={() => void loadCatalog()}
          onOpenProviderPicker={() => setShowProviderPicker(true)}
          onProviderAdded={() => setProviderCount((c) => c + 1)}
          onHistoryChanged={() => {
            setProviderCount((c) => c + 1);
            refresh();
          }}
          onExport={exportChat}
          onClear={clearMessages}
          onClose={() => setShowSettings(false)}
        />
      )}

      {active && showProviderPicker && (
        <ProviderPickerSheet
          prefs={active.prefs}
          providers={providers}
          onSelect={(pid) => {
            updatePrefs({ providerId: pid });
            setShowProviderPicker(false);
          }}
          onProviderAdded={() => setProviderCount((c) => c + 1)}
          onClose={() => setShowProviderPicker(false)}
        />
      )}

      {showHistory && (
        <HistorySheet
          sessions={sessions}
          activeId={activeId}
          onOpen={openSession}
          onNew={newChat}
          onDelete={removeSession}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showAttach && <AttachmentSheet onPick={attachTool} onClose={() => setShowAttach(false)} />}

      {menu && (
        <MessageMenu
          message={menu.message}
          position={{ x: menu.x, y: menu.y }}
          isLast={menu.message.id === active?.messages[active.messages.length - 1]?.id}
          onClose={() => setMenu(null)}
          onCopy={(m) => void copyMessage(m)}
          onEdit={editMessage}
          onRegenerate={regenerate}
          onDelete={deleteMessage}
          onDownload={downloadMessage}
          onShare={(m) => shareMessage(m)}
        />
      )}
    </div>
  );
}

/* =====================================================================
   Empty chat — logo, greeting, prompt suggestions
   ===================================================================== */

function EmptyChat({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 pb-12 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-3xl"
        style={{
          background: 'linear-gradient(145deg, rgba(79,209,197,0.24), rgba(96,165,250,0.14))',
          border: '1px solid rgba(79,209,197,0.35)',
          boxShadow: '0 0 42px -8px rgba(79,209,197,0.4)',
        }}
      >
        <Sparkles size={30} color="var(--color-l)" />
      </span>
      <h2 className="mt-5 font-display text-2xl font-bold tracking-tight">{greeting()}, I’m your AI Coach</h2>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">Ask doubts, solve JEE math with clean LaTeX, summarize notes, or turn files into revision material.</p>
      <div className="no-scrollbar mt-6 flex w-full gap-2 overflow-x-auto pb-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              haptic();
              onPick(s.prompt);
            }}
            className="filter-chip shrink-0"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* =====================================================================
   Messages
   ===================================================================== */

interface MessageActions {
  onMenu: (pos: { clientX: number; clientY: number }, m: ChatMessage) => void;
  onCopy: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onRegenerate: () => void;
  onDelete: (m: ChatMessage) => void;
  onDownload: (m: ChatMessage) => void;
  onShare: (m: ChatMessage) => void;
}

function MessageBubble({ message, isLast, ...actions }: MessageActions & { message: ChatMessage; isLast: boolean }) {
  const isUser = message.role === 'user';
  const holdTimer = useRef<number | null>(null);
  const firedRef = useRef(false);
  const doc = useMemo(() => (isUser ? null : detectFileDoc(message.content)), [isUser, message.content]);
  const [showPreview, setShowPreview] = useState(true);

  function triggerMenu(clientX: number, clientY: number) {
    haptic(20);
    actions.onMenu({ clientX, clientY }, message);
  }

  return (
    <motion.div
      className={`mb-4 flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
      initial={{ opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!firedRef.current) triggerMenu(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        firedRef.current = false;
        holdTimer.current = window.setTimeout(() => {
          firedRef.current = true;
          triggerMenu(e.clientX, e.clientY);
        }, 450);
      }}
      onPointerUp={() => {
        if (holdTimer.current) {
          window.clearTimeout(holdTimer.current);
          holdTimer.current = null;
        }
      }}
      onPointerMove={() => {
        if (holdTimer.current) {
          window.clearTimeout(holdTimer.current);
          holdTimer.current = null;
        }
      }}
      onPointerLeave={() => {
        if (holdTimer.current) {
          window.clearTimeout(holdTimer.current);
          holdTimer.current = null;
        }
      }}
    >
      <div
        className={`message-card relative rounded-3xl px-4 py-3 text-[13.5px] leading-relaxed ${
          isUser
            ? 'bubble-user rounded-br-lg'
            : 'bubble-ai rounded-bl-lg'
        }`}
      >
        {message.reasoning && <ThinkingBlock text={message.reasoning} />}
        {message.tool && <ToolBadge tool={message.tool} />}
        {isUser ? (
          <UserMessageContent content={message.content} />
        ) : (
          <div className="markdown-body">
            {doc && (
              <FileCard
                name={doc.name}
                sizeLabel={doc.sizeLabel}
                preview={showPreview}
                onTogglePreview={() => {
                  haptic();
                  setShowPreview((v) => !v);
                }}
                onDownload={() => actions.onDownload(message)}
              />
            )}
            {(!doc || showPreview) && <ChatMarkdown text={message.content} />}
          </div>
        )}

        <div className={`mt-2 flex items-center gap-0.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {message.stopped && (
            <span className={`rounded px-1.5 py-0.5 text-[9px] ${isUser ? 'bg-black/20' : 'bg-surface-3 text-muted'}`}>
              stopped
            </span>
          )}
          {message.role === 'assistant' && <Check size={11} color="var(--color-success)" />}
          {isUser ? (
            <>
              <BubbleAction label="Edit" onClick={() => actions.onEdit(message)}>
                <PenLine size={13} />
              </BubbleAction>
              <BubbleAction label="Copy" onClick={() => actions.onCopy(message)}>
                <Copy size={13} />
              </BubbleAction>
              <BubbleAction label="Delete" onClick={() => actions.onDelete(message)}>
                <Trash2 size={13} />
              </BubbleAction>
            </>
          ) : (
            <>
              <BubbleAction label="Copy" onClick={() => actions.onCopy(message)}>
                <Copy size={13} />
              </BubbleAction>
              {isLast && (
                <BubbleAction label="Regenerate" onClick={actions.onRegenerate}>
                  <RefreshCw size={13} />
                </BubbleAction>
              )}
              <BubbleAction label="Download .md" onClick={() => actions.onDownload(message)}>
                <Download size={13} />
              </BubbleAction>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function BubbleAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        haptic();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-black/15 hover:text-text"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function StreamBubble({ reasoning, text }: { reasoning: string; text: string }) {
  return (
    <motion.div
      className="mb-2.5 flex items-end gap-2"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }}
    >
      <div className="message-card bubble-ai rounded-3xl rounded-bl-lg px-4 py-3 text-[13.5px] leading-relaxed">
        {reasoning && <ThinkingBlock text={reasoning} />}
        <div className="markdown-body">
          <ChatMarkdown text={text} />
          <span className="caret-blink" aria-hidden="true" />
        </div>
      </div>
    </motion.div>
  );
}

function TypingBubble({ status }: { status: string }) {
  return (
    <motion.div
      className="mb-2.5 flex items-end gap-2"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.9 }}
    >
      <div className="bubble-ai flex items-center gap-2.5 rounded-2xl rounded-bl-md px-4 py-3">
        <span className="typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {status && <span className="text-[11px] text-muted">{status}</span>}
      </div>
    </motion.div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-peak/20 bg-peak/5">
      <button
        type="button"
        onClick={() => {
          haptic();
          setOpen((v) => !v);
        }}
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

function ToolBadge({ tool }: { tool: string }) {
  return (
    <span className="mb-1.5 inline-flex items-center gap-1 rounded-md border border-l/40 bg-l/10 px-1.5 py-0.5 text-[9px] font-semibold text-l">
      <Wrench size={10} />
      tool: {tool}
    </span>
  );
}

/* =====================================================================
   Attachments
   ===================================================================== */

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
        <p className="text-muted">
          {formatBytes(attachment.size)} · {attachment.kind}
        </p>
      </div>
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 text-muted hover:bg-danger/10 hover:text-danger" aria-label="Remove attachment">
        <X size={11} />
      </button>
    </div>
  );
}

/* =====================================================================
   Sheets
   ===================================================================== */

function Sheet({
  open,
  onClose,
  title,
  icon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} className="sheet">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="flex items-center justify-between px-5 pb-2 pt-1">
          <h2 className="flex items-center gap-2 font-display text-base font-bold">
            <span className="text-l">{icon}</span>
            {title}
          </h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="sheet-scroll px-5 pb-[calc(1.5rem_+_env(safe-area-inset-bottom,0px))]">
          {children}
        </div>
      </div>
    </>
  );
}

function SettingsSheet({
  prefs,
  providers,
  catalog,
  onChange,
  onReset,
  onLoadCatalog,
  onOpenProviderPicker,
  onProviderAdded,
  onHistoryChanged,
  onExport,
  onClear,
  onClose,
}: {
  prefs: ChatPreferences;
  providers: Array<{ id: string; label: string; enabled?: boolean }>;
  catalog: ModelInfo[];
  onChange: (patch: Partial<ChatPreferences>) => void;
  onReset: () => void;
  onLoadCatalog: () => void;
  onOpenProviderPicker: () => void;
  onProviderAdded: () => void;
  onHistoryChanged: () => void;
  onExport: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const providerLabel = providers.find((p) => p.id === prefs.providerId)?.label ?? 'App default';
  return (
    <Sheet open onClose={onClose} title="Chat settings" icon={<Settings2 size={16} />}>
      <div className="space-y-6 pb-2">
        {/* Model */}
        <section>
          <p className="section-label mb-2">Model</p>
          <div className="overflow-hidden rounded-2xl border border-border bg-panel">
            <button
              type="button"
              onClick={onOpenProviderPicker}
              className="group flex w-full items-center justify-between px-4 py-3.5 text-sm transition-colors hover:bg-panel-raised active:bg-panel-raised"
            >
              <span className="text-muted">Provider</span>
              <span className="flex items-center gap-1 font-semibold text-text">
                {providerLabel}
                <ChevronRight size={14} className="text-muted transition-transform group-active:translate-x-0.5" />
              </span>
            </button>
            <div className="border-t border-border/70 px-4 py-3.5">
              <label className="field-label flex items-center justify-between">
                <span>Model override</span>
                <button type="button" onClick={onLoadCatalog} className="font-normal text-muted underline-offset-2 hover:text-text hover:underline">
                  catalog dikhao
                </button>
              </label>
              <input
                list="chat-model-catalog"
                value={prefs.model ?? ''}
                onChange={(e) => onChange({ model: e.target.value || null })}
                placeholder="Khaali = provider default"
                className="field"
              />
              <datalist id="chat-model-catalog">
                {catalog.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="mt-2">
            <AddProviderForm
              onAdd={(config) => {
                container.providerSettings.upsertProvider(config);
                onProviderAdded();
              }}
            />
          </div>
        </section>

        {/* Generation */}
        <section>
          <p className="section-label mb-2">Generation</p>
          <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-panel">
            <div className="px-4 py-3.5">
              <label className="field-label flex items-center justify-between">
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
            <div className="px-4 py-3.5">
              <label className="field-label flex items-center justify-between">
                <span>Max tokens</span>
                <span className="font-mono text-light">{prefs.maxTokens ?? 4096}</span>
              </label>
              <input
                type="number"
                min={1}
                max={8192}
                step={128}
                value={prefs.maxTokens ?? 4096}
                onChange={(e) => onChange({ maxTokens: clampTokens(Number(e.target.value)) })}
                className="field"
              />
              <p className="mt-0.5 text-[10px] text-muted">Response budget; 1 se 8192 tokens tak.</p>
            </div>
            <div className="px-4 py-3.5">
              <label className="field-label">Thinking / reasoning</label>
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
          </div>
        </section>

        {/* Context */}
        <section>
          <p className="section-label mb-2">Context</p>
          <div className="rounded-2xl border border-border bg-panel">
            <label className="flex items-center justify-between gap-2 px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-text">Aaj ka plan context</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                  AI ko aaj ke tasks, streak aur progress (REFERENCE ONLY).
                </p>
              </div>
              <span className="toggle">
                <input
                  type="checkbox"
                  checked={prefs.includeContext}
                  onChange={(e) => onChange({ includeContext: e.target.checked })}
                  aria-label="Include today's context"
                />
                <span className="track">
                  <span className="thumb" />
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* System */}
        <section>
          <p className="section-label mb-2">Persona</p>
          <div className="overflow-hidden rounded-2xl border border-border bg-panel">
            <div className="px-4 py-3.5">
              <label className="field-label">System persona (editable)</label>
              <textarea
                rows={6}
                value={prefs.systemPrompt}
                onChange={(e) => onChange({ systemPrompt: e.target.value })}
                placeholder="Divya coach persona, tone, Markdown/LaTeX rules..."
                className="field resize-none"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted">{prefs.systemPrompt.length} characters</span>
                <button
                  type="button"
                  onClick={() => onChange({ systemPrompt: INTERNAL_SYSTEM_PROMPT })}
                  className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                >
                  Reset Divya persona
                </button>
              </div>
            </div>
            <div className="border-t border-border/70 px-4 py-3.5">
              <label className="field-label">User persona / custom instructions</label>
              <textarea
                rows={3}
                value={prefs.userPersona ?? DEFAULT_USER_PERSONA}
                onChange={(e) => onChange({ userPersona: e.target.value })}
                placeholder="Blank by default — optional personal instructions yahan likho."
                className="field resize-none"
              />
              <button
                type="button"
                onClick={() => onChange({ userPersona: DEFAULT_USER_PERSONA })}
                className="mt-1.5 text-xs text-muted underline-offset-2 hover:text-text hover:underline"
              >
                Clear user persona
              </button>
            </div>
          </div>
        </section>

        {/* AI activity */}
        <AiActivityPanel onHistoryChanged={onHistoryChanged} />

        {/* Actions */}
        <section>
          <p className="section-label mb-2">Actions</p>
          <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-panel">
            <ActionRow icon={<Download size={15} />} label="Export chat (.md)" onClick={onExport} />
            <ActionRow icon={<Eraser size={15} />} label="Chat clear karo" onClick={onClear} />
            <ActionRow icon={<Settings2 size={15} />} label="Settings reset karo" onClick={onReset} />
          </div>
        </section>
      </div>
    </Sheet>
  );
}

function ActionRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        onClick();
      }}
      className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-medium text-text transition-colors hover:bg-panel-raised active:bg-panel-raised"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}

function ProviderPickerSheet({
  prefs,
  providers,
  onSelect,
  onProviderAdded,
  onClose,
}: {
  prefs: ChatPreferences;
  providers: Array<{ id: string; label: string; enabled?: boolean }>;
  onSelect: (pid: string | null) => void;
  onProviderAdded: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose} title="Provider" icon={<Settings2 size={16} />}>
      <div className="space-y-1.5 pb-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-sm transition-colors ${
            !prefs.providerId ? 'border-l/50 bg-l/10 text-text' : 'border-border bg-panel text-muted'
          }`}
        >
          <span>App default (active provider)</span>
          {!prefs.providerId && <Check size={15} color="var(--color-l)" />}
        </button>
        {providers.map((p) => {
          const isActive = prefs.providerId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                isActive ? 'border-l/50 bg-l/10 text-text' : 'border-border bg-panel text-muted'
              }`}
            >
              <span className="flex items-center gap-2">
                {p.label}
                {p.enabled === false && <span className="text-[10px] text-muted">(off)</span>}
              </span>
              {isActive && <Check size={15} color="var(--color-l)" />}
            </button>
          );
        })}
        <div className="pt-1">
          <AddProviderForm
            onAdd={(config) => {
              container.providerSettings.upsertProvider(config);
              onProviderAdded();
            }}
          />
        </div>
      </div>
    </Sheet>
  );
}

function HistorySheet({
  sessions,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose} title="Chats" icon={<MessageSquareText size={16} />}>
      <div className="space-y-1.5 pb-2">
        <button
          type="button"
          onClick={onNew}
          className="mb-1 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-l/40 bg-l/10 px-3.5 py-3 text-sm font-semibold text-l transition-colors hover:bg-l/15"
        >
          <MessageSquarePlus size={15} />
          Naya chat
        </button>
        {sessions.length === 0 && <p className="px-1 py-4 text-center text-sm text-muted">Abhi koi chat nahi hai.</p>}
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                isActive ? 'border-l/50 bg-l/10' : 'border-border bg-panel'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onOpen(s.id);
                  onClose();
                }}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
              >
                <span className="w-full truncate text-sm font-semibold text-text">{s.title || 'Naya chat'}</span>
                <span className="text-[10px] text-muted">
                  {s.messages.length} messages · {timeAgo(s.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  haptic();
                  onDelete(s.id);
                }}
                className="icon-btn shrink-0 !min-w-8 !min-h-8 rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                aria-label="Delete chat"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function AttachmentSheet({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Attach" icon={<Paperclip size={16} />}>
      <div className="grid grid-cols-3 gap-2.5 pb-2">
        {ATTACH_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-panel px-2 py-4 text-center transition-all hover:border-l/50 active:scale-[0.96]"
          >
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'rgba(79,209,197,0.12)', color: 'var(--color-l)' }}
            >
              {t.icon}
            </span>
            <span className="text-[11px] font-semibold leading-tight text-text">{t.label}</span>
            <span className="text-[9px] leading-tight text-muted-dim">{t.hint}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function AiActivityPanel({ onHistoryChanged }: { onHistoryChanged: () => void }) {
  const history = container.store.get().aiActionHistory;
  const latest = history.versions.at(-1);
  const undone = history.undone.length;

  function undo() {
    container.store.save(undoLastAiAction(container.store.get()));
    onHistoryChanged();
  }

  function redo() {
    container.store.save(redoLastAiAction(container.store.get()));
    onHistoryChanged();
  }

  return (
    <section>
      <p className="section-label mb-2">AI Activity</p>
      <div className="rounded-xl border border-border bg-panel px-3.5 py-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted">AI Activity & Undo</p>
          <span className="font-mono text-[10px] text-light">{history.versions.length} versions</span>
        </div>
        {latest ? (
          <p className="mb-2 line-clamp-2 text-[11px] text-muted">
            Latest: {latest.summary} · {latest.status}
          </p>
        ) : (
          <p className="mb-2 text-[11px] text-muted">AI edits will appear here with 90-day version history.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!latest} onClick={undo} className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs disabled:opacity-40">
            Undo last AI change
          </button>
          <button type="button" disabled={undone === 0} onClick={redo} className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs disabled:opacity-40">
            Redo ({undone})
          </button>
        </div>
      </div>
    </section>
  );
}

/* =====================================================================
   Message context menu
   ===================================================================== */

function MessageMenu({
  message,
  position,
  isLast,
  onClose,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
  onDownload,
  onShare,
}: {
  message: ChatMessage;
  position: { x: number; y: number };
  isLast: boolean;
  onClose: () => void;
  onCopy: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onRegenerate: () => void;
  onDelete: (m: ChatMessage) => void;
  onDownload: (m: ChatMessage) => void;
  onShare: (m: ChatMessage) => void;
}) {
  const isUser = message.role === 'user';
  const items: { label: string; icon: React.ReactNode; danger?: boolean; run: () => void }[] = [
    { label: 'Copy', icon: <Copy size={15} />, run: () => onCopy(message) },
    ...(isUser
      ? [{ label: 'Edit', icon: <PenLine size={15} />, run: () => onEdit(message) }]
      : [
          ...(isLast ? [{ label: 'Regenerate', icon: <RefreshCw size={15} />, run: onRegenerate }] : []),
          { label: 'Download .md', icon: <Download size={15} />, run: () => onDownload(message) },
        ]),
    ...('share' in navigator ? [{ label: 'Share', icon: <Share size={15} />, run: () => onShare(message) }] : []),
    { label: 'Delete', icon: <Trash2 size={15} />, danger: true, run: () => onDelete(message) },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[59]" onClick={onClose} aria-hidden="true" />
      <div role="menu" className="ctx-menu" style={{ left: position.x, top: position.y }}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              haptic();
              item.run();
              onClose();
            }}
            className={`ctx-item ${item.danger ? 'danger' : ''}`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* =====================================================================
   Helpers
   ===================================================================== */

async function readAttachment(file: File): Promise<DraftAttachment> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isText = file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension);

  if (file.type === 'application/pdf' || extension === 'pdf') {
    try {
      const raw = await extractPdfText(file);
      const content = raw
        ? `--- Extracted text from PDF: ${file.name} (${file.type}, ${formatBytes(file.size)}) ---\n\n${raw}`
        : '';
      return {
        id: uid('att'),
        name: file.name,
        type: file.type || 'application/pdf',
        size: file.size,
        kind: content ? 'text' : 'binary',
        content: content || undefined,
      };
    } catch {
      return { id: uid('att'), name: file.name, type: file.type || 'application/pdf', size: file.size, kind: 'binary' };
    }
  }

  if (isText) {
    try {
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
    } catch {
      return { id: uid('att'), name: file.name, type: file.type || extension || 'text', size: file.size, kind: 'binary' };
    }
  }
  if (file.type.startsWith('image/')) {
    return { id: uid('att'), name: file.name, type: file.type, size: file.size, kind: 'image', previewUrl: URL.createObjectURL(file) };
  }
  return { id: uid('att'), name: file.name, type: file.type || extension || 'binary', size: file.size, kind: 'binary' };
}

function revokeAttachmentUrls(attachments: DraftAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

function buildPromptWithAttachments(draft: string, attachments: DraftAttachment[]): string {
  if (attachments.length === 0) return draft;
  const blocks = attachments.map((a, idx) => {
    const header = `Attachment ${idx + 1}: ${a.name} (${a.type || 'unknown'}, ${formatBytes(a.size)})`;
    if (a.kind === 'text') return `<attached_file>\n${header}\n\n${a.content ?? ''}\n</attached_file>`;
    if (a.kind === 'image') return `<attached_image>\n${header}\nUser ne ek image attach ki hai (preview UI mein visible hai). Agar tum image dekh sakte ho toh analyze karo; warna user ko text/OCR dekar likhne ko bolo.\n</attached_image>`;
    return `<attached_file>\n${header}\nYeh file type in-browser extract nahi ho sakti. "System limitation" mat bolo — bas user se puchho ki content ko .txt/.md me export kare ya copy-paste kare.\n</attached_file>`;
  });
  return [draft || 'In uploaded attachments ko analyze karo.', ...blocks].join('\n\n');
}

function stripAttachmentBlocks(text: string): string {
  return text
    .replace(/<attached_file>[\s\S]*?<\/attached_file>/g, '')
    .replace(/<attached_image>[\s\S]*?<\/attached_image>/g, '')
    .trim();
}

/**
 * Parses a sent user message into its typed text plus one descriptor per
 * attached file, so attachments render as chips instead of raw block text.
 */
function parseUserMessageContent(content: string): { text: string; files: { name: string; meta: string }[]; hasImage: boolean } {
  const files: { name: string; meta: string }[] = [];
  let hasImage = false;
  const text = content
    .replace(/<attached_(?:file|image)>([\s\S]*?)<\/attached_(?:file|image)>/g, (_whole, inner: string, tag: string) => {
      if (tag === 'image') hasImage = true;
      const header = (inner.trim().split('\n')[0] ?? '').replace(/^Attachment\s+\d+:\s*/i, '');
      if (header) {
        const match = header.match(/^(.+?)\s*\((.*)\)\s*$/);
        files.push({
          name: (match ? match[1] : header).trim(),
          meta: (match ? match[2] : '').trim(),
        });
      }
      return '';
    })
    .trim();
  return { text, files, hasImage };
}

function UserMessageContent({ content }: { content: string }) {
  const { text, files, hasImage } = parseUserMessageContent(content);
  const renderMarkdown = !hasImage && looksLikeMarkdown(text);
  return (
    <div className={renderMarkdown ? '' : 'whitespace-pre-wrap break-words font-medium'}>
      {renderMarkdown ? (
        <div className="markdown-body">
          <ChatMarkdown text={text} />
        </div>
      ) : (
        text || '—'
      )}
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={i}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/15 bg-black/10 px-2 py-1 text-[10px] font-semibold"
            >
              <Paperclip size={10} className="shrink-0" />
              <span className="truncate">{f.name}</span>
              {f.meta && <span className="shrink-0 font-normal opacity-60">({f.meta})</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'abhi';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampTokens(value: number): number {
  if (!Number.isFinite(value)) return 2048;
  return Math.max(1, Math.min(Math.round(value), 8192));
}

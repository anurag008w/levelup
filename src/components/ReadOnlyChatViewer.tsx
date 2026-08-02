import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, ArrowLeft, Eye, MessageSquareText, X } from 'lucide-react';
import type { ChatMessage } from '../core/domain/chat';
import { container } from '../di/container';
import { haptic } from '../lib/haptics';
import { timeAgo } from '../lib/relative-time';
import ChatMarkdown from './ChatMarkdown';

interface ReadItem {
  id: string;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  readOnly: boolean;
  badge?: string;
}

/**
 * Read-only conversation browser — looks exactly like a normal chat thread but
 * with no composer. Shows BOTH live sessions (the ones still in history) and
 * conversations archived in memory (deleted chats kept as structured
 * transcripts, or AI-condensed blocks). Used from the chat settings
 * ("Advanced → View") and from the chat history sheet.
 */
export default function ReadOnlyChatViewer({ onClose, initialId }: { onClose: () => void; initialId?: string | null }) {
  const [items] = useState<ReadItem[]>(() => buildItems());
  const [selectedId, setSelectedId] = useState<string | null>(() => resolveInitial(items, initialId));
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const activeCount = items.filter((i) => !i.readOnly).length;
  const archivedCount = items.length - activeCount;
  const panelRef = useRef<HTMLElement>(null);

  // Modal keyboard behaviour: Escape closes, and focus moves into the dialog
  // (trap stays inside so background app state is not reachable by Tab).
  useEffect(() => {
    const panel = panelRef.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = focusable()[0] as HTMLElement | undefined;
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) return;
      const firstEl = list[0] as HTMLElement;
      const lastEl = list[list.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="settings-modal-layer" role="dialog" aria-modal="true" aria-label="Advanced view">
      <button type="button" className="settings-modal-scrim" aria-label="Close advanced view" onClick={onClose} />
      <motion.section
        ref={panelRef}
        tabIndex={-1}
        className="settings-modal"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: 'tween', duration: 0.18, ease: [0.2, 0, 0, 1] }}
      >
        <header className="settings-modal-head">
          <div className="flex min-w-0 items-center gap-2.5">
            {selected && (
              <button
                type="button"
                className="icon-btn shrink-0"
                onClick={() => {
                  haptic();
                  setSelectedId(null);
                }}
                aria-label="Back to conversation list"
              >
                <ArrowLeft size={17} />
              </button>
            )}
            <div className="min-w-0">
              <p className="eyebrow">{selected ? 'Read-only' : 'Advanced view'}</p>
              <h2 className="truncate font-display text-xl font-bold text-text">
                {selected ? selected.title || 'Naya chat' : 'Purani chats'}
              </h2>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close advanced view">
            <X size={18} />
          </button>
        </header>
        <div className="settings-modal-body">
          <p className="mb-3 flex items-center gap-1.5 rounded-lg border border-border bg-panel-raised px-3 py-2 text-[11px] text-muted">
            <Eye size={13} className="shrink-0 text-l" />
            Read-only — yahan sirf dekh sakte ho, koi chat nahi kar sakte.
          </p>
          {selected ? (
            <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
              {selected.messages.length === 0 && (
                <p className="rounded-lg border border-border bg-panel-raised p-4 text-sm text-muted">
                  Is conversation me abhi koi message nahi hai.
                </p>
              )}
              {selected.messages.map((m) => (
                <div key={m.id} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-3xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      m.role === 'user' ? 'bubble-user rounded-br-lg' : 'bubble-ai rounded-bl-lg'
                    }`}
                  >
                    {m.role === 'assistant' ? (
                      <div className="markdown-body">
                        <ChatMarkdown text={m.content} />
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap break-words font-medium">{m.content}</span>
                    )}
                    <span className={`mt-1 block text-right text-[9px] ${m.role === 'user' ? 'text-black/40' : 'text-muted-dim'}`}>
                      {new Date(m.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-h-[58vh] space-y-1.5 overflow-y-auto pr-1">
              {items.length === 0 && (
                <p className="rounded-lg border border-border bg-panel-raised p-4 text-sm text-muted">
                  Abhi koi purani chat nahi hai.
                </p>
              )}

              {activeCount > 0 && (
                <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Active chats</p>
              )}
              {items
                .filter((i) => !i.readOnly)
                .map((s) => (
                  <ConversationRow key={s.id} item={s} onOpen={() => setSelectedId(s.id)} />
                ))}

              {archivedCount > 0 && (
                <p className="px-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Memory archive · {archivedCount}
                </p>
              )}
              {items
                .filter((i) => i.readOnly)
                .map((s) => (
                  <ConversationRow key={s.id} item={s} onOpen={() => setSelectedId(s.id)} />
                ))}
            </div>
          )}
        </div>
      </motion.section>
    </div>
  );
}

function ConversationRow({ item, onOpen }: { item: ReadItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        onOpen();
      }}
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-panel-raised px-3.5 py-3 text-left transition-colors hover:bg-panel-raised active:bg-panel-raised"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text">{item.title || 'Naya chat'}</span>
        <span className="mt-0.5 block text-[10px] text-muted">
          {item.messages.length} messages · {timeAgo(item.updatedAt)}
          {item.badge ? ` · ${item.badge}` : ''}
        </span>
      </span>
      {item.readOnly ? (
        <Archive size={15} className="shrink-0 text-muted" />
      ) : (
        <MessageSquareText size={15} className="shrink-0 text-muted" />
      )}
    </button>
  );
}

function buildItems(): ReadItem[] {
  const live: ReadItem[] = container.chat.listSessions().map((s) => ({
    id: `live:${s.id}`,
    sessionId: s.id,
    title: s.title || 'Naya chat',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messages: s.messages,
    readOnly: false,
    badge: s.aiSummarizedAt ? 'memory me summarized' : undefined,
  }));
  const archived: ReadItem[] = container.chat.listMemoryConversations().map((c) => ({
    id: `arch:${c.sessionId}`,
    sessionId: c.sessionId,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: c.messages,
    readOnly: true,
    badge: c.source === 'ai-summary' ? 'AI summarized' : 'raw archive',
  }));
  return [...live, ...archived];
}

function resolveInitial(items: ReadItem[], initialId?: string | null): string | null {
  if (!initialId) return null;
  return items.find((i) => i.sessionId === initialId)?.id ?? null;
}

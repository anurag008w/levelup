import { useState } from 'react';
import { motion } from 'framer-motion';
import { Archive, ArrowLeft, Eye, MessageSquareText, X } from 'lucide-react';
import type { ChatMessage } from '../core/domain/chat';
import { container } from '../di/container';
import { haptic } from '../lib/haptics';
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

  return (
    <div className="settings-modal-layer" role="dialog" aria-modal="true" aria-label="Advanced view">
      <button type="button" className="settings-modal-scrim" aria-label="Close advanced view" onClick={onClose} />
      <motion.section
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

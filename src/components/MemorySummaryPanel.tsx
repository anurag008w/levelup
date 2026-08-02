import { useState } from 'react';
import { AlertTriangle, Brain, ChevronDown, Check, RefreshCw, Sparkles } from 'lucide-react';
import type { ModelInfo } from '../core/domain/llm';
import { container } from '../di/container';
import { haptic } from '../lib/haptics';

/**
 * One-click AI memory summarization panel. Reads EVERY unread chat in a single
 * AI pass (plus the last 7 days of already-summarized memory), writes compact
 * memory blocks, and marks the chats so they are never read again. On failure
 * it offers "Retry now" and "Retry with another model" (with a model picker).
 */
export default function MemorySummaryPanel() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showRetryPicker, setShowRetryPicker] = useState(false);
  const [retryProviderId, setRetryProviderId] = useState<string>('');
  const [retryModel, setRetryModel] = useState('');
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);

  const providers = container.providerSettings.listStoredProviders();
  const pending = container.chat.pendingSummaries();
  const active = container.providerSettings.getActiveProvider();

  async function run(providerId?: string | null, model?: string | null) {
    if (running) return;
    haptic();
    setRunning(true);
    setError('');
    setNotice('');
    setStatus('');
    try {
      // No provider configured — fall back to the deterministic raw-archive
      // dump so memory still grows without any AI call.
      if (!container.llm.isAvailable()) {
        const pending = container.chat.pendingRawDumps();
        if (pending === 0) {
          setNotice('Koi nayi chat memory me save hone ko baaqi nahi hai.');
        } else {
          const done = await container.chat.summarizePriorChats();
          setNotice(done > 0 ? `${done} chat ka raw transcript memory me save ho gaya.` : 'Koi nayi chat nahi mili.');
        }
        return;
      }
      const res = await container.chat.summarizeAllMemoryWithAi({
        providerId,
        model,
        onStatus: (s) => setStatus(s),
      });
      if (res.count === 0) {
        setNotice('Koi nayi chat nahi mili — sab already summarized hai.');
      } else {
        setNotice(`${res.count} chat(s) summarize ho gaye — ${res.blocks} blocks memory me save hue (${res.pinned} long-term).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Keep the retry picker OPEN so a failed "retry with another model" run
      // doesn't close the picker and force the user to re-open it.
    } finally {
      setRunning(false);
      setStatus('');
    }
  }

  async function loadCatalog(providerId: string) {
    const config = container.providerSettings.getProviderById(providerId);
    if (!config || config.hidden) return;
    try {
      setCatalog(await container.modelCache.getModels(config));
    } catch {
      setCatalog([]);
    }
  }

  function openRetryPicker() {
    haptic();
    setShowRetryPicker((v) => {
      const opening = !v;
      if (opening) {
        // Only reset + prime the picker when opening; closing leaves state
        // alone so a failed run doesn't wipe the user's selection.
        setRetryProviderId(providers[0]?.id ?? '');
        setRetryModel('');
        setCatalog([]);
        if (providers[0]?.id) void loadCatalog(providers[0].id);
      }
      return opening;
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-l/10 text-l">
            <Brain size={16} />
          </span>
          <p className="text-sm font-semibold text-text">Summarize all memory</p>
        </div>
        <span className="font-mono text-[10px] text-muted">
          {pending > 0 ? `${pending} unread chat(s)` : 'sab ready'}
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        AI ek hi baar mein saari unread chats padhega, purani 7-din ki memory ko continuity ke liye dekhega,
        aur chhote-chhote blocks (max 8 lines, '----' se alag) mein condense karega. Jo chat abhi kholi hai woh
        internal rehti hai — summarize nahi hoti. Ek baar ho jaye toh wahi chat dobara kabhi nahi padhi jaati.
      </p>

      <button
        type="button"
        className="btn w-full justify-center text-xs"
        onClick={() => void run()}
        disabled={running}
      >
        {running ? (
          <>
            <span className="spinner" aria-hidden="true" />
            {status || 'Summarize ho raha hai…'}
          </>
        ) : (
          <>
            <Sparkles size={14} /> {pending > 0 ? `Poori memory ek saath summarize karo (${pending})` : 'Poori memory ek saath summarize karo'}
          </>
        )}
      </button>

      {status && running && (
        <p className="mt-2 text-[11px] text-muted" role="status">
          {status}
        </p>
      )}

      {notice && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-success/25 bg-success/10 px-2.5 py-2 text-[11px] text-text" role="status">
          <Check size={13} className="mt-0.5 shrink-0 text-success" />
          {notice}
        </p>
      )}

      {error && (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger" role="alert">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn min-h-8 px-2.5 py-1 text-[11px]" onClick={() => void run()} disabled={running}>
              <RefreshCw size={12} /> Retry now
            </button>
            <button type="button" className="btn btn-ghost min-h-8 px-2.5 py-1 text-[11px]" onClick={openRetryPicker} disabled={running}>
              <ChevronDown size={12} /> Retry with another model
            </button>
          </div>
        </div>
      )}

      {showRetryPicker && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-panel-raised p-3">
          <label className="block">
            <span className="field-label">Provider</span>
            <select
              className="field"
              value={retryProviderId}
              onChange={(e) => {
                setRetryProviderId(e.target.value);
                setRetryModel('');
                setCatalog([]);
                void loadCatalog(e.target.value);
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.id === active?.id ? ' (active)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label flex items-center justify-between">
              <span>Model</span>
              {retryProviderId && (
                <button
                  type="button"
                  onClick={() => void loadCatalog(retryProviderId)}
                  className="font-normal text-muted underline-offset-2 hover:text-text hover:underline"
                >
                  catalog dikhao
                </button>
              )}
            </span>
            <input
              list="memory-summary-model-catalog"
              value={retryModel}
              onChange={(e) => setRetryModel(e.target.value)}
              placeholder="Khaali = provider default"
              className="field"
            />
            <datalist id="memory-summary-model-catalog">
              {catalog.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </label>
          <button
            type="button"
            className="btn w-full justify-center text-[11px]"
            onClick={() => void run(retryProviderId || null, retryModel || null)}
            disabled={running}
          >
            <RefreshCw size={12} /> {running ? 'Retry ho raha hai…' : 'Is model se retry karo'}
          </button>
        </div>
      )}
    </div>
  );
}

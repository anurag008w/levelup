import { useState } from 'react';
import { Check, Plug, Plus, Smartphone, X } from 'lucide-react';
import type { ProviderConfig, ProviderId, ThinkingLevel } from '../core/domain/llm';
import { providerLabel } from '../infra/ai/provider-factory';

const OPTIONS: { id: ProviderId; label: string; hint: string; browser: boolean; mobile: boolean }[] = [
  { id: 'openrouter', label: 'OpenRouter', hint: 'Most models, one key', browser: true, mobile: true },
  { id: 'gemini', label: 'Gemini', hint: "Google's models", browser: true, mobile: true },
  { id: 'opencode', label: 'OpenCode Zen', hint: 'Coding-tuned models', browser: false, mobile: true },
  { id: 'openai-compatible', label: 'Custom', hint: 'Any OpenAI-compatible endpoint', browser: true, mobile: true },
];

const THINKING_LEVELS: Array<{ value: ThinkingLevel | ''; label: string }> = [
  { value: '', label: 'Auto' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export default function AddProviderForm({ onAdd }: { onAdd: (c: ProviderConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<ProviderId>('openrouter');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [thinking, setThinking] = useState<ThinkingLevel | ''>('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost mt-2 w-full gap-2 border-dashed py-3 text-sm font-semibold text-muted"
      >
        <Plus size={16} />
        Add provider
      </button>
    );
  }

  const selected = OPTIONS.find((o) => o.id === id) ?? OPTIONS[0];

  return (
    <div className="card mt-2 p-4 fade-up">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-display text-base font-bold">Add provider</p>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Provider</span>
          <div className="grid gap-1.5">
            {OPTIONS.map((o) => {
              const isSelected = o.id === id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setId(o.id)}
                  aria-pressed={isSelected}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor: isSelected ? 'var(--color-l)' : 'var(--color-border)',
                    background: isSelected ? 'rgba(163,19,19,0.1)' : 'var(--color-panel-raised)',
                  }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ background: isSelected ? 'rgba(163,19,19,0.18)' : 'var(--color-surface-3)', color: isSelected ? 'var(--color-l)' : 'var(--color-muted)' }}
                  >
                    <Plug size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">{o.label}</span>
                    <span className="block truncate text-xs text-muted">{o.hint}</span>
                  </span>
                  {!o.browser && (
                    <span className="chip shrink-0 gap-1 !py-0.5 !text-[9px]" title="Mobile app only">
                      <Smartphone size={9} /> App only
                    </span>
                  )}
                  {isSelected && <Check size={16} color="var(--color-l)" className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">API key</span>
          <input
            className="field text-sm"
            type="password"
            value={apiKey}
            placeholder={id === 'gemini' ? 'AIza...' : 'sk-...'}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>

        {id === 'openai-compatible' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Base URL</span>
            <input
              className="field text-sm"
              value={baseUrl}
              placeholder="https://your-endpoint.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Default model (optional)</span>
          <input className="field text-sm" value={model} placeholder="gpt-4o-mini" onChange={(e) => setModel(e.target.value)} />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Thinking level</span>
          <div className="flex flex-wrap gap-1.5">
            {THINKING_LEVELS.map((l) => (
              <button
                key={l.value || 'auto'}
                type="button"
                className="filter-chip"
                aria-pressed={thinking === l.value}
                onClick={() => setThinking(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-dim">
            Sirf reasoning/thinking-support wale models par asar karta hai (OpenAI o-series, Gemini thinking, OpenRouter).
          </span>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            className="btn btn-primary flex-1 justify-center text-sm font-bold"
            onClick={() => {
              onAdd({
                id,
                label: providerLabel(id),
                baseUrl: baseUrl || undefined,
                apiKey: apiKey || undefined,
                model: model || undefined,
                thinking: thinking || undefined,
                enabled: true,
              });
              setOpen(false);
              setModel('');
              setApiKey('');
              setBaseUrl('');
              setThinking('');
            }}
          >
            Add {selected.label}
          </button>
          <button className="btn btn-ghost px-4 text-sm" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

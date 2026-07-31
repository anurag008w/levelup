import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ProviderConfig, ProviderId, ThinkingLevel } from '../core/domain/llm';
import { providerLabel } from '../infra/ai/provider-factory';

const OPTIONS: { id: ProviderId; label: string }[] = [
  { id: 'openrouter', label: 'OpenRouter (browser + mobile ✓)' },
  { id: 'gemini', label: 'Gemini (browser + mobile ✓)' },
  { id: 'opencode', label: 'OpenCode Zen (browser ✗, mobile ✓)' },
  { id: 'openai-compatible', label: 'Custom (OpenAI-compatible)' },
];

const THINKING_LEVELS: Array<{ value: ThinkingLevel | ''; label: string }> = [
  { value: '', label: 'Auto (provider default)' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export default function AddProviderForm({ onAdd }: { onAdd: (c: ProviderConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<ProviderId>('openrouter');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState<ThinkingLevel | ''>('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost mt-2 w-full border border-dashed py-3 text-sm font-semibold text-muted"
      >
        <Plus size={15} />
        Add provider
      </button>
    );
  }

  return (
    <div className="card mt-2 p-4 text-xs fade-up">
      <p className="mb-2 font-display text-sm font-bold">Add provider</p>
      <div className="space-y-2">
        <label className="block">
          <span className="mb-0.5 block text-muted">Provider</span>
          <select className="field" value={id} onChange={(e) => setId(e.target.value as ProviderId)}>
            {OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-muted">Default model (optional)</span>
          <input className="field" value={model} placeholder="gpt-4o-mini" onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-muted">Thinking level (default)</span>
          <select className="field" value={thinking} onChange={(e) => setThinking(e.target.value as ThinkingLevel | '')}>
            {THINKING_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[10px] text-muted">
            Sirf reasoning/thinking-support wale models par asar karta hai (OpenAI o-series, Gemini thinking, OpenRouter).
          </span>
        </label>
        <div className="flex gap-2 pt-1">
          <button
            className="btn btn-primary px-4 py-2 text-xs font-bold"
            onClick={() => {
              onAdd({ id, label: providerLabel(id), model: model || undefined, thinking: thinking || undefined, enabled: true });
              setOpen(false);
              setModel('');
              setThinking('');
            }}
          >
            Add
          </button>
          <button className="btn btn-ghost px-4 py-2 text-xs" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

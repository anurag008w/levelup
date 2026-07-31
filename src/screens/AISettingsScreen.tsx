import { useState } from 'react';
import { Bot, Check, Plug, RefreshCw, ShieldCheck, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { AppState } from '../types';
import type { ProviderConfig, ModelInfo } from '../core/domain/llm';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import EmptyState from '../components/ui/EmptyState';
import AddProviderForm from '../components/AddProviderForm';

export default function AISettingsScreen({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const settings = state.aiSettings;
  const providers = Object.values(settings.providers);
  const hiddenEnabled = container.providerSettings.isHiddenEnabled();
  const effectiveActive = container.providerSettings.getActiveProvider()?.id ?? null;
  const aiEnabled = settings.aiEnabled;

  function setAiEnabled(enabled: boolean) {
    update((s) => ({ ...s, aiSettings: { ...s.aiSettings, aiEnabled: enabled } }));
  }

  function upsert(config: ProviderConfig) {
    update((s) => {
      const usable = container.providerSettings.isUsable(config);
      const activeProviderId = usable && s.aiSettings.activeProviderId === null ? config.id : s.aiSettings.activeProviderId;
      return {
        ...s,
        aiSettings: {
          ...s.aiSettings,
          aiEnabled: s.aiSettings.aiEnabled || usable,
          activeProviderId,
          providers: { ...s.aiSettings.providers, [config.id]: config },
        },
      };
    });
  }

  function setActive(id: string | null) {
    update((s) => ({ ...s, aiSettings: { ...s.aiSettings, activeProviderId: id } }));
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="HUMAN OS"
        title="AI Engine"
        subtitle="Plan recommendations, memory aur daily summaries ke liye provider."
      />

      <div className="gradient-border mb-4 rounded-2xl p-px">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-panel p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-grid">
              <Bot size={17} color="var(--color-light)" />
            </span>
            <div>
              <p className="font-display text-sm font-bold">AI Planning</p>
              <p className="text-[11px] leading-snug text-muted">Band karo to deterministic plans chalti hain.</p>
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer">
            <input type="checkbox" className="peer sr-only" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            <span className="h-6 w-11 rounded-full bg-grid transition-colors peer-checked:bg-[rgba(79,209,197,0.5)]" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-muted transition-transform peer-checked:translate-x-5 peer-checked:bg-l" />
          </label>
        </div>
      </div>

      {hiddenEnabled && (
        <div className="card mb-4 flex items-center gap-2 p-3.5 text-xs text-muted">
          <ShieldCheck size={15} color="var(--color-light)" />
          <span>
            Default provider environment se configured hai — <span className="text-text">enable karke use karo</span>, API key is machine par hidden hai.
          </span>
        </div>
      )}

      <div className="mb-2">
        <SectionHeader
          icon={<Plug size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title="Providers"
          meta={providers.filter((p) => p.enabled).length > 0 ? `${providers.filter((p) => p.enabled).length} on` : 'none on'}
        />
      </div>

      {providers.length === 0 && !hiddenEnabled && (
        <div className="mb-4">
          <EmptyState
            icon={<WifiOff size={24} color="var(--color-muted)" />}
            title="Koi provider configure nahi"
            hint="Neeche se OpenRouter, Gemini ya custom provider add karo — phir Test dabake verify karo."
          />
        </div>
      )}

      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          config={p}
          active={effectiveActive === p.id}
          onActive={() => setActive(p.id)}
          onUpdate={upsert}
          onRemove={() =>
            update((s) => {
              const providers = { ...s.aiSettings.providers };
              delete providers[p.id];
              return { ...s, aiSettings: { ...s.aiSettings, providers, activeProviderId: settings.activeProviderId === p.id ? null : s.aiSettings.activeProviderId } };
            })
          }
        />
      ))}

      <AddProviderForm onAdd={(config) => upsert(config)} />
    </div>
  );
}

function ProviderCard({
  config,
  active,
  onActive,
  onUpdate,
  onRemove,
}: {
  config: ProviderConfig;
  active: boolean;
  onActive: () => void;
  onUpdate: (c: ProviderConfig) => void;
  onRemove: () => void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; latencyMs?: number; message?: string } | null>(null);

  async function loadModels(force = false) {
    setLoadingModels(true);
    setModelsError('');
    try {
      const list = await container.modelCache.getModels(config, force);
      setModels(list);
      if (list.length === 0) setModelsError('Provider ne koi model list nahi di. Base URL + API key check karo.');
    } catch (err) {
      setModels([]);
      setModelsError(shortError(err));
    } finally {
      setLoadingModels(false);
    }
  }

  async function runHealth() {
    const res = await container.providerSettings.healthCheck(config);
    setHealth({ ok: res.ok, latencyMs: res.latencyMs, message: res.message });
  }

  const usable = container.providerSettings.isUsable(config);
  const missingKey = !config.apiKey;
  const sorted = models ? [...models].sort((a, b) => Number(b.isFree) - Number(a.isFree) || a.name.localeCompare(b.name)) : null;
  const healthMsg = health && !health.ok && health.message ? health.message : null;
  const zenCorsHint = isZenId(config.id) && (!!modelsError || healthMsg !== null);

  return (
    <div
      className="card mb-3 p-4 transition-colors"
      style={{ borderColor: active ? 'var(--color-light-dim)' : 'var(--color-border)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onActive}
            className={`chip shrink-0 font-mono font-semibold transition-colors ${active ? '' : 'hover:border-light hover:text-text'}`}
            style={active ? { borderColor: 'var(--color-light)', color: 'var(--color-light)' } : undefined}
          >
            {active ? 'Active' : 'Set active'}
          </button>
          <p className="truncate font-display text-sm font-bold">{config.label}</p>
          {usable && <Check size={14} color="var(--color-success)" />}
          {config.enabled && !usable && <WifiOff size={13} color="var(--color-muted)" />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onRemove}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            aria-label={`Remove ${config.label}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] text-muted">Enabled</span>
        <label className="relative inline-flex cursor-pointer">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={config.enabled}
            onChange={(e) => onUpdate({ ...config, enabled: e.target.checked })}
          />
          <span className="h-5 w-9 rounded-full bg-grid transition-colors peer-checked:bg-[rgba(79,209,197,0.5)]" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-l" />
        </label>
      </div>

      <div className="space-y-2 text-xs">
        <Field label="API key">
          <input
            type="password"
            className="field"
            value={config.apiKey ?? ''}
            placeholder="sk-..."
            onChange={(e) => onUpdate({ ...config, apiKey: e.target.value })}
          />
        </Field>
        <Field label="Base URL">
          <div className="space-y-1">
            <input
              className="field"
              value={config.baseUrl ?? ''}
              placeholder={placeholderFor(config.id)}
              onChange={(e) => onUpdate({ ...config, baseUrl: e.target.value })}
            />
            <button className="btn btn-ghost px-2.5 py-1 text-[11px]" onClick={() => onUpdate({ ...config, baseUrl: undefined })}>
              Default URL use karo
            </button>
          </div>
        </Field>
        <Field label="Model">
          <div className="space-y-1.5">
            <input
              className="field"
              value={config.model ?? ''}
              placeholder="e.g. gpt-4o-mini"
              onChange={(e) => onUpdate({ ...config, model: e.target.value })}
            />
            {sorted && sorted.length > 0 && (
              <select className="field" value={config.model ?? ''} onChange={(e) => onUpdate({ ...config, model: e.target.value })}>
                <option value="">— pick from catalog —</option>
                {sorted.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.isFree ? 'FREE ' : ''}
                    {m.name} · {m.contextLength ? `${Math.round(m.contextLength / 1000)}k ctx` : 'ctx?'}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={() => loadModels()} className="btn btn-ghost px-2.5 py-1 text-[11px]">
            <RefreshCw size={12} className={loadingModels ? 'animate-spin' : ''} /> Models
          </button>
          <button onClick={() => loadModels(true)} className="btn btn-ghost px-2.5 py-1 text-[11px]">
            Refresh catalog
          </button>
          <button onClick={runHealth} className="btn btn-ghost px-2.5 py-1 text-[11px]">
            <Plug size={12} /> Test
          </button>
          {health && (
            <span className={`flex items-center gap-1 font-mono text-[11px] ${health.ok ? 'text-success' : 'text-danger'}`}>
              {health.ok ? <Wifi size={11} /> : <WifiOff size={11} />}
              {health.ok ? `ok (${health.latencyMs}ms)` : 'failed'}
            </span>
          )}
        </div>
        {!usable && (
          <p className="text-[11px] text-muted">
            {missingKey ? 'API key daalo — tabhi test/models kaam karenge.' : 'Provider usable nahi — base URL check karo.'}
          </p>
        )}
        <p className="break-all font-mono text-[10px] text-muted">→ GET {resolvedModelsUrl(config.id, config.baseUrl)}</p>
        {zenCorsHint && (
          <p className="text-[11px] leading-relaxed text-light">
            OpenCode Zen browser mein direct nahi chalta (uske server par browser-CORS support nahi hai) — isliye preview
            mein fail hoga. Mobile app (APK) mein native HTTP se chalega. Preview ke liye OpenRouter ya Gemini use karo.
          </p>
        )}
        {modelsError && <p className="break-words text-[11px] text-danger">models: {modelsError}</p>}
        {healthMsg && <p className="break-words text-[11px] text-danger">test: {healthMsg}</p>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-muted">{label}</span>
      {children}
    </label>
  );
}

function placeholderFor(id: string): string {
  switch (id) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com';
    case 'opencode':
      return 'https://opencode.ai/zen/v1';
    default:
      return 'https://your-server/v1';
  }
}

function isZenId(id: string): boolean {
  return id === 'opencode' || id === 'opencode-zen';
}

function defaultBaseUrl(id: string): string {
  switch (id) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com';
    case 'opencode':
    case 'opencode-zen':
      return 'https://opencode.ai/zen/v1';
    default:
      return '';
  }
}

function resolvedModelsUrl(id: string, baseUrl: string | undefined): string {
  const base = (baseUrl || defaultBaseUrl(id)).replace(/\/+$/, '');
  if (!base) return '(base URL missing)';
  if (id === 'gemini') return `${base}/v1beta/models`;
  return `${base}/models`;
}

function shortError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
  }
  return String(err);
}

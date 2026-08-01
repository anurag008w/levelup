import { Suspense, useState, lazy } from 'react';
import { Check, ChevronRight, KeyRound, Plug, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { AppState } from '../types';
import type { ProviderConfig, ModelInfo } from '../core/domain/llm';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import EmptyState from '../components/ui/EmptyState';
import AddProviderForm from '../components/AddProviderForm';
import { haptic } from '../lib/haptics';

const ChatSettingsScreen = lazy(() => import('./ChatSettingsScreen'));

export default function AISettingsScreen({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const settings = state.aiSettings;
  const providers = Object.values(settings.providers);
  const hiddenEnabled = container.providerSettings.isHiddenEnabled();
  const effectiveActive = container.providerSettings.getActiveProvider()?.id ?? null;
  const aiEnabled = settings.aiEnabled;

  // Navigation state for sub-screens
  const [showChatSettings, setShowChatSettings] = useState(false);

  // Chat Settings sub-screen
  if (showChatSettings) {
    return (
      <Suspense fallback={<div className="screen"><ScreenHeader eyebrow="" title="Loading..." /></div>}>
        <ChatSettingsScreen state={state} update={update} onBack={() => setShowChatSettings(false)} />
      </Suspense>
    );
  }

  function setAiEnabled(enabled: boolean) {
    haptic();
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
    haptic();
    update((s) => ({ ...s, aiSettings: { ...s.aiSettings, activeProviderId: id } }));
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="CONTROL CENTER"
        title="Settings"
        subtitle="AI planning, chat memory aur provider connections ek premium command center mein."
      />

      <section className="relative mb-4 overflow-hidden rounded-[1.7rem] border border-border bg-panel p-4 shadow-raised">
        <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-l/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="badge mb-3" style={{ backgroundColor: aiEnabled ? 'rgba(138,154,91,0.13)' : 'rgba(92,88,78,0.18)', color: aiEnabled ? 'var(--color-success)' : 'var(--color-muted)' }}>
              <Sparkles size={11} /> {aiEnabled ? 'AI online' : 'Manual mode'}
            </span>
            <h2 className="font-display text-2xl font-bold leading-tight">Personalization that stays in your control.</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">Provider, model, memory aur chat behavior ko tune karo. Disable karne par app stable deterministic planning use karega.</p>
          </div>
          <label className="toggle mt-1" title="Toggle AI planning">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} aria-label="Toggle AI planning" />
            <span className="track">
              <span className="thumb" />
            </span>
          </label>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Providers" value={String(providers.length)} />
          <MiniStat label="Enabled" value={String(providers.filter((p) => p.enabled).length)} />
          <MiniStat label="Active" value={effectiveActive ? 'Set' : 'None'} />
        </div>
      </section>

      {hiddenEnabled && (
        <div className="card mb-4 flex items-start gap-2.5 p-3.5 text-sm text-muted">
          <ShieldCheck size={16} color="var(--color-light)" className="mt-0.5 shrink-0" />
          <span>
            Default provider environment se configured hai — <span className="font-semibold text-text">enable karke use karo</span>, API key is machine par hidden hai.
          </span>
        </div>
      )}

      <button type="button" onClick={() => setShowChatSettings(true)} className="card card-press mb-4 flex w-full items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-l/10 text-l">
            <SlidersHorizontal size={19} />
          </span>
          <div>
            <p className="font-display text-[15px] font-bold">Chat Experience</p>
            <p className="text-xs leading-snug text-muted">Memory, temperature, system prompt aur coaching tone.</p>
          </div>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </button>

      <div className="mb-2.5">
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-dim">{label}</p>
      <p className="mt-1 font-display text-lg font-bold">{value}</p>
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
    <div className="gradient-border mb-3 rounded-[1.35rem] p-px" style={{ background: active ? undefined : 'var(--color-border)' }}>
      <div className="rounded-[calc(1.35rem-1px)] bg-panel p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: active ? 'rgba(79,209,197,0.14)' : 'var(--color-panel-raised)' }}
          >
            {active ? <Sparkles size={16} color="var(--color-l)" /> : <KeyRound size={16} color="var(--color-muted)" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-bold">{config.label}</p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              {usable ? (
                <>
                  <Wifi size={11} color="var(--color-success)" /> Ready
                </>
              ) : (
                <>
                  <WifiOff size={11} color="var(--color-muted-dim)" /> Not usable
                </>
              )}
              {health && health.ok && <span className="text-success">· {health.latencyMs}ms</span>}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onActive}
            className={`badge shrink-0 cursor-pointer transition-colors ${active ? '' : 'hover:!text-text'}`}
            style={active ? { backgroundColor: 'rgba(79,209,197,0.16)', color: 'var(--color-l)' } : { backgroundColor: 'var(--color-panel-raised)', color: 'var(--color-muted)' }}
            aria-pressed={active}
          >
            {active ? <Check size={10} /> : null}
            {active ? 'Active' : 'Set active'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="icon-btn"
            style={{ minWidth: '2rem', minHeight: '2rem' }}
            aria-label={`Remove ${config.label}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* enabled toggle */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-bg/60 px-3 py-2.5">
        <span className="text-sm text-muted">Enabled</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onUpdate({ ...config, enabled: e.target.checked })}
            aria-label={`Toggle ${config.label}`}
          />
          <span className="track">
            <span className="thumb" />
          </span>
        </label>
      </div>

      <div className="space-y-3 text-sm">
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
          <div className="space-y-1.5">
            <input
              className="field"
              value={config.baseUrl ?? ''}
              placeholder={placeholderFor(config.id)}
              onChange={(e) => onUpdate({ ...config, baseUrl: e.target.value })}
            />
            <button className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs" onClick={() => onUpdate({ ...config, baseUrl: undefined })}>
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

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => loadModels()} className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs">
            <RefreshCw size={12} className={loadingModels ? 'animate-spin' : ''} /> Models
          </button>
          <button type="button" onClick={() => loadModels(true)} className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs">
            Refresh catalog
          </button>
          <button type="button" onClick={runHealth} className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs">
            <Plug size={12} /> Test
          </button>
          {health && (
            <span className={`flex items-center gap-1 font-mono text-xs ${health.ok ? 'text-success' : 'text-danger'}`}>
              {health.ok ? <Wifi size={11} /> : <WifiOff size={11} />}
              {health.ok ? `ok (${health.latencyMs}ms)` : 'failed'}
            </span>
          )}
        </div>

        {!usable && (
          <p className="text-xs text-muted">
            {missingKey ? 'API key daalo — tabhi test/models kaam karenge.' : 'Provider usable nahi — base URL check karo.'}
          </p>
        )}

        <p className="break-all font-mono text-[10px] text-muted-dim">→ GET {resolvedModelsUrl(config.id, config.baseUrl)}</p>

        {zenCorsHint && (
          <p className="text-xs leading-relaxed text-light">
            OpenCode Zen browser mein direct nahi chalta (uske server par browser-CORS support nahi hai) — isliye preview
            mein fail hoga. Mobile app (APK) mein native HTTP se chalega. Preview ke liye OpenRouter ya Gemini use karo.
          </p>
        )}
        {modelsError && <p className="break-words text-xs text-danger">models: {modelsError}</p>}
        {healthMsg && <p className="break-words text-xs text-danger">test: {healthMsg}</p>}
      </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
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

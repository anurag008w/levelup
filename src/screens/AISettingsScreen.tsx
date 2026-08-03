import { Suspense, useRef, useState, lazy } from 'react';
import { Check, ChevronRight, Database, Download, KeyRound, ListChecks, Plug, RefreshCw, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, Wifi, WifiOff } from 'lucide-react';
import type { AppState } from '../types';
import type { ProviderConfig, ModelInfo } from '../core/domain/llm';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import EmptyState from '../components/ui/EmptyState';
import AddProviderForm from '../components/AddProviderForm';
import { haptic } from '../lib/haptics';
import { formatBytes, normalizeChatSessions, parseBackup, summarizeBackup, type BackupScope, type BackupSummary } from '../features/backup/backup.service';
import { normalizeState } from '../infra/storage/state-repository';

const ChatSettingsScreen = lazy(() => import('./ChatSettingsScreen'));

export default function AISettingsScreen({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const settings = state.aiSettings;
  const providers = Object.values(settings.providers);
  const hiddenEnabled = container.providerSettings.isHiddenEnabled();
  const effectiveActive = container.providerSettings.getActiveProvider()?.id ?? null;
  const aiEnabled = settings.aiEnabled;

  // Navigation state for sub-screens
  const [showChatSettings, setShowChatSettings] = useState(false);

  // Data & Backup state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupScope, setBackupScope] = useState<BackupScope>('full');
  const [backupStatus, setBackupStatus] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ json: string; fileName: string; preview: BackupSummary } | null>(null);
  const [importing, setImporting] = useState(false);

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

  function handleExport() {
    haptic();
    try {
      const json = container.backup.export(backupScope);
      const fileName = `levelup-backup-${backupScope === 'full' ? '' : `${backupScope}-`}${new Date().toISOString().slice(0, 10)}.json`;
      downloadTextFile(json, fileName);
      const payload = parseBackup(json);
      const preview = summarizeBackup(
        normalizeState(payload.data.state),
        payload.scope === 'full' ? container.chat.listSessions() : [],
        json.length,
        payload.scope,
      );
      setBackupStatus({ type: 'ok', text: `Backup download ho gaya — ${formatBytes(preview.bytes)} · ${describeSummary(preview)}` });
    } catch (err) {
      setBackupStatus({ type: 'error', text: shortError(err) });
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    haptic();
    try {
      const text = await file.text();
      const payload = parseBackup(text);
      const preview = summarizeBackup(
        normalizeState(payload.data.state),
        payload.scope === 'full' ? normalizeChatSessions(payload.data.chat) : [],
        text.length,
        payload.scope,
      );
      setPendingImport({ json: text, fileName: file.name, preview });
      setBackupStatus(null);
    } catch (err) {
      setPendingImport(null);
      setBackupStatus({ type: 'error', text: shortError(err) });
    }
  }

  function confirmImport() {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const summary = container.backup.import(pendingImport.json);
      // Re-read the freshly restored state so every mounted screen re-renders,
      // and let the chat screen swap in the restored sessions too (full only —
      // scoped imports never touch chat, so the event is harmless either way).
      update(() => container.store.get());
      window.dispatchEvent(new Event('levelup:backup-imported'));
      setBackupStatus({ type: 'ok', text: `Backup restore ho gaya — ${describeSummary(summary)}` });
      setPendingImport(null);
    } catch (err) {
      setBackupStatus({ type: 'error', text: shortError(err) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader eyebrow="CONTROL CENTER" title="Settings" subtitle="AI planning, chat memory aur provider connections — sab yahan." />

      <section className="relative mb-5 overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-24 h-44 w-44 rounded-full bg-l/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-start justify-between gap-4">
          <span
            className="badge"
            style={{ backgroundColor: aiEnabled ? 'rgba(138,154,91,0.13)' : 'rgba(92,88,78,0.18)', color: aiEnabled ? 'var(--color-success)' : 'var(--color-muted)' }}
          >
            <Sparkles size={11} /> {aiEnabled ? 'AI online' : 'Manual mode'}
          </span>
          <label className="toggle" title="Toggle AI planning">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} aria-label="Toggle AI planning" />
            <span className="track">
              <span className="thumb" />
            </span>
          </label>
        </div>
        <p className="relative mt-2.5 max-w-sm text-sm leading-relaxed text-muted">
          Disable karne par app stable deterministic planning use karega — data hamesha local rehta hai.
        </p>
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
          icon={<ListChecks size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title="Curriculum"
          meta="customization"
        />
      </div>

      <div className="card mb-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-l/10 text-l">
              <ListChecks size={19} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold">Advanced curriculum controls</p>
              <p className="text-xs leading-snug text-muted">
                ON rahne par Levels tab mein Add Block, Export, Import aur saare add/edit/delete buttons dikhte hain — tasks,
                habits aur blocks apne hisaab se customize kar sakte ho. OFF karne par Levels tab simple read-only view ban
                jata hai (normal user ke liye clean).
              </p>
            </div>
          </div>
          <label className="toggle mt-1 shrink-0" title="Toggle advanced curriculum controls">
            <input
              type="checkbox"
              checked={state.curriculumEditing}
              onChange={(e) => {
                haptic();
                update((s) => ({ ...s, curriculumEditing: e.target.checked }));
              }}
              aria-label="Toggle advanced curriculum controls"
            />
            <span className="track">
              <span className="thumb" />
            </span>
          </label>
        </div>
      </div>

      <div className="mb-2.5">
        <SectionHeader
          icon={<Database size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title="Data & Backup"
          meta="export / import"
        />
      </div>

      <div className="card mb-4 p-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-l/10 text-l">
            <Database size={19} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold">Sab data, ek file mein</p>
            <p className="text-xs leading-snug text-muted">Full backup mein plan, tasks, progress, logs, memory, chat sessions aur providers sab aata hai. Tasks / Levels options sirf wohi data export karte hain.</p>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {([
            { id: 'full', label: 'Full', hint: 'sab kuch' },
            { id: 'tasks', label: 'Tasks', hint: 'tasks + habits + plans' },
            { id: 'levels', label: 'Levels', hint: 'levels + reviews' },
          ] as { id: BackupScope; label: string; hint: string }[]).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                haptic(6);
                setBackupScope(opt.id);
              }}
              className="min-h-12 rounded-xl border px-2 py-1.5 text-center transition-colors"
              style={
                backupScope === opt.id
                  ? { borderColor: 'var(--color-l)', backgroundColor: 'rgba(138,154,91,0.12)' }
                  : { borderColor: 'var(--color-border)', backgroundColor: 'transparent' }
              }
            >
              <span className="block text-xs font-bold text-text">{opt.label}</span>
              <span className="block text-[10px] text-muted">{opt.hint}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={handleExport} className="btn btn-primary min-h-10 gap-2">
            <Download size={15} /> Export
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-ghost min-h-10 gap-2">
            <Upload size={15} /> Import
          </button>
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onFileSelected} aria-label="Import backup file" />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-dim">
          Full backup file mein API keys bhi hongi (providers section) — file ko safe jagah rakhna. Model catalog cache (API se refetch hota hai) export mein nahi aata. Env-based provider machine-specific hai, wo export nahi hota.
        </p>

        {backupStatus && (
          <p
            className="mt-3 rounded-xl px-3 py-2 text-xs"
            style={
              backupStatus.type === 'error'
                ? { backgroundColor: 'rgba(201,87,87,0.12)', color: 'var(--color-danger)' }
                : backupStatus.type === 'ok'
                  ? { backgroundColor: 'rgba(138,154,91,0.13)', color: 'var(--color-success)' }
                  : { backgroundColor: 'rgba(79,209,197,0.13)', color: 'var(--color-l)' }
            }
          >
            {backupStatus.text}
          </p>
        )}

        {pendingImport && (
          <div className="mt-3 rounded-xl border border-border bg-bg/60 p-3">
            <p className="flex items-start gap-2 text-xs font-semibold text-text">
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
              "{pendingImport.fileName}" restore karna hai?
              {pendingImport.preview.scope === 'full'
                ? ' Abhi ka saara data replace ho jayega.'
                : pendingImport.preview.scope === 'tasks'
                  ? ' Sirf tasks/habits/plans ka data merge hoga — baaki sab waisa hi rahega.'
                  : ' Sirf levels/reviews ka data merge hoga — baaki sab waisa hi rahega.'}
            </p>
            <p className="mt-1 text-[11px] text-muted">{describeSummary(pendingImport.preview)}</p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => setPendingImport(null)} className="btn btn-ghost min-h-9 flex-1 text-xs">
                Cancel
              </button>
              <button type="button" onClick={confirmImport} disabled={importing} className="btn min-h-9 flex-1 border border-danger/40 text-xs text-danger" style={{ backgroundColor: 'rgba(201,87,87,0.1)' }}>
                {importing ? 'Restoring…' : 'Confirm Import'}
              </button>
            </div>
          </div>
        )}
      </div>

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
            style={{ backgroundColor: active ? 'rgba(138,154,91,0.14)' : 'var(--color-panel-raised)' }}
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
            style={active ? { backgroundColor: 'rgba(138,154,91,0.16)', color: 'var(--color-l)' } : { backgroundColor: 'var(--color-panel-raised)', color: 'var(--color-muted)' }}
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
            onChange={(e) => onUpdate({ ...config, apiKey: e.target.value || undefined })}
          />
        </Field>
        <Field label="Base URL">
          <input
            className="field"
            value={config.baseUrl ?? ''}
            placeholder={placeholderFor(config.id)}
            onChange={(e) => onUpdate({ ...config, baseUrl: e.target.value || undefined })}
          />
        </Field>
        <Field label="Model">
          <div className="space-y-1.5">
            <input
              className="field"
              value={config.model ?? ''}
              placeholder="e.g. gpt-4o-mini"
              onChange={(e) => onUpdate({ ...config, model: e.target.value || undefined })}
            />
            {sorted && sorted.length > 0 && (
              <select className="field" value={config.model ?? ''} onChange={(e) => onUpdate({ ...config, model: e.target.value || undefined })}>
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

function downloadTextFile(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describeSummary(s: BackupSummary): string {
  if (s.scope === 'tasks') {
    return [
      `Tasks · ${s.state.dynamicTasks} custom tasks`,
      `${s.state.totalDone} tasks done`,
      `${s.state.planDays} din ke plans`,
      s.state.dynamicPhases.length > 0 ? `phases: ${s.state.dynamicPhases.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
  }
  if (s.scope === 'levels') {
    return [
      `Levels · ${s.state.clearedLevels} cleared`,
      `${s.state.weeklyReviews} weekly reviews`,
      `${s.state.monthlyAssessments} monthly assessments`,
    ].filter(Boolean).join(' · ');
  }
  const parts = [
    s.state.journeyStarted ? 'journey active' : 'journey abhi nahi',
    `${s.state.totalDone} tasks done`,
    `${s.state.dynamicTasks} custom tasks`,
    `${s.state.planDays} din ke plans`,
    s.state.dynamicPhases.length > 0 ? `phases: ${s.state.dynamicPhases.join(', ')}` : '',
    `${s.state.clearedLevels} levels cleared`,
    `${s.state.memoryEntries} memory entries`,
    `${s.chat.sessions} chats (${s.chat.messages} msgs)`,
  ];
  return parts.filter(Boolean).join(' · ');
}

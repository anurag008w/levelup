import type { ProviderConfig, ProviderId, HealthCheckResult } from '../../core/domain/llm';
import type { StateStore } from '../../core/ports/repositories';
import type { ProviderFactory } from '../../infra/ai/provider-factory';
import { buildHiddenDefaultConfig } from '../../infra/ai/provider-factory';
import { providerLabel } from '../../infra/ai/provider-factory';

/**
 * Manages provider configs (persisted in state) plus the hidden env default.
 * Secret values are only ever written to storage, never exposed through the
 * returned public views used by the UI.
 */
export class ProviderSettingsService {
  private readonly hiddenDefault: ProviderConfig | null;
  private readonly state: StateStore;
  private readonly factory: ProviderFactory;

  constructor(state: StateStore, factory: ProviderFactory) {
    this.state = state;
    this.factory = factory;
    this.hiddenDefault = buildHiddenDefaultConfig();
  }

  /** Public configs (hidden default's secret fields are stripped). */
  listProviders(): ProviderConfig[] {
    const all = this.allRaw();
    return all.map((p) => (p.hidden ? this.publicView(p) : p));
  }

  /** All stored providers (enabled or not) + hidden default, for pickers. */
  listStoredProviders(): ProviderConfig[] {
    const stored = Object.values(this.state.get().aiSettings.providers);
    const list = [...stored];
    if (this.hiddenDefault) list.unshift(this.hiddenDefault);
    return list.map((p) => (p.hidden ? this.publicView(p) : p));
  }

  /** Full raw configs for internal use (never handed to the UI). */
  allRaw(): ProviderConfig[] {
    const stored = Object.values(this.state.get().aiSettings.providers).filter((p) => p.enabled);
    const list = [...stored];
    if (this.hiddenDefault) list.unshift(this.hiddenDefault);
    return list;
  }

  getActiveProvider(): ProviderConfig | null {
    const all = this.allRaw();
    const activeId = this.state.get().aiSettings.activeProviderId;
    return all.find((p) => p.id === activeId && this.isUsable(p)) ?? all.find((p) => this.isUsable(p)) ?? null;
  }

  getProviderById(id: string): ProviderConfig | null {
    return this.allRaw().find((p) => p.id === id) ?? null;
  }

  /** A provider is usable when it is enabled, configured and not hidden-only-but-disabled. */
  isUsable(config: ProviderConfig): boolean {
    return config.enabled && this.factory.create(config).isConfigured();
  }

  isHiddenEnabled(): boolean {
    return this.hiddenDefault !== null;
  }

  isAiEnabled(): boolean {
    return this.state.get().aiSettings.aiEnabled && this.getActiveProvider() !== null;
  }

  setAiEnabled(enabled: boolean): void {
    const state = this.state.get();
    state.aiSettings.aiEnabled = enabled;
    this.state.save(state);
  }

  upsertProvider(config: ProviderConfig): void {
    const state = this.state.get();
    state.aiSettings.providers[config.id] = config;
    if (this.isUsable(config)) state.aiSettings.activeProviderId ??= config.id;
    this.state.save(state);
  }

  setActiveProvider(id: ProviderId): void {
    const state = this.state.get();
    state.aiSettings.activeProviderId = id;
    this.state.save(state);
  }

  removeProvider(id: ProviderId): void {
    const state = this.state.get();
    delete state.aiSettings.providers[id];
    if (state.aiSettings.activeProviderId === id) state.aiSettings.activeProviderId = null;
    this.state.save(state);
  }

  /** Live connectivity + latency probe for a config (used by the settings UI). */
  healthCheck(config: ProviderConfig): Promise<HealthCheckResult> {
    return this.factory.create(config).healthCheck();
  }

  /** View of a hidden provider that leaks no secret or model name. */
  private publicView(config: ProviderConfig): ProviderConfig {
    return {
      id: config.id,
      label: providerLabel(config.id),
      enabled: config.enabled,
      hidden: true,
      // Model ids are not secrets — they only power the optional model picker.
      models: config.models,
    };
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiLiveClient } from '../live-client';
import type { LiveSettingsConfig } from '../live-types';

// Review 7 (5087747147) behavioral regression tests — audio-ownership /
// startup-transaction semantics of the Live client, exercised through the REAL
// native-audio-route module against a mocked @capacitor/core (the repo's
// established pattern, see src/infra/ai/__tests__/http-native.test.ts).
// Mocking @capacitor/core (a node_module dependency) instead of the local
// module makes the REAL route/focus wrapper logic run, so the tests cover the
// production branch decisions, not a stand-in copy of them.

const native = vi.hoisted(() => ({
  isNative: vi.fn(),
  plugin: {
    setRoute: vi.fn(),
    resetRoute: vi.fn(),
    requestAudioFocus: vi.fn(),
    addListener: vi.fn(),
  },
}));

const genai = vi.hoisted(() => ({
  connect: vi.fn(),
  session: {
    sendRealtimeInput: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('@google/genai/web', () => ({
  GoogleGenAI: vi.fn(() => ({
    live: { connect: (...args: unknown[]) => genai.connect(...args) },
  })),
  Modality: { AUDIO: 'AUDIO', TEXT: 'TEXT' },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNative() },
  registerPlugin: () => native.plugin,
}));

const mockConfig: LiveSettingsConfig = {
  model: 'gemini-2.5-flash-native-audio-preview-09-2025',
  voice: 'Aoede',
  vadSensitivity: 'medium',
  videoFps: 1,
  screenFps: 1,
  defaultAudioRoute: 'speaker',
  playbackSpeed: 1.0,
  enable90DayTrack: true,
};

describe('Live audio ownership & startup transaction (review 7)', () => {
  beforeEach(() => {
    native.isNative.mockReset().mockReturnValue(true);
    native.plugin.setRoute.mockReset().mockResolvedValue({ route: 'speaker', deviceType: 'BUILTIN_SPEAKER' });
    native.plugin.resetRoute.mockReset().mockResolvedValue(undefined);
    native.plugin.requestAudioFocus.mockReset().mockResolvedValue({ granted: true, status: 'granted' });
    native.plugin.addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
    genai.connect.mockReset().mockResolvedValue(genai.session);
    genai.session.sendRealtimeInput.mockClear();
    genai.session.close.mockClear();
  });

  it('1. Handed-off pre-capture focus is never double-requested, and a prior pending reset settles BEFORE the new route (P0 stale-reset regression)', async () => {
    const client = new GeminiLiveClient(mockConfig);
    // A previous FAILED attempt left a native reset scheduled (e.g. the
    // overlay's rollback disconnect). Never discard it: connect()'s start
    // must keep the chain (skip=true keeps prior chains) and setupCallAudio()
    // must await it, or an orphaned native reset could abandon the new focus.
    client.disconnect(false);

    await client.connect('test-key', undefined, { audioFocusAlreadyGranted: true });

    // Inherited flag → NO second native focus request.
    expect(native.plugin.requestAudioFocus).not.toHaveBeenCalled();
    // P0 order guarantee: the stalled reset ran exactly once and settled
    // BEFORE the fresh route was applied (invocationCallOrder is global).
    expect(native.plugin.resetRoute.mock.invocationCallOrder.length).toBe(1);
    expect(native.plugin.resetRoute.mock.invocationCallOrder[0]).toBeLessThan(
      native.plugin.setRoute.mock.invocationCallOrder[0]);
    expect(client.getCurrentAudioRoute()).toBe('speaker');
    client.disconnect(false);
  });

  it('2. Fresh connect (no handed-off focus) requests focus exactly once before applying the route', async () => {
    const client = new GeminiLiveClient(mockConfig);
    await client.connect('test-key');
    expect(native.plugin.requestAudioFocus).toHaveBeenCalledTimes(1);
    // Set route AFTER focus, never the other way around.
    expect(native.plugin.requestAudioFocus.mock.invocationCallOrder[0]).toBeLessThan(
      native.plugin.setRoute.mock.invocationCallOrder[0]);
    client.disconnect(false);
  });

  it('3. Focus denied on a fresh connect rejects cleanly — no silent no-focus session', async () => {
    native.plugin.requestAudioFocus.mockReset().mockResolvedValue({ granted: false, status: 'failed' });
    const client = new GeminiLiveClient(mockConfig);
    await expect(client.connect('test-key')).rejects.toThrow(/audio focus was denied/);
    expect((client as any).session).toBeNull();
    client.disconnect(false);
  });

  it('4. Non-speaker route refusal falls back to the loudspeaker and reports the REAL route', async () => {
    // First call (bluetooth) refused → second call (speaker fallback) applied.
    native.plugin.setRoute
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ route: 'speaker', deviceType: 'BUILTIN_SPEAKER' });
    const config = { ...mockConfig, defaultAudioRoute: 'bluetooth' as LiveSettingsConfig['defaultAudioRoute'] };
    const client = new GeminiLiveClient(config);
    await client.connect('test-key');
    expect(native.plugin.setRoute).toHaveBeenNthCalledWith(1, { route: 'bluetooth' });
    expect(native.plugin.setRoute).toHaveBeenNthCalledWith(2, { route: 'speaker' });
    expect(client.getCurrentAudioRoute()).toBe('speaker');
    client.disconnect(false);
  });

  it('5. Even the speaker fallback refusing aborts the startup (never a fake route claim)', async () => {
    native.plugin.setRoute.mockReset().mockResolvedValue(null);
    const config = { ...mockConfig, defaultAudioRoute: 'bluetooth' as LiveSettingsConfig['defaultAudioRoute'] };
    const client = new GeminiLiveClient(config);
    await expect(client.connect('test-key')).rejects.toThrow(/speaker fallback failed/);
    // No half-configured session survives.
    expect((client as any).session).toBeNull();
    client.disconnect(false);
  });

  it('8. A later call cannot inherit a prior call\'s handed-off focus claim (review-8 P1)', async () => {
    const client = new GeminiLiveClient(mockConfig);
    // Call #1: pre-capture focus handed off, connects without requesting focus.
    await client.connect('test-key', undefined, { audioFocusAlreadyGranted: true });
    expect(native.plugin.requestAudioFocus).not.toHaveBeenCalled();
    // Explicit hangup (preserveReconnectState=false) → native focus abandoned
    // on disconnect + the client's own claim cleared.
    client.disconnect(false);
    expect((client as any).callAudioFocusGranted).toBe(false);

    // Call #2: NO handoff → fresh connect must re-request focus exactly once.
    native.plugin.requestAudioFocus.mockClear();
    await client.connect('test-key');
    expect(native.plugin.requestAudioFocus).toHaveBeenCalledTimes(1);
    client.disconnect(false);
  });

  it('6. User hangup cancels a pending reconnect backoff immediately (P2 cancellable worker)', async () => {
    vi.useFakeTimers();
    const client = new GeminiLiveClient(mockConfig);
    const connectSpy = vi.spyOn(client, 'connect');

    // Worker enters backoff (750ms+ epoch captured).
    void (client as any).handleAutoReconnect();
    expect((client as any).reconnectTimer).not.toBeNull();

    // Explicit hangup clears the pending timer AND invalidates the worker's epoch.
    (client as any).disconnect(false);
    expect((client as any).reconnectTimer).toBeNull();

    // Even after the original backoff window elapses, no reconnect fires.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connectSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('7. Auto-reconnect worker is epoch-gated: a stale worker cannot revive a hung-up call', async () => {
    vi.useFakeTimers();
    const client = new GeminiLiveClient(mockConfig);
    const connectSpy = vi.spyOn(client, 'connect');

    // Worker enters backoff and sleeps. While it sleeps a disconnect bumps the
    // epoch (the timer-clear is covered by test 6 — here we isolate the epoch
    // defense: the timer is left to fire, but the worker must detect the stale
    // epoch and abort instead of calling connect()).
    const worker = (client as any).handleAutoReconnect();
    expect((client as any).reconnectTimer).not.toBeNull();
    (client as any).reconnectEpoch += 1;

    await vi.advanceTimersByTimeAsync(30_000);
    await worker;
    expect(connectSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
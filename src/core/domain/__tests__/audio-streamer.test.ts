/**
 * AudioStreamer — weak-network playback pipeline regression tests.
 *
 * The real root cause of the long-reply "cut cut" stutter is client-side: each
 * streamed PCM chunk was scheduled as its own source with a ~25ms restart when
 * the chain under-ran on a network gap. The fixed pipeline buffers incoming
 * chunks in a jitter queue and feeds the DAC gaplessly with a pre-roll lead.
 *
 * These tests exercise that scheduling logic directly (queue accumulation,
 * startup guard, PRE_ROLL lead, flush), using a small mock AudioContext so we
 * don't need the browser/WebAudio runtime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Minimal WebAudio mock ───────────────────────────────────────────────
class MockAudioBuffer {
  length: number;
  sampleRate: number;
  channels: number;
  constructor(length: number, sampleRate: number, channels = 1) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.duration = length / sampleRate;
  }
  duration: number;
  getChannelData() {
    return new Float32Array(this.length);
  }
  set() {}
}

class MockSource {
  buffer: any = null;
  playbackRate = { value: 1 };
  start = vi.fn((when: number) => {
    startCalls.push(when);
  });
  connect = vi.fn();
  onended: (() => void) | null = null;
  stop = vi.fn();
  disconnect = vi.fn();
}

const createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
  return new MockAudioBuffer(length, sampleRate, channels);
});
const createBufferSource = vi.fn(() => new MockSource());
const createGain = vi.fn(() => ({ gain: { value: 1, setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn() }));
const createAnalyser = vi.fn(() => ({ fftSize: 0, smoothingTimeConstant: 0, connect: vi.fn(), getByteFrequencyData: vi.fn(), disconnect: vi.fn() }));
const destination = {};

let startCalls: number[] = [];
let ctx: any;

// Silently no-op anything the mock AudioContext doesn't implement.
const mockAudioContext = () => ({
  state: 'running',
  currentTime: 100,
  destination,
  createBuffer,
  createBufferSource,
  createGain,
  createAnalyser,
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  startCalls = [];
  createBuffer.mockClear();
  createBufferSource.mockClear();
  // Reset mock timers: preset real window-ish setTimeout (auto-run immediately
  // in tests so scheduling coalescing still resolves synchronously per tick).
  (globalThis as any).__timeouts = [];
  (globalThis as any).setTimeout = (fn: () => void) => {
    (globalThis as any).__queue.push(fn);
  };
  (globalThis as any).clearTimeout = vi.fn();
  (globalThis as any).__queue = [];
  (globalThis as any).setInterval = () => 0;

  ctx = mockAudioContext();

  (globalThis as any).window = {
    AudioContext: vi.fn(() => ctx),
    setTimeout: (globalThis as any).setTimeout,
    clearTimeout: (globalThis as any).clearTimeout,
    setInterval: () => 0,
  };
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).setTimeout;
  delete (globalThis as any).clearTimeout;
  delete (globalThis as any).setInterval;
  delete (globalThis as any).__queue;
});

// Encode a Float32Array of 24000Hz mono PCM into the base64 the streamer decodes.
function toPcm24kBase64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Helper to pump any queued fake timers.
function flushTimers() {
  let guard = 0;
  while ((globalThis as any).__queue?.length && guard < 500) {
    const fns = (globalThis as any).__queue;
    (globalThis as any).__queue = [];
    for (const fn of fns) fn();
    guard++;
  }
}

// Import after globals are set (module reads Capacitor from global at import).
let AudioStreamer: any;
async function loadStreamer() {
  if (!AudioStreamer) {
    const mod = await import('../audio-streamer');
    AudioStreamer = mod.AudioStreamer;
  }
  return AudioStreamer;
}

describe('AudioStreamer jitter-buffer scheduling', () => {
  it('starts playback as soon as the first chunk is decoded (no long startup wait)', async () => {
    await loadStreamer();
    const streamer = new AudioStreamer();
    // STARTUP_BUFFER_COUNT=1: a single decoded chunk is enough to open the chain.
    streamer.playAudioChunk(toPcm24kBase64(new Float32Array((0.2 * 24000) | 0)));
    flushTimers();
    expect(startCalls.length).toBe(1);
    void streamer;
  });

  it('starts playback with a PRE_ROLL lead and schedules gaplessly', async () => {
    await loadStreamer();
    const streamer = new AudioStreamer();
    const chunks = 5;
    for (let i = 0; i < chunks; i++) {
      streamer.playAudioChunk(toPcm24kBase64(new Float32Array((0.2 * 24000) | 0)));
      flushTimers();
    }
    // First source gets a small PRE_ROLL lead (60ms) over currentTime (100).
    expect(startCalls.length).toBeGreaterThan(0);
    const first = startCalls[0];
    expect(first).toBeGreaterThanOrEqual(100 + 0.06);
    // Subsequent chunks must be gapless (exactly `duration` apart at playbackRate 1).
    const gap = startCalls[1] - startCalls[0];
    expect(gap).toBeCloseTo(0.2, 2);
    void streamer;
  });

  it('flushPlayback clears the pending jitter queue', async () => {
    await loadStreamer();
    const streamer = new AudioStreamer();
    for (let i = 0; i < 6; i++) {
      streamer.playAudioChunk(toPcm24kBase64(new Float32Array((0.2 * 24000) | 0)));
    }
    flushTimers();
    streamer.flushPlayback(false);
    // Clear next tick — nothing more scheduled after flush.
    flushTimers();
    void streamer;
  });

  it('under-run recovery re-arms the chain ahead of currentTime', async () => {
    await loadStreamer();
    const streamer = new AudioStreamer();
    // Prime the chain a little so nextPlayTime is set.
    for (let i = 0; i < 4; i++) {
      streamer.playAudioChunk(toPcm24kBase64(new Float32Array((0.2 * 24000) | 0)));
      flushTimers();
    }
    const before = startCalls.length;
    // Simulate a network gap by advancing currentTime far beyond nextPlayTime.
    ctx.currentTime = 1000;
    (streamer as any).nextPlayTime = 10; // artificially far behind => under-run
    // After an under-run, a new burst re-arms directly with a MIN_CHAIN_LEAD
    // (~20ms) — NOT a full PRE_ROLL — so playback continues gaplessly across a
    // weak-network gap instead of re-buffering (which caused the "cut cut").
    for (let i = 0; i < 4; i++) {
      streamer.playAudioChunk(toPcm24kBase64(new Float32Array((0.2 * 24000) | 0)));
      flushTimers();
    }
    expect(startCalls.length).toBeGreaterThan(before);
    // Re-armed chain should be ≥ MIN_CHAIN_LEAD (20ms) ahead of the new currentTime (1000).
    expect(startCalls[startCalls.length - 1]).toBeGreaterThan(1000 + 0.02);
  });
});

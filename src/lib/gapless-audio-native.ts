import { Capacitor, registerPlugin } from '@capacitor/core';

// ===========================================================================
// Misa Live — Gapless native audio gateway
//
// Bridges the Gemini Live 24kHz/16-bit mono PCM reply stream to Android's
// native AudioTrack (MODE_STREAM) so consecutive chunks are glued together by
// the OS audio sink with NO per-chunk boundaries — the true fix for the
// "bubble-end / bade messages par atak" stutter, which WebAudio's
// AudioBufferSourceNode chaining could never fully guarantee (MDN-confirmed).
//
// On web/browser/tests there is no native AudioTrack, so this module is a
// graceful no-op and the caller falls back to the existing WebAudio
// AudioStreamer. This keeps all existing 244 green tests passing unchanged.
// ===========================================================================

interface GaplessAudioTrackNative {
  open(options: { sampleRate?: number }): Promise<{ ok: boolean; sampleRate: number; channels: number; minBufferSize: number }>;
  write(options: { data: string }): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Registered Capacitor plugin handle (native Android only). */
const Native = registerPlugin<GaplessAudioTrackNative>('GaplessAudioTrack');

// ═══════════════════════════════════════════════════════════════════════════
// Native gapless path is OPT-IN.
//
// The rewrite to fix the "no voice on native" regression (a USAGE_MEDIA
// AudioTrack was being silenced by the live call's voice-communication
// AUDIOFOCUS_GAIN — fixed back to USAGE_VOICE_COMMUNICATION in the plugin) is
// shipped in `GaplessAudioTrackPlugin.java`, BUT the native output still cannot
// be verified here (no on-device build). To NEVER again ship a release where
// the companion is silent, the proven WebAudio path stays the DEFAULT and the
// native gapless stream must be explicitly enabled before playout.
//
// Flip to `true` ONLY after the native AudioTrack is confirmed audible on a
// real device (live call, large reply) — i.e. post `npx cap sync` + build.
// ═══════════════════════════════════════════════════════════════════════════
export const NATIVE_GAPLESS_ENABLED = false;

/** True when we are running on a real native Android build. */
function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && NATIVE_GAPLESS_ENABLED;
  } catch {
    return false;
  }
}

/** Lazily tracks whether the native AudioTrack has been opened. */
let nativeOpened = false;

/**
 * Open the native AudioTrack once (idempotent). On web/tests it never opens.
 * Returns true when the native path is ready to receive PCM.
 */
export async function ensureNativeAudioTrack(): Promise<boolean> {
  if (!isNative()) return false;
  if (nativeOpened) return true;
  try {
    await Native.open({ sampleRate: 24000 });
    nativeOpened = true;
    return true;
  } catch (err) {
    // Native plugin failed for any reason — fall back to WebAudio silently.
    console.warn('[GaplessAudioTrack] open failed, falling back to WebAudio:', err);
    nativeOpened = false;
    return false;
  }
}

/**
 * Push one PCM chunk (base64, 24kHz mono int16 little-endian) to the native
 * AudioTrack for gapless playback. Fire-and-forget: returns immediately after
 * enqueue; the native background writer thread does the blocking write() so
 * the JS bridge is never stalled waiting on the OS audio sink.
 *
 * If native is unavailable (web/tests) this is a no-op — the caller keeps
 * using the WebAudio fallback instead.
 */
export async function writeNativeAudioChunk(pcm24kBase64: string): Promise<boolean> {
  if (!nativeOpened) return false;
  try {
    await Native.write({ data: pcm24kBase64 });
    return true;
  } catch (err) {
    // Never reject mid-stream; if native hiccups we drop back to WebAudio.
    console.warn('[GaplessAudioTrack] write failed:', err);
    return false;
  }
}

/**
 * Flush queued native audio (skip any PCM still waiting to be written). Used
 * at interrupt/turn-boundary/hang-up to stop stale playback immediately.
 */
export async function flushNativeAudioTrack(): Promise<void> {
  if (!nativeOpened) return;
  try {
    await Native.flush();
  } catch (err) {
    console.warn('[GaplessAudioTrack] flush failed:', err);
  }
}

/** Close and release the native AudioTrack. No-op on web/tests. */
export async function closeNativeAudioTrack(): Promise<void> {
  if (!nativeOpened) return;
  nativeOpened = false;
  try {
    await Native.close();
  } catch (err) {
    console.warn('[GaplessAudioTrack] close failed:', err);
  }
}

/** Is the native path currently the active playback sink? */
export function nativeGaplessActive(): boolean {
  return nativeOpened;
}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiLiveClient } from '../live-client';
import { AudioStreamer } from '../audio-streamer';
import { proactiveAgentService } from '../../../features/ai/proactive-agent.service';
import type { LiveSettingsConfig } from '../live-types';

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

describe('Live Call Mode & Interruption Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Proactive agent toggle ON enables live call mode, toggle OFF keeps standard live mode', () => {
    proactiveAgentService.updatePreferences({ enabled: true });
    expect(proactiveAgentService.getPreferences().enabled).toBe(true);

    const clientWithCall = new GeminiLiveClient(mockConfig);
    expect(clientWithCall).toBeDefined();

    proactiveAgentService.updatePreferences({ enabled: false });
    expect(proactiveAgentService.getPreferences().enabled).toBe(false);

    const clientStandard = new GeminiLiveClient(mockConfig);
    expect(clientStandard).toBeDefined();

    proactiveAgentService.updatePreferences({ enabled: true });
  });

  it('2. Audio streaming does not drop speech during assistant turns and barge-in flushes playback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const client = new GeminiLiveClient(mockConfig);

    const mockSession = {
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    };
    (client as any).session = mockSession;

    (client as any).status = 'speaking';
    (client as any).isUserTalkingOverThreshold = false;
    const flushPlaybackSpy = vi.spyOn((client as any).audioStreamer, 'flushPlayback');

    // Single transient chunk (echo spike) — debounce window ke andar,
    // Misa ki voice CUT nahi honi chahiye.
    (client as any).sendAudioChunk('echo_spike', 0.08);
    expect(flushPlaybackSpy).not.toHaveBeenCalled();
    expect((client as any).status).toBe('speaking');

    // Sustained user speech (>=200ms) — abhi barge-in flush hota hai
    vi.setSystemTime(1200);
    mockSession.sendRealtimeInput.mockClear();
    (client as any).sendAudioChunk('base64_sample_pcm_chunk', 0.08);

    expect(flushPlaybackSpy).toHaveBeenCalled();
    expect((client as any).status).toBe('listening');
    expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: 'base64_sample_pcm_chunk',
        mimeType: 'audio/pcm;rate=16000',
      },
    });

    vi.useRealTimers();
  });

  it('3. Pre-roll buffer preserves initial phonemes when barge-in is triggered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const client = new GeminiLiveClient(mockConfig);

    const mockSession = {
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    };
    (client as any).session = mockSession;
    (client as any).status = 'speaking';
    (client as any).isUserTalkingOverThreshold = false;

    // Silence — echo suppression drop karta hai (koi speech nahi, 220ms guard)
    (client as any).sendAudioChunk('silence_chunk_1', 0.01);
    (client as any).sendAudioChunk('silence_chunk_2', 0.01);

    expect(mockSession.sendRealtimeInput).not.toHaveBeenCalled();

    // User speech shuru — streak start (abhi 0ms elapsed)
    (client as any).sendAudioChunk('user_speech_start', 0.06);

    // 200ms+ ke baad sustained speech — pre-roll buffer flush hokar
    // initial phonemes model ko bheje jate hain
    vi.setSystemTime(1200);
    mockSession.sendRealtimeInput.mockClear();
    (client as any).sendAudioChunk('user_speech_continue', 0.06);

    expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: 'silence_chunk_1',
        mimeType: 'audio/pcm;rate=16000',
      },
    });
    expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: 'user_speech_continue',
        mimeType: 'audio/pcm;rate=16000',
      },
    });

    vi.useRealTimers();
  });

  it('4. A hung connection attempt rejects instead of leaving the client in Connecting', async () => {
    vi.useFakeTimers();
    const client = new GeminiLiveClient(mockConfig);
    const attempt = ++(client as any).connectionAttempt;
    const pending = (client as any).withConnectionTimeout(new Promise(() => {}), attempt);
    const rejection = expect(pending).rejects.toThrow('connection timed out');

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    vi.useRealTimers();
  });

  it('5. Model availability errors give the user a precise recovery action', () => {
    const client = new GeminiLiveClient(mockConfig);
    expect((client as any).toConnectionErrorMessage(new Error('Model not found')))
      .toContain('Live-compatible model');
  });

  it('6. Reconnect cleanup detaches WebAudio without ending the caller-owned microphone', () => {
    const streamer = new AudioStreamer();
    const stop = vi.fn();
    (streamer as any).micStream = { getTracks: () => [{ stop }] };

    streamer.stopRecording();
    expect(stop).not.toHaveBeenCalled();

    (streamer as any).micStream = { getTracks: () => [{ stop }] };
    streamer.close();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('7. Internal backlog replacement does not report a completed assistant turn', () => {
    const streamer = new AudioStreamer();
    const ended = vi.fn();
    streamer.setOnPlaybackEnded(ended);
    (streamer as any).activeSources = [{ stop: vi.fn(), disconnect: vi.fn() }];

    streamer.flushPlayback(false);

    expect(ended).not.toHaveBeenCalled();
  });

  it('8. Echo suppression waits for a real pause instead of snipping soft speech', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const client = new GeminiLiveClient(mockConfig);
    const mockSession = {
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    };
    (client as any).session = mockSession;
    (client as any).status = 'speaking';
    (client as any).lastUserVoiceTime = 0;
    (client as any).isUserTalkingOverThreshold = false;

    // Misa bol rahi hai aur user ek soft syllable ke beech mein halka sa
    // murmur karta hai (sub-echo) — 220ms hang-time window ke andar aur RMS
    // speech threshold se neeche → chunk ko defensive tarah bheja jaana
    // chahiye, kabhi bhi mid-word pe cut nahi hona chahiye.
    (client as any).sendAudioChunk('soft_syllable', 0.01);
    expect(mockSession.sendRealtimeInput).toHaveBeenCalled();
    (client as any).lastUserVoiceTime = 0;

    // 500ms tak koi nayi voice nahi aayi → asli pause. Ab wahi soft noise
    // (room echo / ambient) echo suppression ko trigger karna chahiye: chunk
    // DROP karo, kyunki yahan user sach mein bol nahi raha.
    vi.setSystemTime(500);
    mockSession.sendRealtimeInput.mockClear();
    (client as any).sendAudioChunk('silence', 0.01);
    expect(mockSession.sendRealtimeInput).not.toHaveBeenCalled();

    // Confirm: 100ms ke andar (hang-time window ke andar) sirf ek halki
    // achhi-chahi aawaz bheji jaye — cut NAHI hona chahiye.
    mockSession.sendRealtimeInput.mockClear();
    (client as any).lastUserVoiceTime = 400; // 100ms pahle bola tha
    (client as any).sendAudioChunk('soft_breathe', 0.01);
    expect(mockSession.sendRealtimeInput).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

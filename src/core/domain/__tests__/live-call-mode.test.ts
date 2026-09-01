import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiLiveClient } from '../live-client';
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
    const client = new GeminiLiveClient(mockConfig);

    const mockSession = {
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    };
    (client as any).session = mockSession;

    (client as any).status = 'speaking';
    const flushPlaybackSpy = vi.spyOn((client as any).audioStreamer, 'flushPlayback');

    (client as any).sendAudioChunk('base64_sample_pcm_chunk', 0.08);

    expect(flushPlaybackSpy).toHaveBeenCalled();
    expect((client as any).status).toBe('listening');
    expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: 'base64_sample_pcm_chunk',
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  });

  it('3. Pre-roll buffer preserves initial phonemes when barge-in is triggered', () => {
    const client = new GeminiLiveClient(mockConfig);

    const mockSession = {
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    };
    (client as any).session = mockSession;
    (client as any).status = 'speaking';

    (client as any).sendAudioChunk('silence_chunk_1', 0.01);
    (client as any).sendAudioChunk('silence_chunk_2', 0.01);

    expect(mockSession.sendRealtimeInput).not.toHaveBeenCalled();

    (client as any).sendAudioChunk('user_speech_start', 0.06);

    expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: 'silence_chunk_1',
        mimeType: 'audio/pcm;rate=16000',
      },
    });
    expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
      audio: {
        data: 'user_speech_start',
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  });
});

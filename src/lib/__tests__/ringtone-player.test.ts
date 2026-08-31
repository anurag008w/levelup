import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ringtonePlayer, RINGTONE_PRESETS } from '../ringtone-player';

describe('RingtonePlayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes 5 ringtone presets', () => {
    expect(RINGTONE_PRESETS.length).toBe(5);
    expect(RINGTONE_PRESETS.some((p) => p.id === 'soft_chime')).toBe(true);
    expect(RINGTONE_PRESETS.some((p) => p.id === 'lofi_melody')).toBe(true);
    expect(RINGTONE_PRESETS.some((p) => p.id === 'custom')).toBe(true);
  });

  it('starts and stops ringtone playback without crashing', () => {
    expect(() => {
      ringtonePlayer.start({ preset: 'soft_chime', volume: 0.5 });
      ringtonePlayer.stop();
    }).not.toThrow();
  });

  it('handles preview trigger and stops safely', () => {
    expect(() => {
      ringtonePlayer.preview({ preset: 'lofi_melody' });
      ringtonePlayer.stop();
    }).not.toThrow();
  });
});

/**
 * Ringtone Player — Web Audio Synth & Custom Audio Engine
 * Provides 4 soothing procedural ringtone presets + support for custom user audio files (.mp3, .wav, .ogg).
 * Works reliably across Android WebView, iOS, and Linux/Desktop browsers.
 */

export type RingtonePresetId = 'soft_chime' | 'lofi_melody' | 'classic_ring' | 'cyber_bell' | 'custom';

export interface RingtoneConfig {
  preset: RingtonePresetId;
  customAudioUrl?: string;
  volume?: number;
}

export const RINGTONE_PRESETS: Array<{ id: RingtonePresetId; name: string; description: string }> = [
  { id: 'soft_chime', name: 'Misa Soft Chime', description: 'Gentle pentatonic chime melody (Default)' },
  { id: 'lofi_melody', name: 'Gentle Lo-Fi Melody', description: 'Warm study chords with ambient resonance' },
  { id: 'classic_ring', name: 'Classic Telecom Ring', description: 'Subtle retro electronic double-ring' },
  { id: 'cyber_bell', name: 'Cyber Bell', description: 'Modern futuristic harmonic bell tone' },
  { id: 'custom', name: 'Custom Audio File', description: 'Loaded from your phone/device storage' },
];

class RingtonePlayerService {
  private audioCtx: AudioContext | null = null;
  private isPlaying = false;
  private loopTimer: any = null;
  private customAudioEl: HTMLAudioElement | null = null;
  private activeGainNode: GainNode | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Android WebView autoplay unlock: Web Audio ek fitratan "suspended" state me
   * hota hai jab tak user-gesture pe AudioContext resume na ho. Android Capacitor
   * WebView me mediaPlaybackRequiresUserGesture default OFF hai, isliye resume
   * turant chalna chahiye — par kuch ROMs/versions pe phir bhi suspend rehta hai.
   * User interaction (kisi bhi tap/scroll/keydown) pe turant resume karke unlock
   * karte hain taaki agli proactive call bina gesture ke baje.
   */
  unlock(): void {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }
  }

  /** Plays a single chime note with decay */
  private playSynthNote(ctx: AudioContext, masterGain: GainNode, freq: number, startTime: number, duration: number, type: OscillatorType = 'sine') {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    noteGain.gain.setValueAtTime(0, startTime);
    noteGain.gain.linearRampToValueAtTime(0.35, startTime + 0.03);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(noteGain);
    noteGain.connect(masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  /** Plays the Soft Chime pattern (E5 -> G#5 -> B5 -> E6 -> B5) */
  private playSoftChimePattern(ctx: AudioContext, masterGain: GainNode, startTime: number) {
    const notes = [
      { f: 659.25, t: 0.0, d: 0.7 },  // E5
      { f: 830.61, t: 0.18, d: 0.7 }, // G#5
      { f: 987.77, t: 0.36, d: 0.7 }, // B5
      { f: 1318.51, t: 0.54, d: 1.1 },// E6
      { f: 987.77, t: 0.85, d: 1.2 }, // B5
    ];
    notes.forEach((n) => this.playSynthNote(ctx, masterGain, n.f, startTime + n.t, n.d, 'sine'));
  }

  /** Plays the Lo-Fi Melody pattern */
  private playLofiPattern(ctx: AudioContext, masterGain: GainNode, startTime: number) {
    const chord = [
      { f: 440.0, t: 0.0, d: 0.9, type: 'triangle' as OscillatorType }, // A4
      { f: 554.37, t: 0.15, d: 0.9, type: 'sine' as OscillatorType },   // C#5
      { f: 659.25, t: 0.3, d: 1.0, type: 'sine' as OscillatorType },    // E5
      { f: 880.0, t: 0.55, d: 1.4, type: 'sine' as OscillatorType },    // A5
      { f: 783.99, t: 0.85, d: 1.2, type: 'sine' as OscillatorType },   // G5
    ];
    chord.forEach((n) => this.playSynthNote(ctx, masterGain, n.f, startTime + n.t, n.d, n.type));
  }

  /** Plays Classic Ring tone (440Hz + 480Hz modulated tone) */
  private playClassicPattern(ctx: AudioContext, masterGain: GainNode, startTime: number) {
    // Burst 1
    this.playSynthNote(ctx, masterGain, 440, startTime, 0.4, 'sine');
    this.playSynthNote(ctx, masterGain, 480, startTime, 0.4, 'sine');
    // Burst 2
    this.playSynthNote(ctx, masterGain, 440, startTime + 0.55, 0.4, 'sine');
    this.playSynthNote(ctx, masterGain, 480, startTime + 0.55, 0.4, 'sine');
  }

  /** Plays Cyber Bell tone */
  private playCyberBellPattern(ctx: AudioContext, masterGain: GainNode, startTime: number) {
    const notes = [
      { f: 587.33, t: 0.0, d: 0.6 },  // D5
      { f: 880.0, t: 0.14, d: 0.6 },   // A5
      { f: 1174.66, t: 0.28, d: 1.2 }, // D6
      { f: 1760.0, t: 0.5, d: 1.5 },   // A6
    ];
    notes.forEach((n) => this.playSynthNote(ctx, masterGain, n.f, startTime + n.t, n.d, 'sine'));
  }

  /** Start playing the ringtone with continuous looping */
  start(config: RingtoneConfig): void {
    this.stop();
    this.isPlaying = true;
    const volume = Math.max(0, Math.min(1, config.volume ?? 0.85));

    // Custom audio file playback if provided
    if (config.preset === 'custom' && config.customAudioUrl) {
      try {
        const audio = new Audio(config.customAudioUrl);
        audio.loop = true;
        audio.volume = volume;
        this.customAudioEl = audio;
        void audio.play().catch((err) => {
          console.warn('[RingtonePlayer] Custom audio play failed, falling back to synth chime:', err);
          this.startSynthLoop('soft_chime', volume);
        });
        return;
      } catch (err) {
        console.warn('[RingtonePlayer] Custom audio init error:', err);
      }
    }

    this.startSynthLoop(config.preset, volume);
  }

  private startSynthLoop(preset: RingtonePresetId, volume: number): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume, ctx.currentTime);
    masterGain.connect(ctx.destination);
    this.activeGainNode = masterGain;

    // Autoplay unlock: Android WebView me AudioContext bina gesture ke suspended
    // reh sakta hai — resume karke turant play shuru karo. Agar abhi bhi
    // suspended ho (thoda async), 300ms pe retry karo. Ye ringing ke liye kafi
    // hota hai taaki kabhi silent na ho.
    const ensureRunningAndPlay = () => {
      if (!this.isPlaying) return;
      const c = this.getAudioContext();
      if (!c) return;
      if (c.state === 'running') {
        playCycle();
      } else if (c.state === 'suspended') {
        void c.resume().then(() => {
          if (this.isPlaying) playCycle();
        });
      } else {
        playCycle();
      }
    };

    const playCycle = () => {
      if (!this.isPlaying) return;
      const now = ctx.currentTime;

      switch (preset) {
        case 'lofi_melody':
          this.playLofiPattern(ctx, masterGain, now);
          this.loopTimer = setTimeout(ensureRunningAndPlay, 2600);
          break;
        case 'classic_ring':
          this.playClassicPattern(ctx, masterGain, now);
          this.loopTimer = setTimeout(ensureRunningAndPlay, 2200);
          break;
        case 'cyber_bell':
          this.playCyberBellPattern(ctx, masterGain, now);
          this.loopTimer = setTimeout(ensureRunningAndPlay, 2400);
          break;
        case 'soft_chime':
        default:
          this.playSoftChimePattern(ctx, masterGain, now);
          this.loopTimer = setTimeout(ensureRunningAndPlay, 2400);
          break;
      }
    };

    ensureRunningAndPlay();
  }

  /** Preview a ringtone for 3.5 seconds and stop */
  preview(config: RingtoneConfig): void {
    this.start(config);
    setTimeout(() => {
      this.stop();
    }, 3600);
  }

  /** Stop playing ringtone and fade out cleanly */
  stop(): void {
    this.isPlaying = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    if (this.customAudioEl) {
      try {
        this.customAudioEl.pause();
        this.customAudioEl.currentTime = 0;
      } catch {}
      this.customAudioEl = null;
    }
    if (this.activeGainNode && this.audioCtx && this.audioCtx.state === 'running') {
      try {
        const now = this.audioCtx.currentTime;
        this.activeGainNode.gain.setValueAtTime(this.activeGainNode.gain.value, now);
        this.activeGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.15);
      } catch {}
      this.activeGainNode = null;
    }
    if (this.audioCtx && this.audioCtx.state === 'running') {
      setTimeout(() => {
        if (!this.isPlaying && this.audioCtx && this.audioCtx.state === 'running') {
          void this.audioCtx.suspend().catch(() => {});
        }
      }, 300);
    }
  }
}

export const ringtonePlayer = new RingtonePlayerService();

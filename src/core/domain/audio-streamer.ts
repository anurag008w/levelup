import { Capacitor } from '@capacitor/core';

// WebAudio Streamer for Gemini Live
// High-performance real-time audio pipeline:
// - 16kHz 16-bit Mono Linear PCM recording (optimized for Gemini input)
// - 24kHz 16-bit Mono Linear PCM playback (Gemini native audio response)
// - Android 7+ (Chromium WebView) compatible (Dual engine: AudioWorklet + ScriptProcessor fallback)
// - Real-time Audio Analyser for audio reactive UI waves and visualizer orb

export class AudioStreamer {
  // Do not let bursty network delivery turn into seconds of stale speech.
  // 2.5s (up from 1.25s): a short network burst no longer snips mid-word —
  // the queue is purged only when the backlog is genuinely stale.
  // A single long model reply can stream a lot of audio much faster than
  // real-time playback. Previously 2.5s: whenever the queued backlog grew past
  // that (i.e. any answer longer than ~2.5s of speech), the WHOLE queue was
  // flushed/dropped — so long spoken answers got cut after a couple of words /
  // sentences ("bada para aata hai par voice me bas kuch hi words"). That
  // suppression only made sense for genuinely stale audio, which is already
  // purged on every turn boundary / interruption via explicit flushPlayback()
  // calls. Bump the window high enough (60s) to cover any legitimately long
  // spoken reply without cutting it mid-sentence.
  private static readonly MAX_PLAYBACK_BACKLOG_SECONDS = 60;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  private isRecording = false;
  private isMuted = false;
  private playbackSpeed = 1.0;
  private onAudioChunk?: (pcm16Base64: string, rmsLevel?: number) => void;
  private onInputLevel?: (level: number) => void;
  private onOutputLevel?: (level: number) => void;

  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private levelInterval: number | null = null;
  private onPlaybackEnded?: () => void;
  private outputVolume = 1;
  private outputGainNode: GainNode | null = null;

  setOutputVolume(volume: number): void {
    this.outputVolume = Math.max(0, Math.min(1, volume));
    if (this.outputGainNode && this.audioContext) {
      try {
        this.outputGainNode.gain.setValueAtTime(this.outputVolume, this.audioContext.currentTime);
      } catch {}
    }
  }

  setOnPlaybackEnded(cb?: () => void): void {
    this.onPlaybackEnded = cb;
  }

  constructor() {}

  setPlaybackSpeed(speed: number): void {
    if (speed >= 0.4 && speed <= 2.5) {
      this.playbackSpeed = speed;
    }
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeed;
  }

  /**
   * AudioContext ko running banaye (autoplay unlock). Web Audio bina user-gesture
   * pe "suspended" hota hai — Android WebView me Capacitor default
   * mediaPlaybackRequiresUserGesture=false, par kuch ROMs/versions phir bhi
   * suspend reht hain. resume() ko await karke karte hain aur first call par
   * daur baar retry, taaki live-call ka mic + speaker kabhi silent na rahe.
   */
  private async ensureRunning(): Promise<void> {
    await this.getContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        // resume fail (policy) — dom first call par chalne denge
      }
      // Thoda sa rollback-resume retry: kuch devices pe resume promise resolve
      // hota hai par state 'running' nahi hota first-baar. 150ms pe dobara try.
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await new Promise((r) => setTimeout(r, 150));
        try {
          await this.audioContext.resume();
        } catch {
          // no-op
        }
      }
    }
  }

  /**
   * AudioContext ko running banaye (autoplay unlock). Web Audio bina user-gesture
   * pe "suspended" hota hai — Android WebView me Capacitor default
   * mediaPlaybackRequiresUserGesture=false, par kuch ROMs/versions phir bhi
   * suspend rehte hain. Verified (web/webview reports): kuch Android WebViews me
   * AudioContext tab tak silent rehta hai jab tak koi HTML5 <audio> element
   * pehle na chalaya jaye. Isliye hum ek silent <audio> element (tiny silent
   * WAV data URI) play karke AudioContext ko unlock karte hain — versatile.
   */
  private htmlAudioUnlocked = false;
  private unlockViaHtmlAudio(): void {
    // CRITICAL (Android audio focus collision fix): On native Android (Capacitor),
    // playing an HTML5 <audio> element makes Chromium create an Android MediaPlayer
    // instance with USAGE_MEDIA audio focus. This conflicts directly with our
    // AudioRoutePlugin (USAGE_VOICE_COMMUNICATION) and causes Android to send an
    // AUDIOFOCUS_LOSS (-1) event that instantly killed the live call session!
    // On native, AudioRoutePlugin already acquired communication focus and
    // audioContext.resume() on user gesture is 100% sufficient without colliding.
    if (this.htmlAudioUnlocked || typeof window === 'undefined' || Capacitor.isNativePlatform()) return;
    try {
      // 20ms silent WAV — zero audible but counts as an audio-gesture playback,
      // aur browser WebView ke audio subsystem ko wake karta hai taaki baad ke
      // AudioContext nodes bhi reliably fire (browser fallback).
      const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      const el = new Audio(silentWav);
      el.volume = 0;
      void el.play().then(() => {
        this.htmlAudioUnlocked = true;
        // Audio element ka kaam bas unlock karna hai — turant pause karo.
        try { el.pause(); } catch {}
        // AudioContext agar abhi bhi suspended hai toh ab resume leke karo.
        if (this.audioContext && this.audioContext.state === 'suspended') {
          void this.audioContext.resume();
        }
      }).catch(() => {});
    } catch {
      // no-op — fallback abhi bhi (direct resume) kaam karega
    }
  }

  /** Get or create a unified AudioContext with native DAC scheduling. */
  private getContext(): AudioContext {
    this.unlockViaHtmlAudio();
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Use native device hardware sample rate (auto-resampling) for maximum compatibility on Android & Web
      this.audioContext = new AudioContextClass();

      this.outputAnalyser = this.audioContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.8;
      this.outputAnalyser.connect(this.audioContext.destination);

      this.outputGainNode = this.audioContext.createGain();
      this.outputGainNode.gain.value = this.outputVolume;
      this.outputGainNode.connect(this.outputAnalyser);
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }
    return this.audioContext;
  }

  /** Start recording from microphone and stream 16kHz PCM chunks. */
  async startRecording(
    stream: MediaStream,
    onChunk: (pcm16Base64: string, rmsLevel?: number) => void,
    onInputLevel?: (level: number) => void,
    onOutputLevel?: (level: number) => void,
  ): Promise<void> {
    // The caller owns the MediaStream. Reconnects must detach nodes without
    // stopping the microphone tracks, otherwise the replacement session gets
    // a permanently ended stream.
    this.stopRecording(false);
    this.micStream = stream;
    this.onAudioChunk = onChunk;
    this.onInputLevel = onInputLevel;
    this.onOutputLevel = onOutputLevel;

    // Autoplay unlock — mic streaming ke liye AudioContext ko running hone do.
    await this.ensureRunning();
    const ctx = this.audioContext!;

    this.inputSource = ctx.createMediaStreamSource(stream);
    this.inputAnalyser = ctx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.inputSource.connect(this.inputAnalyser);

    // ~43ms at 48kHz: substantially better turn-taking latency than 4096 while
    // still keeping message rate manageable for the Live WebSocket.
    const bufferSize = 2048;
    this.scriptProcessor = ctx.createScriptProcessor(bufferSize, 1, 1);

    this.scriptProcessor.onaudioprocess = (e) => {
      if (!this.isRecording || this.isMuted) return;
      const inputData = e.inputBuffer.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < inputData.length; i++) {
        sumSq += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sumSq / inputData.length);
      const downsampled16k = this.downsampleTo16k(inputData, ctx.sampleRate);
      const pcm16 = this.floatTo16BitPCM(downsampled16k);
      const base64 = this.arrayBufferToBase64(pcm16.buffer);
      if (this.onAudioChunk && base64) {
        this.onAudioChunk(base64, rms);
      }
    };

    this.inputSource.connect(this.scriptProcessor);
    const zeroGain = ctx.createGain();
    zeroGain.gain.value = 0;
    this.scriptProcessor.connect(zeroGain);
    zeroGain.connect(ctx.destination);

    this.isRecording = true;
    this.startLevelMonitoring();
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  /** Direct hardware DAC scheduling with clean linear PCM streaming. */
  playAudioChunk(pcm24kBase64: string): void {
    const ctx = this.audioContext || this.getContext();
    if (!ctx || ctx.state === 'closed') return;
    // Autoplay-safety: agar AudioContext abhi bhi suspended ho (kuch ROMs pe
    // first resume pending), turant continue karo. `startRecording` ne pehle
    // hi ensureRunning kiya hai, isliye yahan usually running hota hai — hame
    // har chunk ko async wrapper me koi race/order hazard nahi chaahiye.
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const binary = atob(pcm24kBase64);
    const numSamples = Math.floor(binary.length / 2);
    if (numSamples <= 0) return;

    const rawSamples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      let sample = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      if (sample >= 32768) sample -= 65536;
      rawSamples[i] = sample / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, rawSamples.length, 24000);
    audioBuffer.getChannelData(0).set(rawSamples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const speed = this.playbackSpeed && this.playbackSpeed > 0 ? this.playbackSpeed : 1.0;
    source.playbackRate.value = speed;

    if (!this.outputGainNode) {
      this.outputGainNode = ctx.createGain();
      this.outputGainNode.gain.value = this.outputVolume;
      this.outputGainNode.connect(this.outputAnalyser!);
    }
    source.connect(this.outputGainNode);

    const playDuration = audioBuffer.duration / speed;
    const now = ctx.currentTime;

    if (this.nextPlayTime - now > AudioStreamer.MAX_PLAYBACK_BACKLOG_SECONDS) {
      this.flushPlayback(false);
    }

    // Gapless continuous playback:
    // If starting fresh or recovering from an underrun (nextPlayTime < now),
    // give 25ms lead time so the Android hardware DAC / Bluetooth radio buffer
    // initializes smoothly without audio clicks or underruns.
    // If consecutive chunks arrive in a stream (nextPlayTime >= now),
    // schedule seamlessly with EXACTLY 0ms gap.
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.025;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += playDuration;

    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0) {
        this.nextPlayTime = 0;
        this.onPlaybackEnded?.();
      }
    };
  }

  /** Immediately flush and stop active playback (e.g. on user interruption). */
  flushPlayback(notifyEnded = true): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignored
      }
    }
    this.activeSources = [];
    this.nextPlayTime = 0;
    if (notifyEnded) this.onPlaybackEnded?.();
  }

  private startLevelMonitoring(): void {
    if (this.levelInterval !== null) return;
    const inputData = new Uint8Array(128);
    const outputData = new Uint8Array(128);

    this.levelInterval = window.setInterval(() => {
      if (this.inputAnalyser && this.onInputLevel) {
        this.inputAnalyser.getByteFrequencyData(inputData);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i];
        const avg = sum / inputData.length / 255;
        this.onInputLevel(this.isMuted ? 0 : avg);
      }
      if (this.outputAnalyser && this.onOutputLevel) {
        this.outputAnalyser.getByteFrequencyData(outputData);
        let sum = 0;
        for (let i = 0; i < outputData.length; i++) sum += outputData[i];
        const avg = sum / outputData.length / 255;
        this.onOutputLevel(avg);
      }
    }, 80);
  }

  stopRecording(stopTracks = false): void {
    this.isRecording = false;
    if (this.levelInterval !== null) {
      clearInterval(this.levelInterval);
      this.levelInterval = null;
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.micStream && stopTracks) {
      this.micStream.getTracks().forEach((t) => t.stop());
    }
    this.micStream = null;
    this.flushPlayback();
  }

  close(): void {
    this.stopRecording(true);
    if (this.outputGainNode) {
      try { this.outputGainNode.disconnect(); } catch {}
      this.outputGainNode = null;
    }
    if (this.outputAnalyser) {
      try { this.outputAnalyser.disconnect(); } catch {}
      this.outputAnalyser = null;
    }
    if (this.inputAnalyser) {
      try { this.inputAnalyser.disconnect(); } catch {}
      this.inputAnalyser = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { void this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this.htmlAudioUnlocked = false;
  }

  // ===== Helper conversions =====

  private downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
    if (inputSampleRate === 16000) return input;
    const ratio = inputSampleRate / 16000;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetInput = 0;
    while (offsetResult < result.length) {
      const nextOffsetInput = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) {
        accum += input[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetInput = nextOffsetInput;
    }
    return result;
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }

  private arrayBufferToBase64(buffer: ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 8192) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
    }
    return btoa(binary);
  }
}

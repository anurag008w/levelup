// WebAudio Streamer for Gemini Live
// High-performance real-time audio pipeline:
// - 16kHz 16-bit Mono Linear PCM recording (optimized for Gemini input)
// - 24kHz 16-bit Mono Linear PCM playback (Gemini native audio response)
// - Android 7+ (Chromium WebView) compatible (Dual engine: AudioWorklet + ScriptProcessor fallback)
// - Real-time Audio Analyser for audio reactive UI waves and visualizer orb

export class AudioStreamer {
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

  constructor() {}

  setPlaybackSpeed(speed: number): void {
    if (speed >= 0.4 && speed <= 2.5) {
      this.playbackSpeed = speed;
    }
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeed;
  }

  /** Get or create a unified AudioContext with native DAC scheduling. */
  private getContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Use native device hardware sample rate (auto-resampling) for maximum compatibility on Android & Web
      this.audioContext = new AudioContextClass();

      this.outputAnalyser = this.audioContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.8;
      this.outputAnalyser.connect(this.audioContext.destination);
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
    this.stopRecording();
    this.micStream = stream;
    this.onAudioChunk = onChunk;
    this.onInputLevel = onInputLevel;
    this.onOutputLevel = onOutputLevel;

    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    this.inputSource = ctx.createMediaStreamSource(stream);
    this.inputAnalyser = ctx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.inputSource.connect(this.inputAnalyser);

    // Use 2048 buffer size for ultra-low latency capture (~42ms)
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
    const ctx = this.getContext();
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
    source.connect(this.outputAnalyser!);

    const playDuration = audioBuffer.duration / speed;
    const now = ctx.currentTime;

    // Seamless continuous playback:
    // If consecutive chunks stream in continuously (nextPlayTime >= now), schedule seamlessly with 0ms gap.
    // If audio buffer underruns or starting initial speech, buffer with minimal 20ms lead.
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.020;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += playDuration;

    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0 && ctx.currentTime >= this.nextPlayTime) {
        this.nextPlayTime = 0;
      }
    };
  }

  /** Immediately flush and stop active playback (e.g. on user interruption). */
  flushPlayback(): void {
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

  stopRecording(): void {
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
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.flushPlayback();
  }

  close(): void {
    this.stopRecording();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
      this.audioContext = null;
    }
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

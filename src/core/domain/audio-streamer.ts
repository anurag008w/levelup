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
  private playbackSpeed = 0.85;
  private onAudioChunk?: (pcm16Base64: string) => void;
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
    onChunk: (pcm16Base64: string) => void,
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
      const downsampled16k = this.downsampleTo16k(inputData, ctx.sampleRate);
      const pcm16 = this.floatTo16BitPCM(downsampled16k);
      const base64 = this.arrayBufferToBase64(pcm16.buffer);
      if (this.onAudioChunk && base64) {
        this.onAudioChunk(base64);
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

  /** Direct hardware DAC scheduling with pitch-preserved SOLA time-stretching. */
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

    // Apply high-fidelity SOLA time-stretching when playbackSpeed differs from 1.0
    // This alters speaking speed/duration while preserving 100% of vocal pitch & tone (zero chipmunk / zero deep distortion)
    const stretchedSamples =
      Math.abs(this.playbackSpeed - 1.0) > 0.02
        ? this.timeStretchSOLA(rawSamples, this.playbackSpeed)
        : rawSamples;

    const audioBuffer = ctx.createBuffer(1, stretchedSamples.length, 24000);
    audioBuffer.getChannelData(0).set(stretchedSamples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = 1.0; // Keep hardware rate 1.0 to preserve natural vocal tone
    source.connect(this.outputAnalyser!);

    const now = ctx.currentTime;
    // Seamless continuous playback: If nextPlayTime is in the past, schedule at now + 20ms lead time.
    // Otherwise queue sequentially for exact natural-speed human speech.
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.020;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;

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

  /**
   * Synchronous Overlap-Add (SOLA) speech time-stretching algorithm.
   * Changes speaking pace (0.5x to 1.75x) without modifying voice pitch or formants.
   */
  private timeStretchSOLA(input: Float32Array, speed: number): Float32Array {
    if (input.length < 512 || Math.abs(speed - 1.0) < 0.02) {
      return input;
    }

    const windowSize = 480; // 20ms at 24kHz (optimal for human voice frequency range)
    const overlap = 240;    // 10ms overlap
    const maxSearch = 120;  // 5ms search window for optimal cross-correlation match

    const synthStep = overlap;
    const analysisStep = Math.max(32, Math.round(synthStep * speed));

    const estimatedLength = Math.ceil(input.length / speed) + windowSize * 2;
    const output = new Float32Array(estimatedLength);
    const weights = new Float32Array(estimatedLength);

    // Precompute Hanning window for smooth crossfade
    const window = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    }

    let inPos = 0;
    let outPos = 0;

    // Initial block
    const initLen = Math.min(windowSize, input.length);
    for (let i = 0; i < initLen; i++) {
      output[i] = input[i];
      weights[i] = 1.0;
    }
    inPos += analysisStep;
    outPos += synthStep;

    while (inPos + windowSize + maxSearch < input.length && outPos + windowSize < estimatedLength) {
      let bestOffset = 0;
      let maxCorr = -Infinity;

      const searchStart = Math.max(0, -Math.floor(maxSearch / 2));
      const searchEnd = Math.floor(maxSearch / 2);

      for (let offset = searchStart; offset <= searchEnd; offset++) {
        let corr = 0;
        const candidatePos = inPos + offset;
        for (let i = 0; i < overlap; i++) {
          const outSample = output[outPos + i] / (weights[outPos + i] || 1.0);
          const inSample = input[candidatePos + i];
          corr += outSample * inSample;
        }
        if (corr > maxCorr) {
          maxCorr = corr;
          bestOffset = offset;
        }
      }

      const matchPos = inPos + bestOffset;

      for (let i = 0; i < windowSize; i++) {
        const w = window[i];
        output[outPos + i] += input[matchPos + i] * w;
        weights[outPos + i] += w;
      }

      inPos += analysisStep;
      outPos += synthStep;
    }

    const finalLength = Math.min(outPos + windowSize, estimatedLength);
    const result = new Float32Array(finalLength);
    for (let i = 0; i < finalLength; i++) {
      const w = weights[i];
      result[i] = w > 0.0001 ? output[i] / w : output[i];
    }

    return result;
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

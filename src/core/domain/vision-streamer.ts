// Vision & Screen Streamer for Gemini Live
// Captures video frames from Front/Back camera or Live Screen Share
// Encodes frames to low-latency compressed JPEG (1-5 FPS) for Gemini Live multimodal vision.

import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import type { LiveCameraLens } from './live-types';
import { NativeScreenShare } from '../../lib/native-screen-share';

export class VisionStreamer {
  private videoStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private frameInterval: number | null = null;

  private currentLens: LiveCameraLens = 'environment';
  private isScreenSharing = false;
  private isCameraActive = false;
  private acquisitionGen = 0;
  private warmupFramesRemaining = 0;

  /** Last camera capture callback/config so a background-paused camera can be resumed automatically. */
  private cameraFps = 5;
  private cameraOnFrame: ((jpegBase64: string) => void) | null = null;
  private cameraResumePending = false;
  private lifecycleHandle: PluginListenerHandle | null = null;
  /** AppState fires slightly before the overlay's own background handler. */
  private backgroundTransitionAt = 0;
  private lifecycleResumeInFlight = false;

  constructor() {}

  /** Start camera video stream (front or back lens). */
  async startCamera(
    lens: LiveCameraLens,
    fps: number,
    onFrame: (jpegBase64: string) => void,
  ): Promise<MediaStream> {
    // An explicit source change is a real teardown/restart. Do not let the
    // short background-transition grace window turn this into a pause.
    this.backgroundTransitionAt = 0;
    this.stop();
    const gen = this.acquisitionGen;
    this.currentLens = lens;
    this.isScreenSharing = false;
    this.cameraFps = fps;
    this.cameraOnFrame = onFrame;
    this.cameraResumePending = false;
    this.warmupFramesRemaining = 3;

    await this.ensureLifecycleListener();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (gen !== this.acquisitionGen) throw new Error('Camera acquisition superseded.');

    const baseVideo: MediaTrackConstraints = {
      width: { ideal: 640, max: 1280 },
      height: { ideal: 480, max: 720 },
      frameRate: { ideal: 15, max: 30 },
    };
    const stream = await this.acquireCamera(lens, baseVideo);

    if (gen !== this.acquisitionGen) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Camera acquisition superseded.');
    }

    this.videoStream = stream;
    this.isCameraActive = true;
    this.setupVideoProcessing(stream, fps, onFrame);
    return stream;
  }

  private async acquireCamera(
    lens: LiveCameraLens,
    baseVideo: MediaTrackConstraints,
  ): Promise<MediaStream> {
    const desired = lens === 'user' ? 'user' : 'environment';
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...baseVideo, facingMode: { exact: desired } },
        audio: false,
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...baseVideo, facingMode: lens === 'user' ? 'user' : { ideal: 'environment' } },
        audio: false,
      });
    }
  }

  /** Start screen sharing stream (displays PDF, coaching apps, browser, etc.). */
  async startScreenShare(
    fps: number,
    onFrame: (jpegBase64: string) => void,
    onEnded?: () => void,
  ): Promise<MediaStream | null> {
    // An explicit source change is a real teardown/restart, never a background pause.
    this.backgroundTransitionAt = 0;
    this.stop();
    const gen = this.acquisitionGen;
    this.isScreenSharing = true;
    this.isCameraActive = false;
    this.cameraResumePending = false;
    this.cameraOnFrame = null;
    this.warmupFramesRemaining = 3;

    await this.ensureLifecycleListener();

    if (NativeScreenShare.isNative()) {
      await NativeScreenShare.start(fps, onFrame, () => {
        this.stop();
        if (onEnded) onEnded();
      });
      if (gen !== this.acquisitionGen) {
        await NativeScreenShare.stop();
        throw new Error('Screen share acquisition superseded.');
      }
      return null;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen sharing is not supported by your current browser.');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 5, max: 15 },
      },
      audio: false,
    });

    if (gen !== this.acquisitionGen) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Screen share acquisition superseded.');
    }

    this.videoStream = stream;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        this.stop();
        if (onEnded) onEnded();
      };
    }

    this.setupVideoProcessing(stream, fps, onFrame);
    return stream;
  }

  /** Switch between Front ('user') and Back ('environment') camera. */
  async switchLens(
    fps: number,
    onFrame: (jpegBase64: string) => void,
  ): Promise<MediaStream> {
    const nextLens: LiveCameraLens = this.currentLens === 'user' ? 'environment' : 'user';
    return this.startCamera(nextLens, fps, onFrame);
  }

  getCurrentLens(): LiveCameraLens {
    return this.currentLens;
  }

  getIsCameraActive(): boolean {
    return this.isCameraActive;
  }

  getIsScreenSharing(): boolean {
    return this.isScreenSharing;
  }

  getStream(): MediaStream | null {
    return this.videoStream;
  }

  private async ensureLifecycleListener(): Promise<void> {
    if (this.lifecycleHandle || typeof document === 'undefined') return;
    this.lifecycleHandle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        if (this.cameraResumePending && this.isCameraActive === false && this.cameraOnFrame) {
          void this.resumePausedCamera();
        }
        return;
      }

      // The overlay calls stopVision() for the same transition. Record it first
      // so stopVision becomes a reversible PAUSE instead of a permanent teardown.
      this.backgroundTransitionAt = Date.now();
      if (this.isCameraActive) {
        this.cameraResumePending = true;
        this.pauseCameraForBackground();
      }
      // Native MediaProjection is backed by ScreenShareForegroundService, so
      // native screen sharing stays alive while the Activity is backgrounded.
      // Browser getDisplayMedia remains governed by the browser lifecycle.
    });
  }

  private pauseCameraForBackground(): void {
    if (!this.isCameraActive || !this.videoStream) return;
    if (this.frameInterval !== null) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    for (const track of this.videoStream.getVideoTracks()) {
      this.videoStream.removeTrack(track);
      track.stop();
    }
    if (this.videoElement) this.videoElement.srcObject = this.videoStream;
    this.isCameraActive = false;
    this.warmupFramesRemaining = 3;
  }

  private async resumePausedCamera(): Promise<void> {
    if (this.lifecycleResumeInFlight || !this.cameraResumePending || !this.cameraOnFrame) return;
    this.lifecycleResumeInFlight = true;
    const gen = ++this.acquisitionGen;
    const callback = this.cameraOnFrame;
    const fps = this.cameraFps;
    const lens = this.currentLens;

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const baseVideo: MediaTrackConstraints = {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 15, max: 30 },
      };
      const stream = await this.acquireCamera(lens, baseVideo);
      if (!this.cameraResumePending || !this.cameraOnFrame || gen !== this.acquisitionGen) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const stableStream = this.videoStream ?? new MediaStream();
      for (const oldTrack of stableStream.getVideoTracks()) {
        stableStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      for (const track of stream.getVideoTracks()) stableStream.addTrack(track);
      this.videoStream = stableStream;
      this.isScreenSharing = false;
      this.isCameraActive = true;
      this.cameraResumePending = false;
      this.warmupFramesRemaining = 4;
      this.setupVideoProcessing(stableStream, fps, callback);
    } catch (err) {
      console.warn('[VisionStreamer] Camera resume failed:', err);
      this.cameraResumePending = true;
    } finally {
      this.lifecycleResumeInFlight = false;
    }
  }

  private setupVideoProcessing(
    stream: MediaStream,
    fps: number,
    onFrame: (jpegBase64: string) => void,
  ): void {
    if (this.frameInterval !== null) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    if (!this.videoElement) {
      this.videoElement = document.createElement('video');
      this.videoElement.autoplay = true;
      this.videoElement.playsInline = true;
      this.videoElement.muted = true;
    }

    if (!this.canvasElement) {
      this.canvasElement = document.createElement('canvas');
      this.canvasCtx = this.canvasElement.getContext('2d', { willReadFrequently: true });
    }

    this.videoElement.srcObject = stream;
    void this.videoElement.play();

    const intervalMs = Math.max(200, Math.floor(1000 / Math.max(1, fps)));
    this.frameInterval = window.setInterval(() => {
      if (!this.videoElement || !this.canvasElement || !this.canvasCtx || this.videoElement.readyState < 2) return;
      if (this.warmupFramesRemaining > 0) {
        this.warmupFramesRemaining -= 1;
        return;
      }

      const videoWidth = this.videoElement.videoWidth || 640;
      const videoHeight = this.videoElement.videoHeight || 480;
      const maxDim = 640;
      const scale = Math.min(1, maxDim / Math.max(videoWidth, videoHeight));
      const targetWidth = Math.round(videoWidth * scale);
      const targetHeight = Math.round(videoHeight * scale);

      if (this.canvasElement.width !== targetWidth || this.canvasElement.height !== targetHeight) {
        this.canvasElement.width = targetWidth;
        this.canvasElement.height = targetHeight;
      }

      this.canvasCtx.drawImage(this.videoElement, 0, 0, targetWidth, targetHeight);
      if (this.isFrameBlank()) return;
      const dataUrl = this.canvasElement.toDataURL('image/jpeg', 0.6);
      const base64 = dataUrl.split(',')[1];
      if (base64) onFrame(base64);
    }, intervalMs);
  }

  /** Cheap luminance sample over a coarse grid. */
  private isFrameBlank(): boolean {
    if (!this.canvasCtx || !this.canvasElement) return false;
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;
    if (w === 0 || h === 0) return true;
    const stepX = Math.max(1, Math.floor(w / 16));
    const stepY = Math.max(1, Math.floor(h / 16));
    let sum = 0;
    let count = 0;
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const d = this.canvasCtx.getImageData(x, y, 1, 1).data;
        sum += (d[0] + d[1] + d[2]) / 3;
        count += 1;
      }
    }
    if (count === 0) return true;
    return sum / count < 6;
  }

  stop(): void {
    const isBackgroundTransition = Date.now() - this.backgroundTransitionAt < 2500;

    if (isBackgroundTransition) {
      if (this.isScreenSharing && NativeScreenShare.isNative()) {
        return;
      }
      if (this.isCameraActive) {
        this.cameraResumePending = true;
        this.pauseCameraForBackground();
        return;
      }
    }

    this.acquisitionGen += 1;
    if (this.isScreenSharing && NativeScreenShare.isNative()) {
      void NativeScreenShare.stop();
    }
    if (this.frameInterval !== null) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((track) => track.stop());
      this.videoStream = null;
    }
    if (this.videoElement) this.videoElement.srcObject = null;
    this.isCameraActive = false;
    this.isScreenSharing = false;
    this.cameraResumePending = false;
    this.cameraOnFrame = null;
    this.lifecycleResumeInFlight = false;
    this.backgroundTransitionAt = 0;
    if (this.lifecycleHandle) {
      void this.lifecycleHandle.remove();
      this.lifecycleHandle = null;
    }
  }
}

// Vision & Screen Streamer for Gemini Live.
// Camera + native MediaProjection screen share continue while an active Live call
// moves to background/PiP. Explicit Stop still tears down the source.

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

  /** Used only to distinguish Android lifecycle cleanup from an explicit user Stop. */
  private backgroundTransitionAt = 0;
  private lifecycleHandle: PluginListenerHandle | null = null;

  constructor() {}

  async startCamera(
    lens: LiveCameraLens,
    fps: number,
    onFrame: (jpegBase64: string) => void,
  ): Promise<MediaStream> {
    // Explicit camera start/switch is always a real teardown/restart.
    this.backgroundTransitionAt = 0;
    this.stop();
    const gen = this.acquisitionGen;
    this.currentLens = lens;
    this.isScreenSharing = false;
    this.isCameraActive = false;
    this.warmupFramesRemaining = 4;

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
      stream.getTracks().forEach((track) => track.stop());
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
        video: {
          ...baseVideo,
          facingMode: lens === 'user' ? 'user' : { ideal: 'environment' },
        },
        audio: false,
      });
    }
  }

  async startScreenShare(
    fps: number,
    onFrame: (jpegBase64: string) => void,
    onEnded?: () => void,
  ): Promise<MediaStream | null> {
    // Explicit source change is always a real teardown/restart.
    this.backgroundTransitionAt = 0;
    this.stop();
    const gen = this.acquisitionGen;
    this.isScreenSharing = true;
    this.isCameraActive = false;
    this.warmupFramesRemaining = 4;

    await this.ensureLifecycleListener();

    if (NativeScreenShare.isNative()) {
      await NativeScreenShare.start(fps, onFrame, () => {
        this.stop(true);
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
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Screen share acquisition superseded.');
    }

    this.videoStream = stream;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        this.stop(true);
        if (onEnded) onEnded();
      };
    }

    this.setupVideoProcessing(stream, fps, onFrame);
    return stream;
  }

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

  /** Track Android background/foreground only as state. Never stop vision here. */
  private async ensureLifecycleListener(): Promise<void> {
    if (this.lifecycleHandle || typeof document === 'undefined') return;
    this.lifecycleHandle = await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        // The overlay may call stopVision() in the same lifecycle turn. Keep a
        // short grace marker so that call is treated as lifecycle noise instead
        // of a destructive user action.
        this.backgroundTransitionAt = Date.now();
      } else {
        this.backgroundTransitionAt = 0;
      }
    });
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
    void this.videoElement.play().catch(() => undefined);

    // Gemini Live currently accepts video input at up to 1 frame/sec.
    // Clamp here even if an older/custom setting still requests a higher FPS.
    const effectiveFps = Math.min(1, Math.max(1, fps));
    const intervalMs = Math.max(1000, Math.floor(1000 / effectiveFps));
    this.frameInterval = window.setInterval(() => {
      if (
        !this.videoElement ||
        !this.canvasElement ||
        !this.canvasCtx ||
        this.videoElement.readyState < 2
      ) {
        return;
      }

      if (this.warmupFramesRemaining > 0) {
        this.warmupFramesRemaining -= 1;
        return;
      }

      const videoWidth = this.videoElement.videoWidth || 640;
      const videoHeight = this.videoElement.videoHeight || 480;
      const maxDim = 640;
      const scale = Math.min(1, maxDim / Math.max(videoWidth, videoHeight));
      const targetWidth = Math.max(1, Math.round(videoWidth * scale));
      const targetHeight = Math.max(1, Math.round(videoHeight * scale));

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

  /**
   * `force=true` is used only by explicit user/source-ended teardown. The
   * no-arg path is also called by the background lifecycle bridge; during the
   * short lifecycle window that call must be a no-op so the source remains live.
   */
  stop(force = false): void {
    const lifecycleNoise = !force && Date.now() - this.backgroundTransitionAt < 2500;
    if (lifecycleNoise) return;

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

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.isCameraActive = false;
    this.isScreenSharing = false;
    this.warmupFramesRemaining = 0;
    this.backgroundTransitionAt = 0;

    if (this.lifecycleHandle) {
      void this.lifecycleHandle.remove();
      this.lifecycleHandle = null;
    }
  }
}

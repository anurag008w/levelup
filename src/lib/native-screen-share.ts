import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface ScreenShareNative {
  requestPermission(): Promise<{ granted: boolean }>;
  startCapture(options: { width?: number; height?: number; fps?: number }): Promise<{ width: number; height: number; fps: number }>;
  stopCapture(): Promise<void>;
  isCapturing(): Promise<{ capturing: boolean }>;
  addListener(eventName: 'screenFrame', listenerFunc: (event: { data: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'screenShareStopped', listenerFunc: (event: { reason: string }) => void): Promise<PluginListenerHandle>;
}

const ScreenShare = registerPlugin<ScreenShareNative>('ScreenShare');

export class NativeScreenShare {
  private static frameHandle: PluginListenerHandle | null = null;
  private static stopHandle: PluginListenerHandle | null = null;

  static isSupported(): boolean {
    return Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia);
  }

  static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Request Android system MediaProjection permission and start capture.
   */
  static async start(
    fps: number,
    onFrame: (jpegBase64: string) => void,
    onStopped?: () => void,
  ): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;

    // 1. Request permission
    const perm = await ScreenShare.requestPermission();
    if (!perm.granted) {
      throw new Error('Screen share permission denied by user.');
    }

    // 2. Remove previous listeners
    if (this.frameHandle) {
      await this.frameHandle.remove();
      this.frameHandle = null;
    }
    if (this.stopHandle) {
      await this.stopHandle.remove();
      this.stopHandle = null;
    }

    // 3. Attach listeners
    this.frameHandle = await ScreenShare.addListener('screenFrame', (ev) => {
      if (ev.data) {
        onFrame(ev.data);
      }
    });

    this.stopHandle = await ScreenShare.addListener('screenShareStopped', () => {
      if (onStopped) onStopped();
    });

    // 4. Start native capture
    await ScreenShare.startCapture({
      width: 720,
      height: 1280,
      fps: Math.max(1, Math.min(fps, 10)),
    });

    return true;
  }

  /**
   * Stop native screen capture and cleanup listeners.
   */
  static async stop(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (this.frameHandle) {
        await this.frameHandle.remove();
        this.frameHandle = null;
      }
      if (this.stopHandle) {
        await this.stopHandle.remove();
        this.stopHandle = null;
      }
      await ScreenShare.stopCapture();
    } catch (err) {
      console.warn('[NativeScreenShare] Failed to stop capture:', err);
    }
  }
}

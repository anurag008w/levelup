package com.anurag.levelup;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.activity.result.ActivityResult;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Misa Live — Screen Share Plugin (Android Native MediaProjection)
 *
 * Android WebView does NOT support navigator.mediaDevices.getDisplayMedia().
 * This plugin bridges the gap using Android's MediaProjection API:
 *   1. requestPermission()  → shows system screen capture permission dialog
 *   2. startCapture(fps)    → starts foreground service (Android 10+), obtains
 *                             MediaProjection token, registers callback (Android 14+),
 *                             creates VirtualDisplay + ImageReader pipeline,
 *                             emits "screenFrame" events with base64 JPEG data
 *   3. stopCapture()        → tears down projection + virtual display + foreground service
 *
 * The JS layer (vision-streamer.ts) listens to "screenFrame" events and feeds
 * each JPEG frame into the Gemini Live WebSocket exactly like camera frames.
 *
 * Verified against Android 14/15/16 official MediaProjection lifecycle requirements.
 */
@CapacitorPlugin(name = "ScreenShare")
public class ScreenSharePlugin extends Plugin {

    private static final String TAG = "ScreenSharePlugin";

    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;

    private int pendingResultCode = 0;
    private Intent pendingResultData = null;

    private int captureWidth = 720;
    private int captureHeight = 1280;
    private int captureFps = 5;
    private int screenDensity;

    private volatile boolean isCapturing = false;
    private long lastFrameMs = 0;
    private long minFrameIntervalMs = 200; // 5fps default

    @Override
    public void load() {
        projectionManager = (MediaProjectionManager)
            getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        if (wm != null) {
            wm.getDefaultDisplay().getMetrics(metrics);
            screenDensity = metrics.densityDpi;
        }
    }

    /**
     * Step 1: Show the system MediaProjection permission dialog.
     * JS: await ScreenShare.requestPermission()
     * Emits result as { granted: boolean }
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (projectionManager == null) {
            call.reject("MediaProjection not available on this device");
            return;
        }
        Intent permIntent = projectionManager.createScreenCaptureIntent();
        startActivityForResult(call, permIntent, "handleProjectionResult");
    }

    @ActivityCallback
    private void handleProjectionResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            pendingResultCode = result.getResultCode();
            pendingResultData = result.getData();
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            pendingResultCode = 0;
            pendingResultData = null;
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
        }
    }

    /**
     * Step 2: Start capturing screen frames.
     * Android 14+ strict requirement: foreground service MUST be active BEFORE
     * calling getMediaProjection(), and registerCallback MUST be called BEFORE
     * createVirtualDisplay().
     */
    @PluginMethod
    public void startCapture(PluginCall call) {
        if (pendingResultCode == 0 || pendingResultData == null) {
            call.reject("No MediaProjection token — call requestPermission first");
            return;
        }
        if (isCapturing) {
            call.resolve(); // already running
            return;
        }

        captureWidth  = call.getInt("width",  720);
        captureHeight = call.getInt("height", 1280);
        captureFps    = call.getInt("fps",    5);
        minFrameIntervalMs = 1000L / Math.max(1, Math.min(captureFps, 30));

        try {
            // 1. Start foreground service on all Android versions (Android 7 to 16+)
            Intent svcIntent = new Intent(getContext(), ScreenShareForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(svcIntent);
            } else {
                getContext().startService(svcIntent);
            }

            // 2. Create background capture thread
            captureThread = new HandlerThread("ScreenShareCapture");
            captureThread.start();
            captureHandler = new Handler(captureThread.getLooper());

            // 3. Obtain MediaProjection token
            mediaProjection = projectionManager.getMediaProjection(
                pendingResultCode, pendingResultData
            );

            if (mediaProjection == null) {
                call.reject("Failed to obtain MediaProjection instance");
                return;
            }

            // 4. Register callback BEFORE createVirtualDisplay (MANDATORY on Android 14+)
            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    teardown();
                    JSObject ev = new JSObject();
                    ev.put("reason", "system_stopped");
                    notifyListeners("screenShareStopped", ev);
                }
            }, captureHandler);

            // 5. ImageReader: RGBA_8888 for high-fidelity zero-copy capture
            imageReader = ImageReader.newInstance(
                captureWidth, captureHeight,
                PixelFormat.RGBA_8888, 3
            );

            imageReader.setOnImageAvailableListener(reader -> {
                long now = System.currentTimeMillis();
                if (now - lastFrameMs < minFrameIntervalMs) {
                    Image img = reader.acquireLatestImage();
                    if (img != null) img.close();
                    return;
                }
                lastFrameMs = now;
                processFrame(reader);
            }, captureHandler);

            // 6. Create VirtualDisplay attached to the ImageReader surface
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "MisaLiveScreenShare",
                captureWidth, captureHeight, screenDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null, captureHandler
            );

            isCapturing = true;
            JSObject ret = new JSObject();
            ret.put("width", captureWidth);
            ret.put("height", captureHeight);
            ret.put("fps", captureFps);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "startCapture failed: " + e.getMessage(), e);
            teardown();
            call.reject("Screen capture initialization failed: " + e.getMessage());
        }
    }

    private void processFrame(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;

            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride   = planes[0].getRowStride();
            int rowPadding  = rowStride - pixelStride * captureWidth;

            Bitmap bmp = Bitmap.createBitmap(
                captureWidth + rowPadding / pixelStride,
                captureHeight,
                Bitmap.Config.ARGB_8888
            );
            bmp.copyPixelsFromBuffer(buffer);

            Bitmap cropped = (rowPadding == 0) ? bmp :
                Bitmap.createBitmap(bmp, 0, 0, captureWidth, captureHeight);

            // Scale to max width 640px for Gemini Live optimal bandwidth & latency
            int outW = Math.min(captureWidth, 640);
            int outH = (int) (captureHeight * ((float) outW / captureWidth));
            Bitmap scaled = Bitmap.createScaledBitmap(cropped, outW, outH, false);

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 60, baos);
            byte[] jpegData = baos.toByteArray();
            String b64 = Base64.encodeToString(jpegData, Base64.NO_WRAP);

            JSObject ev = new JSObject();
            ev.put("data", b64);
            notifyListeners("screenFrame", ev);

            if (scaled != cropped) scaled.recycle();
            if (cropped != bmp) cropped.recycle();
            bmp.recycle();

        } catch (Exception e) {
            Log.w(TAG, "processFrame error: " + e.getMessage());
        } finally {
            if (image != null) image.close();
        }
    }

    /**
     * Step 3: Stop screen capture.
     * JS: await ScreenShare.stopCapture()
     */
    @PluginMethod
    public void stopCapture(PluginCall call) {
        teardown();
        JSObject ev = new JSObject();
        ev.put("reason", "user_stopped");
        notifyListeners("screenShareStopped", ev);
        call.resolve();
    }

    /** Check if currently capturing. */
    @PluginMethod
    public void isCapturing(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("capturing", isCapturing);
        call.resolve(ret);
    }

    private void teardown() {
        isCapturing = false;
        pendingResultCode = 0;
        pendingResultData = null;
        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }
        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
        }
        captureHandler = null;

        try {
            Intent svcIntent = new Intent(getContext(), ScreenShareForegroundService.class);
            getContext().stopService(svcIntent);
        } catch (Exception ignored) {}
    }
}

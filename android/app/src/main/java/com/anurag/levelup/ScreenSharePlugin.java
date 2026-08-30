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

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Misa Live — Screen Share Plugin (Android Native MediaProjection)
 *
 * Android WebView does NOT support navigator.mediaDevices.getDisplayMedia().
 * This plugin bridges the gap using Android's MediaProjection API:
 *   1. requestPermission()  → shows system screen capture permission dialog
 *   2. startCapture(fps)    → creates VirtualDisplay + ImageReader pipeline,
 *                             emits "screenFrame" events with base64 JPEG data
 *   3. stopCapture()        → tears down projection + virtual display
 *
 * The JS layer (vision-streamer.ts) listens to "screenFrame" events and feeds
 * each JPEG frame into the Gemini Live WebSocket exactly like camera frames.
 *
 * Compatibility: Android 7+ (API 24+). Foreground service is started on
 * Android 10+ (API 29+) as required by MediaProjection restrictions.
 */
@CapacitorPlugin(name = "ScreenShare")
public class ScreenSharePlugin extends Plugin {

    private static final String TAG = "ScreenSharePlugin";
    private static final int REQUEST_MEDIA_PROJECTION = 1001;

    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;

    private int captureWidth = 720;
    private int captureHeight = 1280;
    private int captureFps = 5;
    private int screenDensity;

    private volatile boolean isCapturing = false;
    private long lastFrameMs = 0;
    private long minFrameIntervalMs = 200; // 5fps default

    // Saved call for the async permission result
    private PluginCall permissionCall;

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
        this.permissionCall = call;
        Intent permIntent = projectionManager.createScreenCaptureIntent();
        startActivityForResult(call, permIntent, "handleProjectionResult");
    }

    @ActivityCallback
    private void handleProjectionResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            // Store the projection token — valid for one capture session
            mediaProjection = projectionManager.getMediaProjection(
                result.getResultCode(), result.getData()
            );
            // Register stop callback to clean up when projection is revoked
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                mediaProjection.registerCallback(new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        teardown();
                        JSObject ev = new JSObject();
                        ev.put("reason", "system_stopped");
                        notifyListeners("screenShareStopped", ev);
                    }
                }, null);
            }
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
        }
    }

    /**
     * Step 2: Start capturing screen frames.
     * JS: await ScreenShare.startCapture({ width, height, fps })
     * Emits "screenFrame" events: { data: "<base64-jpeg>" }
     * Emits "screenShareStopped" when done.
     */
    @PluginMethod
    public void startCapture(PluginCall call) {
        if (mediaProjection == null) {
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

        // Start foreground service on Android 10+ (required for MediaProjection)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Intent svcIntent = new Intent(getContext(), ScreenShareForegroundService.class);
            svcIntent.putExtra("action", "start");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(svcIntent);
            } else {
                getContext().startService(svcIntent);
            }
        }

        // Create background capture thread
        captureThread = new HandlerThread("ScreenShareCapture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        // ImageReader: JPEG format for zero-copy encoding
        imageReader = ImageReader.newInstance(
            captureWidth, captureHeight,
            PixelFormat.RGBA_8888, 3 // 3-frame queue buffer
        );

        // Throttle: only process when enough time has passed
        imageReader.setOnImageAvailableListener(reader -> {
            long now = System.currentTimeMillis();
            if (now - lastFrameMs < minFrameIntervalMs) {
                // Drop frame — too soon
                Image img = reader.acquireLatestImage();
                if (img != null) img.close();
                return;
            }
            lastFrameMs = now;
            processFrame(reader);
        }, captureHandler);

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

            // Build bitmap from ImageReader plane (handles row padding)
            Bitmap bmp = Bitmap.createBitmap(
                captureWidth + rowPadding / pixelStride,
                captureHeight,
                Bitmap.Config.ARGB_8888
            );
            bmp.copyPixelsFromBuffer(buffer);

            // Crop away row padding if any
            Bitmap cropped = (rowPadding == 0) ? bmp :
                Bitmap.createBitmap(bmp, 0, 0, captureWidth, captureHeight);

            // Scale down for bandwidth: max 640px width for Gemini Live
            int outW = Math.min(captureWidth, 640);
            int outH = (int) (captureHeight * ((float) outW / captureWidth));
            Bitmap scaled = Bitmap.createScaledBitmap(cropped, outW, outH, false);

            // Compress to JPEG
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 60, baos);
            byte[] jpegData = baos.toByteArray();
            String b64 = Base64.encodeToString(jpegData, Base64.NO_WRAP);

            // Emit to JS
            JSObject ev = new JSObject();
            ev.put("data", b64);
            notifyListeners("screenFrame", ev);

            // Cleanup
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

        // Stop foreground service
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Intent svcIntent = new Intent(getContext(), ScreenShareForegroundService.class);
            getContext().stopService(svcIntent);
        }
    }
}

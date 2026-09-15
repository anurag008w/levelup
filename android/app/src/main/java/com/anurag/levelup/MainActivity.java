package com.anurag.levelup;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import android.app.PictureInPictureParams;

public class MainActivity extends BridgeActivity {
    /** App ka dark background — status bar isse match karta hai (#060506). */
    private static final int STATUS_BAR_COLOR = Color.rgb(0x06, 0x05, 0x06);

    /** PiP exit notification — JS side ko batata hai ki user PiP se wapas aaya. */
    private static LiveCompanionPlugin livePlugin;

    /** Current Activity instance — PiP enter karne ke liye (singleTask launch mode). */
    private static MainActivity instance;

    /**
     * Live call abhi chal rahi hai ya nahi — {@link LiveCompanionPlugin#start}/
     * {@link LiveCompanionPlugin#stop} se set hota hai. `onUserLeaveHint` isi
     * flag ko check karta hai taaki har normal Home-press par PiP na khul jaaye,
     * sirf active call ke dauraan.
     */
    private static volatile boolean liveCallActive = false;

    public static MainActivity getInstance() {
        return instance;
    }

    /**
     * JS se (LiveCompanionPlugin.start/stop) call hota hai jab live call
     * shuru/khatam hoti hai. Android 12+ (API 31+) par turant
     * `setAutoEnterEnabled` set kar deta hai — is se PiP timing-race ke bina
     * hi reliably trigger hoti hai (onUserLeaveHint ki wait nahi karni padti).
     */
    public static void setLiveCallActive(boolean active) {
        liveCallActive = active;
        MainActivity activity = getInstance();
        if (activity != null) activity.updateAutoEnterPip(active);
    }

    private void updateAutoEnterPip(boolean enabled) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return; // auto-enter sirf API 31+
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(9, 16))
                .setAutoEnterEnabled(enabled)
                .build();
            setPictureInPictureParams(params);
        } catch (Exception ignored) { }
    }

    /** JS se call hota hai — Activity ko PiP mode me bhejta hai. */
    public static void enterPictureInPicture() {
        MainActivity activity = getInstance();
        if (activity == null) return;
        try {
            if (activity.isInPictureInPictureMode()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(9, 16))
                    .build();
                activity.enterPictureInPictureMode(params);
            }
        } catch (Exception ignored) { }
    }

    /** Plugin construction time par self-register hota hai (see LiveCompanionPlugin.load). */
    public static void registerLivePlugin(LiveCompanionPlugin plugin) {
        livePlugin = plugin;
    }

    /** Plugin call ke through bhi PiP enter kar sakte ho. */
    public static void enterPiPViaPlugin(LiveCompanionPlugin plugin) {
        livePlugin = plugin;
        enterPictureInPicture();
    }

    /**
     * PiP mode enter/exit callback — isme koi sensitive UI hide nahi karna
     * (live call overlay PiP me bhi dikhna chahiye). JS ko notify karte hain
     * taaki background logic chalu rahe.
     */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (liveCallActive) {
            enterPictureInPicture();
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPictureInPictureMode, android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPictureInPictureMode, newConfig);
        LiveCompanionPlugin plugin = livePlugin;
        if (plugin != null) {
            plugin.onPiPModeChanged(inPictureInPictureMode);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        instance = this;
        registerPlugin(BackgroundPermissionPlugin.class);
        registerPlugin(AudioRoutePlugin.class);
        registerPlugin(ScreenSharePlugin.class);
        registerPlugin(LiveCompanionPlugin.class);
        registerPlugin(GaplessAudioTrackPlugin.class);
        super.onCreate(savedInstanceState);
        hideStatusBar();
        if (LiveCompanionForegroundService.isActive()) {
            liveCallActive = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The FGS is the authoritative source after Activity recreation. Re-arm
        // the Activity from it instead of trusting static state from the destroyed
        // Activity/old JS bridge.
        if (LiveCompanionForegroundService.isActive()) {
            liveCallActive = true;
            updateAutoEnterPip(true);
        }
        hideStatusBar();
    }

    @Override
    public void onDestroy() {
        // A destroyed Activity must not be allowed to clear state belonging to a
        // newer Activity instance created during rotation/PiP/split-screen.
        if (instance == this) {
            instance = null;
            // Only clear the process-local flag when this Activity is still the
            // current owner AND the authoritative FGS is no longer active.
            if (!LiveCompanionForegroundService.isActive()) {
                liveCallActive = false;
                livePlugin = null;
            }
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideStatusBar();
        }
    }

    private void hideStatusBar() {
        Window window = getWindow();
        if (window == null) return;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;
        controller.setAppearanceLightStatusBars(false);
        window.setStatusBarColor(STATUS_BAR_COLOR);
        controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
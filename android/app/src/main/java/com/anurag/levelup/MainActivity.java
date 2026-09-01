package com.anurag.levelup;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** App ka dark background — status bar isse match karta hai (#060506). */
    private static final int STATUS_BAR_COLOR = Color.rgb(0x06, 0x05, 0x06);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundPermissionPlugin.class);
        registerPlugin(AudioRoutePlugin.class);
        registerPlugin(ScreenSharePlugin.class);
        registerPlugin(LiveCompanionPlugin.class);
        super.onCreate(savedInstanceState);
        hideStatusBar();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Focus wapas aane par (dialog/notification shade/keyboard band) bars
        // system se wapas aa sakte hain — immersive sticky dobaara apply karo.
        if (hasFocus) {
            hideStatusBar();
        }
    }

    /**
     * Status bar (time/battery/icons wala top bar) auto-hide karta hai.
     *
     * Immersive sticky: user top se swipe kare toh bar transient dikhta hai,
     * 2-3 second baad apne aap wapas chala jata hai — "auto-hide".
     *
     * Compatibility (har Android pe supported):
     *  - API 21-29 (Android 5-10): WindowInsetsControllerCompat legacy System UI
     *    flags use karta hai — bina kisi issue ke.
     *  - API 30+ (Android 11+): native WindowInsetsController.
     *  - Android 15/16 (API 35/36) edge-to-edge enforcement ke saath bhi
     *    hide() supported hai (official immersive-mode docs).
     *  - Navigation bar (bottom) intentionally untouched — app ka existing
     *    layout/logic waisa hi rehta hai.
     *
     * Transient bar (swipe pe aata hai) app ke dark theme se match karta hai:
     *  - Background: STATUS_BAR_COLOR (app ka --color-bg) — API 34 tak direct;
     *    Android 15+ pe edge-to-edge enforced hai, isliye status bar
     *    transparent hi rehta hai aur webview ka dark background dikhta hai.
     *  - Icons: light (white) — setAppearanceLightStatusBars(false), jo
     *    dark background pe readable rehte hain (API 23+).
     */
    private void hideStatusBar() {
        Window window = getWindow();
        if (window == null) return;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;

        // Dark bg pe light icons — Android 15/16 pe bhi icons sahi dikhein.
        controller.setAppearanceLightStatusBars(false);

        // Transient bar ka background app ke dark theme se match karo.
        window.setStatusBarColor(STATUS_BAR_COLOR);

        controller.hide(WindowInsetsCompat.Type.statusBars());
        // Transient bars: swipe se dikhe, timeout ke baad auto-hide.
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}

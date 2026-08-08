package com.anurag.levelup;

import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundPermissionPlugin.class);
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
     */
    private void hideStatusBar() {
        Window window = getWindow();
        if (window == null) return;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;

        controller.hide(WindowInsetsCompat.Type.statusBars());
        // Transient bars: swipe se dikhe, timeout ke baad auto-hide.
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}

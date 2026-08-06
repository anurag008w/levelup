package com.anurag.levelup;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Background & battery permissions helper.
 *
 * Android OEMs (Xiaomi, Oppo, Vivo, Realme, OnePlus, Huawei, Samsung...) kill
 * background apps aggressively. Without an autostart allowlist entry and a
 * battery-optimization exemption the app's process gets killed, so AI-reply
 * notifications stop arriving and notification replies get dropped. This plugin
 * lets the JS layer:
 *   - check whether battery optimization is already disabled for this app,
 *   - open the system "ignore battery optimizations" request,
 *   - open the OEM's autostart settings screen (with a graceful fallback).
 *
 * Web (browser) builds never register this plugin — the JS wrapper no-ops.
 */
@CapacitorPlugin(name = "BackgroundPermission")
public class BackgroundPermissionPlugin extends Plugin {

    /**
     * Well-known OEM autostart / background-allowlist settings screens.
     * Ordered by popularity; the first one that resolves is launched.
     */
    private static final String[][] AUTOSTART_TARGETS = {
        { "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity" },   // Xiaomi / Redmi / POCO (MIUI)
        { "com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity" },                // itel / Tecno / Infinix (Transsion — HiOS/XOS phone master)
        { "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity" }, // Huawei / Honor
        { "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity" },       // Oppo (ColorOS)
        { "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity" },               // Oppo (older)
        { "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity" },                        // Oppo (older)
        { "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity" },      // Vivo (Funtouch/OriginOS)
        { "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity" },                        // Vivo / iQOO
        { "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity" },        // OnePlus (OxygenOS)
        { "com.samsung.android.lool", "com.samsung.android.lool.BatteryActivity" },                            // Samsung (Smart Manager)
        { "com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity" },                     // Samsung (Android 7–9)
        { "com.samsung.android.sm", "com.samsung.android.sm.battery.ui.BatteryActivity" },                     // Samsung (Android 10+)
        { "com.motorola.motocare", "com.motorola.motocare.internal.ui.MainActivity" },                         // Motorola
        { "com.asus.mobilemanager", "com.asus.mobilemanager.powersaver.PowerSaverActivity" },                  // ASUS
    };

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Context ctx = getContext();
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            boolean whitelisted = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            result.put("batteryWhitelisted", whitelisted);
        } catch (Exception e) {
            result.put("batteryWhitelisted", false);
        }
        result.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        Intent target = resolveAutostartIntent();
        result.put("autostartSupported", target != null);
        result.put("autostartPackage", target != null ? target.getComponent().getPackageName() : null);
        call.resolve(result);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Context ctx = getContext();
            // System dialog: "Allow LevelUp to ignore battery optimizations?"
            // Requires REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest.
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            ctx.startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception e) {
            // Some OEMs hide the request dialog — fall back to the full list.
            try {
                Context ctx = getContext();
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                ctx.startActivity(intent);
                call.resolve(new JSObject().put("opened", true).put("fallback", true));
            } catch (Exception e2) {
                call.resolve(new JSObject().put("opened", false).put("reason", e2.getMessage()));
            }
        }
    }

    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Intent target = resolveAutostartIntent();
        if (target != null) {
            try {
                getContext().startActivity(target);
                call.resolve(new JSObject().put("opened", true));
                return;
            } catch (Exception ignored) {
                // fall through to app details
            }
        }
        // Fallback: app's own details screen — every OEM exposes Autostart /
        // Battery / App management entries there.
        try {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
            getContext().startActivity(fallback);
            call.resolve(new JSObject().put("opened", true).put("fallback", true));
        } catch (Exception e) {
            call.resolve(new JSObject().put("opened", false).put("reason", e.getMessage()));
        }
    }

    /** Returns a resolvable OEM autostart intent, or null when none is known. */
    private Intent resolveAutostartIntent() {
        for (String[] target : AUTOSTART_TARGETS) {
            Intent intent = new Intent();
            intent.setClassName(target[0], target[1]);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(getContext().getPackageManager()) != null) {
                return intent;
            }
        }
        return null;
    }
}

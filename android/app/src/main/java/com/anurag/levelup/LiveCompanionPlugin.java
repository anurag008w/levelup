package com.anurag.levelup;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LiveCompanion")
public class LiveCompanionPlugin extends Plugin {
  private static final String TAG = "LiveCompanionPlugin";
  private static final String PREFS_NAME = "live_call_state";
  private static final String KEY_WAS_INTERRUPTED = "was_interrupted";

  /** Idempotency guard: armLiveCall() → start() must not double-start the FGS. */
  private static boolean foregroundServiceStarted = false;

  @Override
  public void load() {
    super.load();
    // Self-register so the auto PiP path (onUserLeaveHint) can dispatch the
    // pipModeChanged callback to JS even when enterPiP was never called
    // explicitly. Without this, livePlugin stays null and the PiP callback
    // is silently lost on the automatic entry path.
    MainActivity.registerLivePlugin(this);
  }

  private void ensureForegroundService() {
    if (foregroundServiceStarted) return;
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
    foregroundServiceStarted = true;
  }

  /**
   * PROCESS-DEATH RECOVERY (review item 5): persist the "a live call was in
   * progress" intent BEFORE the call runs. If Android/OEM kills the process
   * mid-call (the FGS is START_NOT_STICKY and the session lives in the
   * WebView — a hard platform limit), the flag survives and JS surfaces it on
   * next launch instead of the interruption being invisible.
   */
  private void markCallInterrupted() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().putBoolean(KEY_WAS_INTERRUPTED, true).apply();
  }

  /** Explicit user hangup — the call ended intentionally, so no interruption banner. */
  private void clearCallInterrupted() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().remove(KEY_WAS_INTERRUPTED).apply();
  }

  @PluginMethod public void start(PluginCall call) {
    // Live call ab active hai — MainActivity ko batao taaki onUserLeaveHint
    // (Home/Recents press) par PiP reliably trigger ho, aur API 31+ par
    // auto-enter turant arm ho jaaye.
    markCallInterrupted();
    ensureForegroundService();
    MainActivity.setLiveCallActive(true);
    call.resolve();
  }

  @PluginMethod public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class));
    foregroundServiceStarted = false;
    MainActivity.setLiveCallActive(false);
    clearCallInterrupted();
    call.resolve();
  }

  /**
   * Arm PiP *before* the call actually connects. Called from JS when the live
   * overlay opens (stream acquisition starts), so a Home press during the
   * multi-second connecting window still enters PiP instead of silently doing
   * nothing (exact bug being fixed). Also starts the foreground service so the
   * process stays eligible for background execution while connecting.
   * Idempotent: repeated calls (e.g. re-arm after Activity recreation) are
   * no-ops once the service is running and the Activity is armed.
   */
  @PluginMethod public void armLiveCall(PluginCall call) {
    markCallInterrupted();
    ensureForegroundService();
    MainActivity.setLiveCallActive(true);
    call.resolve();
  }

  /** PiP mode — foreground service active hai, background me bhi mic + audio chalta rahe. */
  @PluginMethod public void enterPiP(PluginCall call) {
    MainActivity.enterPiPViaPlugin(this);
    call.resolve();
  }

  /** PiP mode changed callback — JS side ko notify karo (background/foreground transitions). */
  public void onPiPModeChanged(boolean inPiP) {
    JSObject payload = new JSObject();
    payload.put("inPictureInPicture", inPiP);
    notifyListeners("pipModeChanged", payload);
  }

  /** Was a live call interrupted by process death since the last explicit hangup? */
  @PluginMethod public void isLiveCallInterrupted(PluginCall call) {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    JSObject ret = new JSObject();
    ret.put("interrupted", prefs.getBoolean(KEY_WAS_INTERRUPTED, false));
    call.resolve(ret);
  }

  /** Dismiss the interruption banner (user acknowledged). */
  @PluginMethod public void clearLiveCallInterrupted(PluginCall call) {
    clearCallInterrupted();
    call.resolve();
  }
}
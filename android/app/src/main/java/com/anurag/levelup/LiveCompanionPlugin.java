package com.anurag.levelup;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
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
  private static final String KEY_LIFECYCLE = "lifecycle";

  // Lifecycle states (review 8 / P1): the "was interrupted" banner must only
  // surface when the call had actually reached a CONNECTED state before a
  // process death. markCallInterrupted() sets ARMED on arm; the JS bridge
  // promotes it to CONNECTED the moment the Gemini session commits. A process
  // kill during the connecting window therefore reads back as an ATTEMPTED
  // (un-armed) call — never a false "previous live call was interrupted".
  private static final String LIFECYCLE_ARMED = "ARMED";
  private static final String LIFECYCLE_CONNECTED = "CONNECTED";

  // NOTE (review 7 / P1): there is deliberately NO static "is the service
  // running" flag anymore. A process-local boolean can drift from the real
  // Android Service lifecycle (killed service, two identical plugin instances
  // after a reload, etc.), and trusting it as the source of truth lets the two
  // drift apart silently. The Service itself is the authority: it is started by
  // startForegroundService() and stopped by stopService(); both are idempotent
  // by definition — startForegroundService() on an already-running service just
  // re-delivers onStartCommand() (which re-posts the same notification, same
  // id), and stopService() on a non-running service is a no-op. The plugin only
  // issues start/stop requests and never pretends to know the Service state.

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
    // The Android Service lifecycle is authoritative and idempotent — see the
    // class-level note. No static guard: a duplicate start is a harmless
    // re-delivery of onStartCommand(), and stopService() is a no-op if the
    // service is not running.
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
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
    // ARMED: the call was begun but not yet confirmed connected. Only
    // markCallConnected() (called on a committed Gemini session) upgrades this
    // to a recoverable "interrupted by process death" truth.
    prefs.edit().putString(KEY_LIFECYCLE, LIFECYCLE_ARMED).apply();
  }

  /**
   * The Gemini session has committed (audio + voice + vision live) — promote
   * the persisted lifecycle to CONNECTED so a later process death correctly
   * surfaces the "previous live call was interrupted" recovery UX. A kill
   * before this point is an un-finished startup, not an interrupted call.
   */
  public void markCallConnected() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().putString(KEY_LIFECYCLE, LIFECYCLE_CONNECTED).apply();
  }

  /** Explicit user hangup — the call ended intentionally, so no interruption banner. */
  private void clearCallInterrupted() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().remove(KEY_WAS_INTERRUPTED).remove(KEY_LIFECYCLE).apply();
  }

  @PluginMethod public void start(PluginCall call) {
    // Live call ab active hai — MainActivity ko batao taaki onUserLeaveHint
    // (Home/Recents press) par PiP reliably trigger ho, aur API 31+ par
    // auto-enter turant arm ho jaaye.
    // Review-9 P2.17 observability: log FGS arm request + API level (no secrets).
    Log.i(TAG, "FGS arm requested api=" + Build.VERSION.SDK_INT);
    markCallInterrupted();
    ensureForegroundService();
    MainActivity.setLiveCallActive(true);
    call.resolve();
  }

  @PluginMethod public void stop(PluginCall call) {
    // stopService() on a non-running service is a no-op — no flag to reset.
    Log.i(TAG, "FGS stop requested api=" + Build.VERSION.SDK_INT + " active=" + LiveCompanionForegroundService.isActive());
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class));
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

  /** Promote the persisted lifecycle to CONNECTED once the session commits (review 8). */
  @PluginMethod public void markCallConnected(PluginCall call) {
    markCallConnected();
    call.resolve();
  }

  /**
   * Review-9 P1.4: authoritative FGS ACTIVE state, queried from the Service's
   * own lifecycle flag (onCreate→true, onDestroy→false). Lets JS distinguish
   * "startForegroundService() was requested" (ARMING) from "actually running"
   * (ACTIVE) — so the live layer never claims FGS-backed background support
   * when the service died unexpectedly.
   */
  @PluginMethod public void isServiceActive(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("active", LiveCompanionForegroundService.isActive());
    call.resolve(ret);
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
    // This is DETECTION/UX, not session recovery (review 8 / P1): a process
    // kill mid-session simply ends the session in place (FGS is
    // START_NOT_STICKY, session lives in the WebView). The banner only
    // appears when the call had actually reached CONNECTED — an ARMED-but-never
    // connected startup is reported as an attempted call, not an interrupted one.
    String lifecycle = prefs.getString(KEY_LIFECYCLE, null);
    boolean interrupted = LIFECYCLE_CONNECTED.equals(lifecycle);
    ret.put("interrupted", interrupted);
    ret.put("attempted", LIFECYCLE_ARMED.equals(lifecycle) || interrupted);
    call.resolve(ret);
  }

  /** Dismiss the interruption banner (user acknowledged). */
  @PluginMethod public void clearLiveCallInterrupted(PluginCall call) {
    clearCallInterrupted();
    call.resolve();
  }
}
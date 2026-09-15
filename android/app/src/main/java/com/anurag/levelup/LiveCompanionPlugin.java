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

  private static final String LIFECYCLE_ARMED = "ARMED";
  private static final String LIFECYCLE_CONNECTED = "CONNECTED";

  @Override
  public void load() {
    super.load();
    MainActivity.registerLivePlugin(this);
  }

  private void ensureForegroundService() {
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
  }

  /** Persist call intent before starting the native service. */
  private void markCallInterrupted() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().putString(KEY_LIFECYCLE, LIFECYCLE_ARMED).apply();
  }

  /** Promote to CONNECTED only after the Gemini session has committed. */
  public void markCallConnected() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().putString(KEY_LIFECYCLE, LIFECYCLE_CONNECTED).apply();
  }

  private void clearCallInterrupted() {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    prefs.edit().remove(KEY_WAS_INTERRUPTED).remove(KEY_LIFECYCLE).apply();
  }

  @PluginMethod public void start(PluginCall call) {
    Log.i(TAG, "FGS arm requested api=" + Build.VERSION.SDK_INT);
    markCallInterrupted();
    ensureForegroundService();
    MainActivity.setLiveCallActive(true);
    call.resolve();
  }

  @PluginMethod public void stop(PluginCall call) {
    Log.i(TAG, "FGS stop requested api=" + Build.VERSION.SDK_INT + " active=" + LiveCompanionForegroundService.isActive());
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class));
    MainActivity.setLiveCallActive(false);
    clearCallInterrupted();
    call.resolve();
  }

  @PluginMethod public void armLiveCall(PluginCall call) {
    markCallInterrupted();
    ensureForegroundService();
    MainActivity.setLiveCallActive(true);
    call.resolve();
  }

  @PluginMethod public void markCallConnected(PluginCall call) {
    markCallConnected();
    call.resolve();
  }

  @PluginMethod public void isServiceActive(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("active", LiveCompanionForegroundService.isActive());
    call.resolve(ret);
  }

  @PluginMethod public void enterPiP(PluginCall call) {
    MainActivity.enterPiPViaPlugin(this);
    call.resolve();
  }

  public void onPiPModeChanged(boolean inPiP) {
    JSObject payload = new JSObject();
    payload.put("inPictureInPicture", inPiP);
    notifyListeners("pipModeChanged", payload);
  }

  /**
   * Reports the durable process-death marker once, then consumes it. Without
   * consumption an ARMED/CONNECTED value survived indefinitely and every later
   * launch could report a stale attempted/interrupted call.
   */
  @PluginMethod public void isLiveCallInterrupted(PluginCall call) {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    String lifecycle = prefs.getString(KEY_LIFECYCLE, null);
    boolean interrupted = LIFECYCLE_CONNECTED.equals(lifecycle);
    boolean attempted = LIFECYCLE_ARMED.equals(lifecycle) || interrupted;
    JSObject ret = new JSObject();
    ret.put("interrupted", interrupted);
    ret.put("attempted", attempted);
    if (attempted) {
      // Read-once marker. An intentional dismiss or a subsequent launch must not
      // inherit an old lifecycle forever. A currently running call is represented
      // by the live FGS and does not depend on this marker.
      prefs.edit().remove(KEY_LIFECYCLE).remove(KEY_WAS_INTERRUPTED).apply();
    }
    call.resolve(ret);
  }

  @PluginMethod public void clearLiveCallInterrupted(PluginCall call) {
    clearCallInterrupted();
    call.resolve();
  }
}
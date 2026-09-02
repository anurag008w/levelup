package com.anurag.levelup;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LiveCompanion")
public class LiveCompanionPlugin extends Plugin {
  @Override
  public void load() {
    super.load();
    // Self-register so the auto PiP path (onUserLeaveHint) can dispatch the
    // pipModeChanged callback to JS even when enterPiP was never called
    // explicitly. Without this, livePlugin stays null and the PiP callback
    // is silently lost on the automatic entry path.
    MainActivity.registerLivePlugin(this);
  }

  @PluginMethod public void start(PluginCall call) {
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
    // Live call ab active hai — MainActivity ko batao taaki onUserLeaveHint
    // (Home/Recents press) par PiP reliably trigger ho, aur API 31+ par
    // auto-enter turant arm ho jaaye.
    MainActivity.setLiveCallActive(true);
    call.resolve();
  }

  @PluginMethod public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class));
    MainActivity.setLiveCallActive(false);
    call.resolve();
  }

  /**
   * Arm PiP *before* the call actually connects. Called from JS when the live
   * overlay opens (stream acquisition starts), so a Home press during the
   * multi-second connecting window still enters PiP instead of silently doing
   * nothing (exact bug being fixed). Also starts the foreground service so the
   * process stays eligible for background execution while connecting.
   */
  @PluginMethod public void armLiveCall(PluginCall call) {
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
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
}

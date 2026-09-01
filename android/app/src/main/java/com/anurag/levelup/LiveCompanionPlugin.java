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
  @PluginMethod public void start(PluginCall call) {
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
    call.resolve();
  }

  @PluginMethod public void stop(PluginCall call) {
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class));
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

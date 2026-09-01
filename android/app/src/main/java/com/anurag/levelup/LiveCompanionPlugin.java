package com.anurag.levelup;

import android.content.Intent;
import android.os.Build;
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
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class)); call.resolve();
  }
}

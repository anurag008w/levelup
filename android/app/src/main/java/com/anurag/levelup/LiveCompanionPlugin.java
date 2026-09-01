package com.anurag.levelup;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LiveCompanion")
public class LiveCompanionPlugin extends Plugin {
  private static volatile LiveCompanionPlugin current;

  public LiveCompanionPlugin() { current = this; }

  @PluginMethod public void start(PluginCall call) {
    // Re-arm the reply bridge on every call start — the plugin instance is
    // registered once by Capacitor, but stop()/disconnect() null the static
    // reference, so we restore it here or future replies would be dropped.
    current = this;
    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i); else getContext().startService(i);
    call.resolve();
  }

  @PluginMethod public void stop(PluginCall call) {
    current = null;
    getContext().stopService(new Intent(getContext(), LiveCompanionForegroundService.class));
    call.resolve();
  }

  @PluginMethod public void disconnect(PluginCall call) {
    current = null;
    call.resolve();
  }

  /** Update the notification with the latest chat history so the user can keep
   * reading the conversation (and Misa's replies) from the shade.
   *
   * history: array of "U:..." (user) / "A:..." (assistant) lines, oldest first. */
  @PluginMethod public void updateNotification(PluginCall call) {
    JSObject args = call.getData();
    String[] history = null;
    try {
      if (args != null && args.has("history")) {
        Object raw = args.get("history");
        if (raw instanceof org.json.JSONArray) {
          org.json.JSONArray arr = (org.json.JSONArray) raw;
          history = new String[arr.length()];
          for (int i = 0; i < arr.length(); i++) history[i] = arr.optString(i, "");
        }
      }
    } catch (Exception ignored) { }

    Intent i = new Intent(getContext(), LiveCompanionForegroundService.class)
        .putExtra(LiveCompanionForegroundService.EXTRA_HISTORY, history);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i);
    else getContext().startService(i);
    call.resolve();
  }

  /** Receives a quick-reply fired from the call notification and forwards it
   * to the registered JS listener (see LiveCompanionForegroundService.java). */
  private void forwardUserReply(String text) {
    // notifyListeners is protected in Plugin — must be invoked through a
    // LiveCompanionPlugin-typed reference (subclass of Plugin), not a widened
    // Plugin reference, or javac rejects the protected access.
    LiveCompanionPlugin plugin = current;
    if (plugin == null) {
      // No plugin instance alive (JS not ready) — drop silently.
      return;
    }
    JSObject payload = new JSObject();
    payload.put("text", text);
    plugin.notifyListeners("notificationReply", payload);
  }

  /** Static entry point used by LiveCompanionReplyReceiver so the message can
   * reach a plugin instance created before the receiver ran. */
  public static void notifyUserMessage(Context context, String text) {
    LiveCompanionPlugin plugin = current;
    if (plugin != null) {
      plugin.forwardUserReply(text);
    }
  }
}

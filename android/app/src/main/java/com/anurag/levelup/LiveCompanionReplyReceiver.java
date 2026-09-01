package com.anurag.levelup;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;

/** Receives quick-reply text fired from the Misa Live call notification's
 * "Reply" action and hands it to the WebView so it can be sent to the live
 * model. The reply itself never touches local storage; it travels straight
 * from the notification input to the running Gemini Live session. */
public class LiveCompanionReplyReceiver extends BroadcastReceiver {
    public static final String EXTRA_QUICK_REPLY = "misa_live_quick_reply";

    @Override public void onReceive(Context context, Intent intent) {
        Bundle replies = RemoteInput.getResultsFromIntent(intent);
        if (replies == null) return;
        CharSequence text = replies.getCharSequence(EXTRA_QUICK_REPLY);
        if (text == null || text.length() == 0) return;

        // Push the typed message into the WebView. LiveCompanionPlugin holds a
        // listener registered from JS (LiveCompanionOverlay) and forwards it.
        LiveCompanionPlugin.notifyUserMessage(context, text.toString());

        // Re-show the (ongoing) notification so the user can keep chatting.
        Intent restart = new Intent(context, LiveCompanionForegroundService.class)
            .putExtra(LiveCompanionForegroundService.EXTRA_MESSAGE, text.toString());
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(restart);
        } else {
            context.startService(restart);
        }
    }
}

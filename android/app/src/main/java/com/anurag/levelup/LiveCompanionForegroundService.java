package com.anurag.levelup;

import android.app.*;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;

/** Foreground ownership for an active voice call.  Screen capture remains in
 * ScreenShareForegroundService; it must not be used as a disguised call service.
 *
 * The notification is a MessagingStyle "live chat": the user can quick-reply
 * straight from the notification and read Misa's latest responses without ever
 * reopening the app. Replies are forwarded to the WebView via
 * LiveCompanionReplyReceiver -> LiveCompanionPlugin -> JS listener. */
public class LiveCompanionForegroundService extends Service {
    static final String CHANNEL = "misa_live_call";
    static final int ID = 7422;
    static final String EXTRA_HISTORY = "misa_live_history";
    static final String EXTRA_MESSAGE = "misa_live_message";

    /** Most-recent conversation shown in the shade, kept in-process so a
     * quick-reply retrigger can append the user's message without losing the
     * thread (the JS side also pushes fresh history on every transcript tick). */
    private static volatile String[] lastHistory = new String[0];

    @Override public void onCreate() { super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel c = new NotificationChannel(CHANNEL,
                getString(R.string.notif_channel_live_call_name), NotificationManager.IMPORTANCE_LOW);
            c.setDescription(getString(R.string.notif_channel_live_call_desc));
            c.enableVibration(false);
            c.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(c);
        }
    }

    private Notification buildNotification(String[] history) {
        Intent launch = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pf = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle("Me");
        // Oldest first — descriptive headers instead of raw timestamps.
        for (int i = 0; i < history.length; i++) {
            String line = history[i];
            if (line == null) continue;
            long ts = 1_000L * (i + 1);
            if (line.startsWith("A:")) {
                style.addMessage(line.substring(2), ts, "Misa");
            } else if (line.startsWith("U:")) {
                style.addMessage(line.substring(2), ts, "Me");
            } else {
                // Fallback: treat unknown lines as Misa (safer than "Me").
                style.addMessage(line, ts, "Misa");
            }
        }
        if (history.length == 0) {
            style.addMessage(getString(R.string.notif_live_call_text), 1L, "Misa");
        }

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.notif_live_call_title))
            .setContentText(getString(R.string.notif_live_call_text))
            .setOngoing(true).setSilent(true)
            .setStyle(style)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(PendingIntent.getActivity(this, 0, launch, pf))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setShortcutId("misa_live_call");

        // Quick reply action (only meaningful on API 24+ / MessagingStyle).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Intent replyIntent = new Intent(this, LiveCompanionReplyReceiver.class);
            RemoteInput ri = new RemoteInput.Builder(LiveCompanionReplyReceiver.EXTRA_QUICK_REPLY)
                .setLabel(getString(R.string.notif_live_reply_hint)).build();
            PendingIntent replyPi = PendingIntent.getBroadcast(this, 1, replyIntent, pf);
            b.addAction(new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_send, getString(R.string.notif_live_reply_label), replyPi)
                .addRemoteInput(ri).build());
        }

        return b.build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        // Merge fresh state from the incoming intent with what we last showed,
        // so a quick-reply (which carries only the new user message) doesn't
        // wipe the conversation thread, and a JS history push replaces it.
        if (intent != null) {
            String[] freshHistory = intent.getStringArrayExtra(EXTRA_HISTORY);
            if (freshHistory != null) {
                lastHistory = freshHistory;
            } else {
                String newMessage = intent.getStringExtra(EXTRA_MESSAGE);
                if (newMessage != null && newMessage.length() > 0) {
                    String[] appended = new String[lastHistory.length + 1];
                    System.arraycopy(lastHistory, 0, appended, 0, lastHistory.length);
                    appended[lastHistory.length] = "U:" + newMessage;
                    lastHistory = appended;
                }
            }
        }

        Notification n = buildNotification(lastHistory);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            startForeground(ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    | android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        return START_NOT_STICKY;
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}

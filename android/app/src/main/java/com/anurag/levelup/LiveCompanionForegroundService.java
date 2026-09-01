package com.anurag.levelup;

import android.app.*;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/** Foreground ownership for an active voice call.  Screen capture remains in
 * ScreenShareForegroundService; it must not be used as a disguised call service. */
public class LiveCompanionForegroundService extends Service {
    static final String CHANNEL = "misa_live_call";
    static final int ID = 7422;
    @Override public void onCreate() { super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel c = new NotificationChannel(CHANNEL,
                getString(R.string.notif_channel_live_call_name), NotificationManager.IMPORTANCE_LOW);
            c.setDescription(getString(R.string.notif_channel_live_call_desc));
            getSystemService(NotificationManager.class).createNotificationChannel(c);
        }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pf = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.notif_live_call_title))
            .setContentText(getString(R.string.notif_live_call_text)).setOngoing(true).setSilent(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, launch, pf)).build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n,
            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        return START_NOT_STICKY;
    }
    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}

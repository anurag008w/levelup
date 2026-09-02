package com.anurag.levelup;

import android.app.*;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service — mic background me active rahe PiP mode ke liye.
 * Simple ongoing notification (chat reply ab LocalNotifications se hai).
 */
public class LiveCompanionForegroundService extends Service {
    static final String CHANNEL = "misa_live_call";
    static final int ID = 7422;

    // Review-9 P1.4: authoritative ACTIVE state, written ONLY by the Service
    // lifecycle itself (onCreate/onDestroy), never by the plugin or JS. This
    // distinguishes "startForegroundService() was requested" (ARMING) from
    // "the Service is actually running" (ACTIVE). Before it reads true, the JS
    // live layer must not claim FGS-backed background support. Killed services
    // clear it via onDestroy automatically, so it cannot drift stale.
    private static volatile boolean active;

    static boolean isActive() { return active; }

    @Override public void onCreate() { super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel c = new NotificationChannel(CHANNEL,
                getString(R.string.notif_channel_live_call_name), NotificationManager.IMPORTANCE_LOW);
            c.setDescription(getString(R.string.notif_channel_live_call_desc));
            c.enableVibration(false);
            c.setShowBadge(false);
            c.setSound(null, null);
            getSystemService(NotificationManager.class).createNotificationChannel(c);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Intent launch = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pf = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(getString(R.string.notif_live_call_title))
            .setContentText(getString(R.string.notif_live_call_text))
            .setOngoing(true).setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(PendingIntent.getActivity(this, 0, launch, pf))
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            startForeground(ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    | android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        active = true;
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        active = false;
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}

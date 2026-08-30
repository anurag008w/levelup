package com.anurag.levelup;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Minimal foreground service required by Android 10+ (API 29+) for
 * MediaProjection screen capture. Without this, Android kills the
 * projection token after a few seconds when the app is not visible.
 *
 * This service runs only while a Misa Live screen share is active and
 * stops itself when the share ends (ScreenSharePlugin calls stopService).
 */
public class ScreenShareForegroundService extends Service {

    private static final String CHANNEL_ID = "misa_screenshare_channel";
    private static final int NOTIF_ID = 7421;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Misa Live — Screen Share Active")
            .setContentText("Screen share is running for Misa AI. Tap to return to app.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setOngoing(true)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIF_ID, notification);
        }

        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel chan = new NotificationChannel(
                CHANNEL_ID,
                "Misa Live Screen Share",
                NotificationManager.IMPORTANCE_LOW
            );
            chan.setDescription("Active only during Misa Live screen sharing sessions");
            chan.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(chan);
        }
    }
}

package com.anurag.levelup;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service for MediaProjection screen capture and background
 * live companion persistence.
 *
 * Runs on Android 7 to Android 16:
 *  - Holds a PowerManager.WakeLock so CPU doesn't sleep in background
 *  - Displays a persistent notification with a tap-to-return action
 *  - Prevents the OS from killing the capture & audio pipeline when the user
 *    minimizes the app to view PDFs, notes, or coaching apps
 *  - Properly registers FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION on Android 10+
 */
public class ScreenShareForegroundService extends Service {

    public static final String CHANNEL_ID = "misa_screenshare_channel";
    public static final int NOTIF_ID = 7421;

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Acquire WakeLock so background WebSocket / WebAudio streaming stays active
        if (wakeLock == null) {
            try {
                PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (powerManager != null) {
                    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "levelup:misa_live_wakelock");
                    wakeLock.acquire(4 * 60 * 60 * 1000L); // 4 hours maximum timeout
                }
            } catch (Exception ignored) {}
        }

        // Intent to return to MainActivity when user taps the notification
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, pendingFlags);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Misa Live — Screen Share Active")
            .setContentText("Screen share is running for Misa AI. Tap to return to app.")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentIntent(pendingIntent)
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

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
            wakeLock = null;
        }
        super.onDestroy();
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

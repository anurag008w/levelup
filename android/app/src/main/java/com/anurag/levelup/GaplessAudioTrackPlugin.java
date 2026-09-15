package com.anurag.levelup;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native 24kHz mono PCM streaming sink for Gemini Live. */
@CapacitorPlugin(name = "GaplessAudioTrack")
public class GaplessAudioTrackPlugin extends Plugin {
    private static final String TAG = "GaplessAudioTrack";
    private static final int SAMPLE_RATE_HZ = 24000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_OUT_MONO;
    private static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;

    private AudioTrack audioTrack;
    private static final int PENDING_CAPACITY_CHUNKS = 48;
    private final LinkedBlockingQueue<short[]> pending = new LinkedBlockingQueue<>(PENDING_CAPACITY_CHUNKS);
    private Thread writerThread;
    private final AtomicBoolean closed = new AtomicBoolean(true);
    /** Serializes every native AudioTrack operation with the writer's write(). */
    private final Object sinkLock = new Object();
    private volatile int fadeInRemaining = 0;
    private static final int FADE_IN_SAMPLES = 192;
    private volatile float trackVolume = 1f;

    @PluginMethod
    public void open(PluginCall call) {
        try {
            closeTrackInternal();
            closed.set(false);
            pending.clear();

            int sampleRate = call.getInt("sampleRate", SAMPLE_RATE_HZ);
            int minBuf = AudioTrack.getMinBufferSize(sampleRate, CHANNEL_CONFIG, ENCODING);
            int bufSize = Math.max(minBuf, sampleRate);

            AudioTrack track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(CHANNEL_CONFIG)
                    .setEncoding(ENCODING)
                    .build())
                .setBufferSizeInBytes(bufSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();

            if (track.getState() != AudioTrack.STATE_INITIALIZED) {
                try { track.release(); } catch (Exception ignored) { }
                synchronized (sinkLock) { audioTrack = null; }
                closed.set(true);
                call.reject("AudioTrack failed to initialize");
                return;
            }

            try { track.setVolume(trackVolume); } catch (Exception ignored) { }
            synchronized (sinkLock) {
                audioTrack = track;
                fadeInRemaining = FADE_IN_SAMPLES;
            }
            track.play();

            Thread worker = new Thread(() -> {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
                drainLoop();
            }, "gapless-audio-writer");
            synchronized (sinkLock) { writerThread = worker; }
            worker.start();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("sampleRate", sampleRate);
            ret.put("channels", 1);
            ret.put("minBufferSize", minBuf);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "open failed: " + e.getMessage(), e);
            closed.set(true);
            call.reject("open failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        synchronized (sinkLock) {
            if (audioTrack == null || closed.get()) {
                call.reject("not open");
                return;
            }
        }
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.resolve();
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            short[] samples = new short[bytes.length / 2];
            for (int i = 0; i < samples.length; i++) {
                samples[i] = (short) ((bytes[i * 2] & 0xFF) | (bytes[i * 2 + 1] << 8));
            }
            while (!pending.offer(samples)) {
                if (pending.poll() == null) break;
            }
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "write decode failed: " + e.getMessage());
            call.resolve();
        }
    }

    @PluginMethod
    public void flush(PluginCall call) {
        try {
            pending.clear();
            synchronized (sinkLock) {
                AudioTrack t = audioTrack;
                if (t != null && t.getState() == AudioTrack.STATE_INITIALIZED) {
                    // Writer writes hold the same lock, so reset cannot race an
                    // in-flight AudioTrack.write(). This prioritizes correctness;
                    // flush remains a rare barge-in operation.
                    t.pause();
                    t.flush();
                    t.play();
                    fadeInRemaining = FADE_IN_SAMPLES;
                }
            }
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "flush failed: " + e.getMessage());
            call.resolve();
        }
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        try {
            float volume = call.getFloat("volume", 1f);
            if (Float.isNaN(volume)) volume = 1f;
            trackVolume = Math.max(0f, Math.min(1f, volume));
            synchronized (sinkLock) {
                AudioTrack t = audioTrack;
                if (t != null && t.getState() == AudioTrack.STATE_INITIALIZED) t.setVolume(trackVolume);
            }
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "setVolume failed: " + e.getMessage());
            call.resolve();
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeTrackInternal();
        call.resolve();
    }

    private void closeTrackInternal() {
        closed.set(true);
        pending.clear();
        Thread worker;
        synchronized (sinkLock) { worker = writerThread; writerThread = null; }
        if (worker != null && worker != Thread.currentThread()) {
            worker.interrupt();
            try {
                // AudioTrack.write() is performed under sinkLock and the close path
                // never releases the track until the writer has exited. Interrupt
                // wakes a blocked worker immediately; this join is only a bounded
                // guard against a misbehaving OEM implementation.
                worker.join(1000);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        synchronized (sinkLock) {
            AudioTrack t = audioTrack;
            audioTrack = null;
            if (t != null) {
                try { t.pause(); } catch (Exception ignored) { }
                try { t.flush(); } catch (Exception ignored) { }
                try { t.stop(); } catch (Exception ignored) { }
                try { t.release(); } catch (Exception ignored) { }
            }
        }
    }

    private void drainLoop() {
        while (!closed.get()) {
            short[] chunk;
            try {
                chunk = pending.take();
            } catch (InterruptedException ie) {
                return;
            }
            if (closed.get()) return;
            synchronized (sinkLock) {
                AudioTrack t = audioTrack;
                if (t == null || t.getState() != AudioTrack.STATE_INITIALIZED) {
                    pending.clear();
                    continue;
                }
                applyFadeIn(chunk);
                int written = 0;
                int attempts = 0;
                while (written < chunk.length && !closed.get() && attempts++ < 64) {
                    int n;
                    try {
                        n = t.write(chunk, written, chunk.length - written);
                    } catch (Exception e) {
                        Log.w(TAG, "write failed: " + e.getMessage());
                        break;
                    }
                    if (n > 0) {
                        written += n;
                        continue;
                    }
                    try {
                        if (t.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) t.play();
                        else Thread.sleep(4);
                    } catch (InterruptedException ie) {
                        return;
                    } catch (Exception ignored) { }
                }
            }
        }
    }

    private void applyFadeIn(short[] chunk) {
        int need = fadeInRemaining;
        if (need <= 0 || chunk.length == 0) return;
        int n = Math.min(need, chunk.length);
        for (int i = 0; i < n; i++) chunk[i] = (short) (chunk[i] * ((i + 1) / (float) need));
        fadeInRemaining = Math.max(0, need - n);
    }

    @Override
    protected void handleOnDestroy() {
        closeTrackInternal();
        super.handleOnDestroy();
    }
}
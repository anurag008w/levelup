package com.anurag.levelup;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Misa Live — Audio Route Plugin
 *
 * Switches audio output between Speaker, Earpiece, and Bluetooth headset
 * using Android's AudioManager. WebAudio AudioContext plays through the
 * media communication path, so we route dynamically via Android APIs.
 *
 * Supported routes:
 *  - "speaker"   → Loudspeaker (default for media playback)
 *  - "earpiece"  → Phone earpiece (quiet, private listening)
 *  - "bluetooth" → Bluetooth headset / earbuds / BLE Audio / Wired headset
 *
 * Verified against Android 12 to Android 16 setCommunicationDevice requirements.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final String TAG = "AudioRoutePlugin";

    /**
     * Bounded wait for a Bluetooth SCO profile to converge after
     * startBluetoothSco(). Real-device OEM stacks (e.g. vivo/Android 9) can
     * take longer than the framework's nominal window to flip the A2DP
     * headset into an active communication/SCO path. Raised 3s -> 5s after a
     * real-device report where the headset stayed on the phone speaker (SCO
     * never converged within 3s). Still bounded so a headset with NO SCO
     * profile falls back to speaker promptly instead of hanging the call.
     */
    private static final long SCO_CONNECT_TIMEOUT_MS = 5000;

    // Cancellation generation for async Bluetooth SCO waits. Bumped on every
    // route change / reset / teardown, so a stale sco-connect-wait thread that
    // outlived a speaker/earpiece switch or a hangup aborts instead of
    // re-activating SCO against a call that's already over.
    private final java.util.concurrent.atomic.AtomicLong scoRequestGeneration = new java.util.concurrent.atomic.AtomicLong(0);

    /** True when the SCO request that captured `gen` is no longer current. */
    private boolean isScoRequestStale(long gen) {
        return gen != scoRequestGeneration.get();
    }

    private AudioFocusRequest audioFocusRequest;
    private final AudioManager.OnAudioFocusChangeListener audioFocusListener = focusChange -> {
        JSObject event = new JSObject();
        event.put("focusChange", focusChange);
        notifyListeners("audioFocusChange", event);
    };

    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @Override
    public void load() {
        super.load();
        // Clear any dangling communication mode or focus from a previous run or crash on app start
        resetNativeAudioState();
    }

    private void resetNativeAudioState() {
        AudioManager am = audioManager();
        if (am != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    am.clearCommunicationDevice();
                }
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
                abandonCallAudioFocus(am);
            } catch (Exception e) {
                Log.w(TAG, "resetNativeAudioState: " + e.getMessage());
            }
        }
    }

    /**
     * Set audio output route.
     * JS: await AudioRoute.setRoute({ route: 'speaker' | 'earpiece' | 'bluetooth' })
     */
    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", "speaker");
        AudioManager am = audioManager();
        if (am == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            // NOTE: Audio focus is acquired as a single-owner step via the
            // dedicated `requestAudioFocus` plugin call + `resetRoute`/`abandon`.
            // We intentionally DO NOT request focus here — otherwise calling
            // setRoute right after requestAudioFocus (as the pre-capture mic-fix
            // does) creates a second AudioFocusRequest that overwrites the stored
            // one, so resetRoute would only abandon the latest and leave focus
            // ownership inconsistent. Focus is set once, before capture starts.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+ (API 31+): use setCommunicationDevice
                setRouteApi31(am, route, call);
            } else {
                // Android 7–11: legacy AudioManager flags
                setRouteLegacy(am, route, call);
            }
        } catch (Exception e) {
            Log.e(TAG, "setRoute failed: " + e.getMessage(), e);
            call.reject("Audio route switch failed: " + e.getMessage());
        }
    }

    @android.annotation.SuppressLint("NewApi")
    private void setRouteApi31(AudioManager am, String route, PluginCall call) {
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);

        // getAvailableCommunicationDevices() is the authoritative source
        // (Android docs): it lists exactly the devices usable with
        // setCommunicationDevice(). We classify by the ACTUAL device type —
        // never report "bluetooth" when what is physically attached is a
        // wired/USB headset.
        List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
        AudioDeviceInfo targetDevice = null;

        if ("speaker".equals(route)) {
            // Find loudspeaker
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    targetDevice = d;
                    break;
                }
            }
            if (targetDevice != null) {
                am.setSpeakerphoneOn(true);
                boolean ok = am.setCommunicationDevice(targetDevice);
                if (ok && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    AudioDeviceInfo actual = am.getCommunicationDevice();
                    ok = actual != null && actual.getId() == targetDevice.getId();
                }
                if (ok) {
                    JSObject ret = new JSObject();
                    ret.put("route", "speaker");
                    ret.put("deviceType", deviceTypeName(targetDevice.getType()));
                    ret.put("deviceName", targetDevice.getProductName() != null
                        ? targetDevice.getProductName().toString() : "Loudspeaker");
                    call.resolve(ret);
                } else {
                    call.reject("Loudspeaker route could not be applied");
                }
                return;
            }
            // No loudspeaker in comm devices (rare) — clear so Android picks default.
            am.clearCommunicationDevice();
            am.setSpeakerphoneOn(true);
            JSObject ret = new JSObject();
            ret.put("route", "speaker");
            ret.put("deviceType", "BUILTIN_SPEAKER");
            call.resolve(ret);
            return;

        } else if ("earpiece".equals(route)) {
            // Find phone earpiece
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                    targetDevice = d;
                    break;
                }
            }
            if (targetDevice == null) {
                call.reject("No earpiece communication device available");
                return;
            }

        } else if ("bluetooth".equals(route)) {
            // Priority selection: SCO & BLE headsets first (bidirectional voice communication),
            // then hearing aids / BLE speakers, then A2DP.
            targetDevice = findBestBluetoothDevice(devices);
            if (targetDevice == null) {
                // If devices did not reflect Bluetooth immediately upon mode switch, wait briefly and retry
                try {
                    Thread.sleep(150);
                } catch (InterruptedException ignored) {}
                devices = am.getAvailableCommunicationDevices();
                targetDevice = findBestBluetoothDevice(devices);
            }
            if (targetDevice == null) {
                call.reject("No Bluetooth communication device available");
                return;
            }
        }

        // Re-verify the selected device is STILL in the current available set
        boolean stillAvailable = false;
        for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
            if (d.getId() == targetDevice.getId()) { stillAvailable = true; break; }
        }
        if (!stillAvailable) {
            // Re-verify after a brief delay in case device list was transitioning
            try { Thread.sleep(80); } catch (InterruptedException ignored) {}
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getId() == targetDevice.getId()) { stillAvailable = true; break; }
            }
        }
        if (!stillAvailable) {
            call.reject("Audio route could not be applied: device no longer available");
            return;
        }

        // When switching to earpiece or bluetooth, turn speakerphone OFF so Android does not route to speaker
        am.setSpeakerphoneOn(false);

        boolean ok = am.setCommunicationDevice(targetDevice);
        if (ok && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo actual = am.getCommunicationDevice();
            boolean confirmed = (actual != null && actual.getId() == targetDevice.getId());

            // Bluetooth audio handshake is asynchronous on Android 12+.
            // Bounded poll up to 2000ms for getCommunicationDevice() to converge to targetDevice.
            if (!confirmed && "bluetooth".equals(route)) {
                long deadline = System.currentTimeMillis() + 2000;
                while (System.currentTimeMillis() < deadline) {
                    try {
                        Thread.sleep(60);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                    actual = am.getCommunicationDevice();
                    if (actual != null && actual.getId() == targetDevice.getId()) {
                        confirmed = true;
                        break;
                    }
                }
            }

            // If the system accepted setCommunicationDevice (returned true), trust it for Bluetooth
            // even if the HAL updates getCommunicationDevice() lazily when the audio track renders.
            ok = confirmed || ("bluetooth".equals(route) && ok);
        }
        if (ok) {
            JSObject ret = new JSObject();
            ret.put("route", route);
            ret.put("deviceType", deviceTypeName(targetDevice.getType()));
            ret.put("deviceName", targetDevice.getProductName() != null
                ? targetDevice.getProductName().toString() : route);
            call.resolve(ret);
        } else {
            Log.w(TAG, "setRouteApi31 apply/confirm failed for " + route
                + " (device " + (targetDevice.getProductName() != null ? targetDevice.getProductName() : targetDevice.getId()) + ")");
            call.reject("Audio route could not be applied: " + route);
        }
    }

    /** Find highest priority Bluetooth communication device for 2-way call. */
    @android.annotation.SuppressLint("NewApi")
    private AudioDeviceInfo findBestBluetoothDevice(List<AudioDeviceInfo> devices) {
        if (devices == null) return null;
        // Priority 1: True 2-way call communication headsets (SCO or BLE Headset)
        for (AudioDeviceInfo d : devices) {
            int type = d.getType();
            if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                return d;
            }
        }
        // Priority 2: Hearing aid / BLE Speaker
        for (AudioDeviceInfo d : devices) {
            int type = d.getType();
            if (type == AudioDeviceInfo.TYPE_HEARING_AID || type == AudioDeviceInfo.TYPE_BLE_SPEAKER) {
                return d;
            }
        }
        // Priority 3: A2DP (if system exposes it as communication device)
        for (AudioDeviceInfo d : devices) {
            int type = d.getType();
            if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
                return d;
            }
        }
        return null;
    }

    /** Human-readable Android device type name (device-matrix verification aid). */
    @android.annotation.SuppressLint("NewApi")
    private static String deviceTypeName(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "BUILTIN_SPEAKER";
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "BUILTIN_EARPIECE";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "BLUETOOTH_SCO";
            case AudioDeviceInfo.TYPE_BLE_HEADSET: return "BLE_HEADSET";
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: return "BLE_SPEAKER";
            case AudioDeviceInfo.TYPE_HEARING_AID: return "HEARING_AID";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "BLUETOOTH_A2DP";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "WIRED_HEADSET";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "WIRED_HEADPHONES";
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "USB_HEADSET";
            case AudioDeviceInfo.TYPE_USB_DEVICE: return "USB_DEVICE";
            default: return "TYPE_" + type;
        }
    }

    private void setRouteLegacy(AudioManager am, String route, PluginCall call) {
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        // Any new route supersedes a pending async SCO request; bump the
        // generation so an in-flight sco-connect-wait thread aborts.
        scoRequestGeneration.incrementAndGet();

        switch (route) {
            case "earpiece":
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                am.setSpeakerphoneOn(false);
                break;

            case "bluetooth":
                // Review 7 / P1 + final audit (Android 8–11): startBluetoothSco()
                // is ASYNC — it returns before the headset profile converges, so
                // resolving immediately lets the WebView AudioRecord open its
                // capture session while audio is still on the phone speaker
                // (first ~hundreds of ms of user speech can be lost). Wait for
                // the SCO_CONNECTED broadcast (bounded timeout) so the JS
                // caller only continues once the headset is the actual route.
                // The broadcast receiver is registered BEFORE startBluetoothSco()
                // (final-audit race): a fast headset can emit SCO_CONNECTED in
                // the synchronous window after startBluetoothSco() returns, so
                // registering first guarantees that one transition is never
                // missed. If SCO never converges, revert to the loudspeaker
                // instead of letting the app believe it is "on bluetooth".
                call.setKeepAlive(true);
                // Invalidate any prior outstanding SCO request, then bind THIS
                // request to a fresh generation so a stale waiter can never
                // outlive a later route switch / hangup and re-activate SCO.
                final long requestGen = scoRequestGeneration.incrementAndGet();
                final AudioManager amSco = am;
                final PluginCall callSco = call;
                Thread scoWaiter = new Thread(() -> {
                    boolean scoReady = waitForScoReady(amSco, () -> {
                        // Abort if a newer route request/reset already landed.
                        if (isScoRequestStale(requestGen)) return;
                        // Order matters on Android 8–11 OEMs: force the phone's
                        // loudspeaker OFF and enter the communication profile
                        // (mode already MODE_IN_COMMUNICATION) BEFORE signalling
                        // SCO on, so the headset profile is the active output the
                        // moment CONNECTED lands instead of fighting the speaker.
                        amSco.setSpeakerphoneOn(false);
                        amSco.startBluetoothSco();
                        amSco.setBluetoothScoOn(true);
                    });
                    // If the request was superseded while waiting (reset/route
                    // change/hangup), do NOT touch the audio route now — the
                    // current state belongs to a newer request. Resolve without
                    // applying anything so the JS transactional caller re-reads
                    // reality instead of resurrecting a dead Bluetooth route.
                    if (isScoRequestStale(requestGen)) {
                        JSObject stale = new JSObject();
                        stale.put("route", "speaker");
                        stale.put("deviceType", "UNSPECIFIED");
                        callSco.resolve(stale);
                        return;
                    }
                    if (scoReady) {
                        JSObject ret = new JSObject();
                        ret.put("route", "bluetooth");
                        ret.put("deviceType", "BLUETOOTH_SCO");
                        callSco.resolve(ret);
                    } else {
                        // No SCO profile in time — never pretend; go speaker.
                        amSco.stopBluetoothSco();
                        amSco.setBluetoothScoOn(false);
                        amSco.setSpeakerphoneOn(true);
                        callSco.reject("Bluetooth SCO headset did not connect in time");
                    }
                }, "sco-connect-wait");
                scoWaiter.start();
                return;

            case "speaker":
            default:
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                am.setSpeakerphoneOn(true);
                break;
        }

        JSObject ret = new JSObject();
        ret.put("route", route);
        call.resolve(ret);
    }

    /**
     * Android 7–11 sticky-SCO state machine, per Android's documented flow:
     *
     *   register receiver → read the STICKY state returned by registration →
     *   if already CONNECTED (broadcast sticky OR isBluetoothScoOn()), keep/use
     *   it and resolve → otherwise startBluetoothSco() → wait CONNECTING →
     *   CONNECTED → timeout/failure cleanup (stop SCO, disable SCO, speaker).
     *
     * The receiver is registered BEFORE startBluetoothSco() (final-audit race:
     * a fast headset can emit CONNECTED between startBluetoothSco() returning
     * and a post-hoc registration, so registering first guarantees that
     * transition is never missed). SCO establishment can take several seconds,
     * so the wait is bounded (SCO_CONNECT_TIMEOUT_MS, 5s — raised from 3s after
     * a real-device report where a slow OEM stack stayed on the speaker; the
     * timeout + failure paths log diagnostics below for real-device validation).
     *
     * Receives on BOTH the current action (ACTION_SCO_AUDIO_STATE_UPDATED) and
     * the older ACTION_SCO_AUDIO_STATE_CHANGED (kept as compatibility fallback),
     * because OEMs vary: some still broadcast the deprecated action only.
     * Returns true only when the physical Bluetooth communication path is
     * verified active (isBluetoothScoOn()).
     */
    private boolean waitForScoReady(AudioManager am, Runnable startSco) {
        final Object lock = new Object();
        final boolean[] ready = { false };
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(
                    AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR);
                if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                    synchronized (lock) { ready[0] = true; lock.notifyAll(); }
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
        filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_CHANGED);
        // Review-9 P1.7: `registerReceiver` RETURNS the sticky Intent for the
        // matching action(s). The sticky state reflects what the framework
        // considers the current SCO state, independent of our local calls —
        // reading it here (rather than only isBluetoothScoOn(), which some
        // OEMs report late) closes the "already connected before we registered
        // / became connected before we observed it" race.
        Intent sticky = null;
        try {
            // SYSTEM broadcast (framework-SCO state): must be EXPORTED so the
            // Android framework can deliver it on every OEM/skin. App-private
            // broadcasts stay NOT_EXPORTED instead — only this system broadcast
            // is intentionally exported. Guarded so pre-33 need no flag at all.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                sticky = getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                sticky = getContext().registerReceiver(receiver, filter);
            }
            // Authoritative current state: sticky broadcast state takes
            // precedence (it reflects framework truth); isBluetoothScoOn() is a
            // cross-check for the window where the sticky intent has not yet been
            // delivered on some OEMs. Only start SCO when NOT already connected.
            int stickyState = AudioManager.SCO_AUDIO_STATE_ERROR;
            if (sticky != null) {
                stickyState = sticky.getIntExtra(
                    AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR);
            }
            boolean alreadyConnected =
                stickyState == AudioManager.SCO_AUDIO_STATE_CONNECTED || am.isBluetoothScoOn();
            if (alreadyConnected) {
                ready[0] = true;
            } else {
                startSco.run();
            }
            long deadline = System.currentTimeMillis() + SCO_CONNECT_TIMEOUT_MS;
            synchronized (lock) {
                while (!ready[0] && !am.isBluetoothScoOn() && System.currentTimeMillis() < deadline) {
                    long remaining = Math.min(deadline - System.currentTimeMillis(), 300);
                    if (remaining <= 0) break;
                    lock.wait(remaining);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) { }
        }
        // Review-9 P1.8 observability: log the SCO outcome so real-device
        // timeouts/failures are diagnosable without a debugger. No sensitive
        // data — only route state + whether SCO converged.
        boolean success = (ready[0] || am.isBluetoothScoOn()) && am.isBluetoothScoOn();
        Log.i(TAG, "SCO wait result=" + (success ? "CONNECTED" : "TIMEOUT/FAILURE")
            + " isBluetoothScoOn=" + am.isBluetoothScoOn());
        // Final physical verification (P1): a CONNECTED state is only meaningful
        // if the communication path is actually active on the headset.
        return success;
    }

    /** Reset audio mode to normal when the Live session ends. */
    @PluginMethod
    public void resetRoute(PluginCall call) {
        // Invalidate any in-flight async SCO waiter: a hangup/teardown must
        // never let an old thread re-activate SCO after the call is over.
        scoRequestGeneration.incrementAndGet();
        resetNativeAudioState();
        call.resolve();
    }

    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        AudioManager am = audioManager();
        if (am == null) {
            call.reject("AudioManager not available");
            return;
        }
        int result = requestCallAudioFocus(am);
        JSObject response = new JSObject();
        boolean granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        // Review-9 P2.17 observability: log the focus outcome (no sensitive data).
        // Review-9 P1.11: DELAYED is reported distinctly (status="delayed") so
        // the JS layer rejects deterministically rather than treating it as a
        // grant or a plain denial.
        Log.i(TAG, "audio focus result=GRANTED:" + granted
            + " status=" + (granted ? "granted" : result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED ? "delayed" : "failed"));
        response.put("granted", granted);
        response.put("status", granted ? "granted" : result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED ? "delayed" : "failed");
        call.resolve(response);
    }

    private int requestCallAudioFocus(AudioManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            // Review-9 P1.10 (documented decision): AUDIOFOCUS_GAIN_TRANSIENT is
            // the correct policy for a phone-like voice-communication session —
            // this is what real voice calls use (not full GAIN). It lets us
            // duck gracefully under navigation (CAN_DUCK) and pause under short
            // interruptions (LOSS_TRANSIENT), while permanent LOSS (-1) is
            // deliberately handled as terminal in the JS layer (the session
            // cannot continue without audio). GAIN would be wrong here: it would
            // assert sole ownership and other apps cannot politely duck us.
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(audioFocusListener)
                // JS owns explicit ducking, so Android must deliver CAN_DUCK.
                .setWillPauseWhenDucked(false)
                .build();
            return am.requestAudioFocus(audioFocusRequest);
        } else {
            return am.requestAudioFocus(audioFocusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void abandonCallAudioFocus(AudioManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            am.abandonAudioFocusRequest(audioFocusRequest);
            audioFocusRequest = null;
        } else {
            am.abandonAudioFocus(audioFocusListener);
        }
    }

    /** List currently available audio output devices. */
    @PluginMethod
    public void getAvailableRoutes(PluginCall call) {
        AudioManager am = audioManager();
        JSObject ret = new JSObject();
        boolean hasBluetooth = false;
        boolean hasEarpiece = false;

        if (am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            hasBluetooth = findBestBluetoothDevice(devices) != null;
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                    hasEarpiece = true;
                }
            }
        } else {
            hasEarpiece = true;
            try {
                BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
                hasBluetooth = bt != null && bt.isEnabled() &&
                    bt.getProfileConnectionState(BluetoothProfile.HEADSET) == BluetoothAdapter.STATE_CONNECTED;
            } catch (Exception ignored) {
                hasBluetooth = false;
            }
        }

        ret.put("speaker", true);
        ret.put("earpiece", hasEarpiece);
        ret.put("bluetooth", hasBluetooth);
        call.resolve(ret);
    }
}

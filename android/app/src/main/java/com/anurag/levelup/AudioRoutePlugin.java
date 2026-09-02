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
    private AudioFocusRequest audioFocusRequest;
    private final AudioManager.OnAudioFocusChangeListener audioFocusListener = focusChange -> {
        JSObject event = new JSObject();
        event.put("focusChange", focusChange);
        notifyListeners("audioFocusChange", event);
    };

    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
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
                boolean ok = am.setCommunicationDevice(targetDevice);
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
            // REAL wireless communication devices only: SCO / BLE headset /
            // BLE speaker / hearing aid (A2DP only if the system itself lists
            // it as a communication device). Wired/USB headsets are NOT
            // bluetooth and must never be selected or reported as such —
            // otherwise the user hears "bluetooth" while audio goes to a wire.
            for (AudioDeviceInfo d : devices) {
                int type = d.getType();
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                    type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
                    type == AudioDeviceInfo.TYPE_HEARING_AID ||
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
                    targetDevice = d;
                    break;
                }
            }
            if (targetDevice == null) {
                call.reject("No Bluetooth communication device available");
                return;
            }
        }

        boolean ok = am.setCommunicationDevice(targetDevice);
        if (ok) {
            JSObject ret = new JSObject();
            ret.put("route", route);
            ret.put("deviceType", deviceTypeName(targetDevice.getType()));
            ret.put("deviceName", targetDevice.getProductName() != null
                ? targetDevice.getProductName().toString() : route);
            call.resolve(ret);
        } else {
            call.reject("Audio route could not be applied: " + route);
        }
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

        switch (route) {
            case "earpiece":
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                am.setSpeakerphoneOn(false);
                break;

            case "bluetooth":
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
                am.setSpeakerphoneOn(false);
                // Review 7 / P1 (Android 8–11): startBluetoothSco() is
                // ASYNC — it returns before the headset profile converges, so
                // resolving immediately lets the WebView AudioRecord open its
                // capture session while audio is still on the phone speaker
                // (first ~hundreds of ms of user speech can be lost). Wait for
                // the SCO_CONNECTED broadcast (bounded timeout) so the JS
                // caller only continues once the headset is the actual route.
                // If SCO never converges, revert to the loudspeaker instead of
                // letting the app believe it is "on bluetooth".
                call.setKeepAlive(true);
                final AudioManager amSco = am;
                final PluginCall callSco = call;
                Thread scoWaiter = new Thread(() -> {
                    if (waitForScoConnected(amSco)) {
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
     * Block until the SCO headset reports CONNECTED (bounded by a short
     * convergence window, e.g. 2s). Returns true if the headset is usable.
     * The broadcast listener is unregistered on every exit path; on Android
     * 13+ a dynamic receiver must declare its exported-ness.
     */
    private boolean waitForScoConnected(AudioManager am) {
        if (am.isBluetoothScoOn()) return true;
        final Object lock = new Object();
        final boolean[] connected = { false };
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(
                    AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR);
                if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                    synchronized (lock) { connected[0] = true; lock.notifyAll(); }
                }
            }
        };
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_CHANGED);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(receiver, filter);
            }
            long deadline = System.currentTimeMillis() + 2000;
            synchronized (lock) {
                while (!connected[0] && System.currentTimeMillis() < deadline) {
                    long remaining = deadline - System.currentTimeMillis();
                    if (remaining <= 0) break;
                    lock.wait(remaining);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) { }
        }
        return connected[0];
    }

    /** Reset audio mode to normal when the Live session ends. */
    @PluginMethod
    public void resetRoute(PluginCall call) {
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
                Log.w(TAG, "resetRoute: " + e.getMessage());
            }
        }
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
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(audioFocusListener)
                // JS owns explicit ducking, so Android must deliver CAN_DUCK.
                .setWillPauseWhenDucked(false)
                .build();
            return am.requestAudioFocus(audioFocusRequest);
        } else {
            return am.requestAudioFocus(audioFocusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
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
            for (AudioDeviceInfo d : devices) {
                int type = d.getType();
                // Honest classification: only REAL wireless communication
                // devices count as bluetooth. Wired/USB headsets are routed
                // automatically by Android and are neither bluetooth nor
                // earpiece nor speaker — do not mislabel them.
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                    type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
                    type == AudioDeviceInfo.TYPE_HEARING_AID ||
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
                    hasBluetooth = true;
                }
                if (type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
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

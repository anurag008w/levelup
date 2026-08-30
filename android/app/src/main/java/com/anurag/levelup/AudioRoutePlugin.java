package com.anurag.levelup;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Misa Live — Audio Route Plugin
 *
 * Switches audio output between Speaker, Earpiece, and Bluetooth headset
 * using Android's AudioManager. WebAudio AudioContext always plays through
 * the default media stream (loudspeaker), so we must override at the native
 * Android level when the user switches routes in the Live session.
 *
 * Supported routes:
 *  - "speaker"   → Loudspeaker (default for media playback)
 *  - "earpiece"  → Phone earpiece (quiet, private listening)
 *  - "bluetooth" → Bluetooth headset / earbuds (if connected)
 *
 * Compatibility: Android 7+ (API 24+). Uses setCommunicationDevice()
 * on API 31+ and legacy methods on older devices.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final String TAG = "AudioRoutePlugin";

    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /**
     * Set audio output route.
     * JS: await AudioRoutePlugin.setRoute({ route: 'speaker' | 'earpiece' | 'bluetooth' })
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
        // Set to communication mode so earpiece/BT routing works.
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);

        AudioDeviceInfo targetDevice = null;
        int targetType = AudioDeviceInfo.TYPE_UNKNOWN;

        switch (route) {
            case "earpiece":
                targetType = AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
                break;
            case "bluetooth":
                targetType = AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
                break;
            case "speaker":
            default:
                targetType = AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
                break;
        }

        AudioDeviceInfo[] devices = am.getAvailableCommunicationDevices();
        for (AudioDeviceInfo d : devices) {
            if (d.getType() == targetType) {
                targetDevice = d;
                break;
            }
        }

        if (targetDevice != null) {
            boolean ok = am.setCommunicationDevice(targetDevice);
            if (ok) {
                JSObject ret = new JSObject();
                ret.put("route", route);
                ret.put("deviceName", targetDevice.getProductName() != null
                    ? targetDevice.getProductName().toString() : route);
                call.resolve(ret);
                return;
            }
        }

        // Fallback: setCommunicationDevice failed or device not found — use legacy.
        setRouteLegacy(am, route, call);
    }

    private void setRouteLegacy(AudioManager am, String route, PluginCall call) {
        // Put audio in communication mode for proper earpiece/BT routing.
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
                break;

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
            } catch (Exception e) {
                Log.w(TAG, "resetRoute: " + e.getMessage());
            }
        }
        call.resolve();
    }

    /** List currently available audio output devices (for UI). */
    @PluginMethod
    public void getAvailableRoutes(PluginCall call) {
        AudioManager am = audioManager();
        JSObject ret = new JSObject();
        boolean hasBluetooth = false;
        boolean hasEarpiece = false;

        if (am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo[] devices = am.getAvailableCommunicationDevices();
            for (AudioDeviceInfo d : devices) {
                int type = d.getType();
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
                    hasBluetooth = true;
                }
                if (type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                    hasEarpiece = true;
                }
            }
        } else {
            // Legacy: assume earpiece available on phones; check BT via BluetoothAdapter
            hasEarpiece = true;
            BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
            hasBluetooth = bt != null && bt.isEnabled() &&
                bt.getProfileConnectionState(BluetoothProfile.HEADSET) == BluetoothAdapter.STATE_CONNECTED;
        }

        ret.put("speaker", true);
        ret.put("earpiece", hasEarpiece);
        ret.put("bluetooth", hasBluetooth);
        call.resolve(ret);
    }
}

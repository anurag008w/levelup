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

        AudioDeviceInfo targetDevice = null;
        AudioDeviceInfo[] devices = am.getAvailableCommunicationDevices();

        if ("speaker".equals(route)) {
            // Find loudspeaker
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    targetDevice = d;
                    break;
                }
            }
            if (targetDevice != null) {
                am.setCommunicationDevice(targetDevice);
            } else {
                am.clearCommunicationDevice();
            }
            JSObject ret = new JSObject();
            ret.put("route", "speaker");
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

        } else if ("bluetooth".equals(route)) {
            // Find any connected Bluetooth / BLE / Wired headset
            for (AudioDeviceInfo d : devices) {
                int type = d.getType();
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                    type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
                    type == AudioDeviceInfo.TYPE_HEARING_AID ||
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                    type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    targetDevice = d;
                    break;
                }
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

        // Fallback to legacy if setCommunicationDevice did not resolve
        setRouteLegacy(am, route, call);
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

    /** List currently available audio output devices. */
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
                    type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                    type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
                    type == AudioDeviceInfo.TYPE_HEARING_AID ||
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    type == AudioDeviceInfo.TYPE_USB_HEADSET) {
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

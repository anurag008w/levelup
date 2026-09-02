import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Camera, Monitor, ShieldCheck, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { haptic, hapticSuccess, hapticError } from '../../lib/haptics';
import { requestNativeCallAudioFocus, setNativeAudioRoute } from '../../lib/native-audio-route';
import type { LiveAudioRoute } from '../../core/domain/live-types';

interface LivePermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: (micStream: MediaStream, cameraStream?: MediaStream) => void;
  /** User's configured default audio route — used instead of hardcoding 'speaker'. */
  defaultAudioRoute?: LiveAudioRoute;
}

export default function LivePermissionModal({ isOpen, onClose, onProceed, defaultAudioRoute = 'speaker' }: LivePermissionModalProps) {
  const [micGranted, setMicGranted] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const [savedMicStream, setSavedMicStream] = useState<MediaStream | null>(null);
  const [savedCamStream, setSavedCamStream] = useState<MediaStream | null>(null);

  async function requestMic() {
    haptic();
    setErrorMsg(null);
    setRequesting(true);
    try {
      // ROOT-CAUSE FIX (mic silent bug) — see ChatScreen.handleStartLiveCall
      // for the full explanation: AudioManager must be in
      // MODE_IN_COMMUNICATION *before* getUserMedia opens the AudioRecord,
      // not after the call connects, otherwise the mic capture session can
      // go silent to the model on many Android devices.
      const focusGranted = await requestNativeCallAudioFocus();
      if (!focusGranted) {
        hapticError();
        setErrorMsg('Microphone ko audio focus nahi mila. Music/call band karke dobara try karo.');
        setRequesting(false);
        return;
      }
      await setNativeAudioRoute(defaultAudioRoute);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      setSavedMicStream(stream);
      setMicGranted(true);
      hapticSuccess();
    } catch {
      hapticError();
      setErrorMsg('Microphone access denied. Please allow microphone in your device settings.');
    } finally {
      setRequesting(false);
    }
  }

  async function requestCamera() {
    haptic();
    setErrorMsg(null);
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      setSavedCamStream(stream);
      setCameraGranted(true);
      hapticSuccess();
    } catch {
      hapticError();
      setErrorMsg('Camera access denied or unavailable.');
    } finally {
      setRequesting(false);
    }
  }

  function handleStart() {
    if (!savedMicStream) {
      void requestMic();
      return;
    }
    hapticSuccess();
    onProceed(savedMicStream, savedCamStream || undefined);
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-card p-6 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-l/15 text-l">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h3 className="text-base font-bold text-text">Misa Live Setup</h3>
                <p className="text-xs text-muted">Voice call aur doubt scan permissions</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
              }}
              className="icon-btn"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {errorMsg && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Permission Cards */}
          <div className="mt-4 space-y-3">
            {/* Mic Permission */}
            <div className={`flex items-center justify-between rounded-2xl border p-3.5 transition-colors ${
              micGranted ? 'border-l/40 bg-l/5' : 'border-border bg-black/20'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  micGranted ? 'bg-l text-bg' : 'bg-white/5 text-muted'
                }`}>
                  <Mic size={20} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-text">Microphone Access</h4>
                  <p className="text-[11px] text-muted">Do-tarfa live voice talk ke liye (Required)</p>
                </div>
              </div>
              {micGranted ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-l">
                  <CheckCircle2 size={16} /> Granted
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void requestMic()}
                  disabled={requesting}
                  className="btn btn-primary btn-sm px-3 text-xs"
                >
                  Allow
                </button>
              )}
            </div>

            {/* Camera Permission */}
            <div className={`flex items-center justify-between rounded-2xl border p-3.5 transition-colors ${
              cameraGranted ? 'border-l/40 bg-l/5' : 'border-border bg-black/20'
            }`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  cameraGranted ? 'bg-l text-bg' : 'bg-white/5 text-muted'
                }`}>
                  <Camera size={20} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-text">Camera Access</h4>
                  <p className="text-[11px] text-muted">Notebook & doubt solve scan (Optional)</p>
                </div>
              </div>
              {cameraGranted ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-l">
                  <CheckCircle2 size={16} /> Ready
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void requestCamera()}
                  disabled={requesting}
                  className="btn btn-secondary btn-sm px-3 text-xs"
                >
                  Enable
                </button>
              )}
            </div>

            {/* Screen Share notice */}
            <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-black/10 p-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted">
                <Monitor size={20} />
              </span>
              <div>
                <h4 className="text-sm font-semibold text-text">Screen Share (In-Call)</h4>
                <p className="text-[11px] text-muted">PDFs aur apps live call ke dauran direct screen share kar sakte hain.</p>
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
              }}
              className="btn btn-secondary flex-1 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="btn btn-primary flex-1 text-xs font-bold"
            >
              {micGranted ? '🚀 Start Misa Live' : '🎙️ Allow Mic & Start'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

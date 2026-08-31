/**
 * WhatsApp-Style Incoming Live Call Modal
 * Fullscreen dark glassmorphic calling overlay with pulsing Misa avatar,
 * procedural/custom ringtone loop, 30s auto-timeout, and Accept / Decline controls.
 */

import React, { useEffect, useState, useRef } from 'react';
import { Phone, PhoneOff, Sparkles, Volume2 } from 'lucide-react';
import { ringtonePlayer } from '../../lib/ringtone-player';
import { proactiveAgentService, type IncomingCallEvent } from '../../features/ai/proactive-agent.service';

interface IncomingCallModalProps {
  callEvent: IncomingCallEvent | null;
  onAccept: (callEvent: IncomingCallEvent) => void;
  onDecline: (callEvent: IncomingCallEvent) => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({ callEvent, onAccept, onDecline }) => {
  const [secondsRinging, setSecondsRinging] = useState(0);
  const timeoutRef = useRef<any>(null);

  useEffect(() => {
    if (!callEvent) {
      ringtonePlayer.stop();
      return;
    }

    const prefs = proactiveAgentService.getPreferences();
    ringtonePlayer.start({
      preset: prefs.ringtonePreset,
      customAudioUrl: prefs.customRingtoneUrl,
    });

    setSecondsRinging(0);
    const interval = setInterval(() => {
      setSecondsRinging((prev) => prev + 1);
    }, 1000);

    // 30s auto timeout for missed call
    timeoutRef.current = setTimeout(() => {
      ringtonePlayer.stop();
      proactiveAgentService.onCallMissed(callEvent.callId);
      onDecline(callEvent);
    }, 30000);

    return () => {
      clearInterval(interval);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      ringtonePlayer.stop();
    };
  }, [callEvent, onDecline]);

  if (!callEvent) return null;

  const handleAccept = () => {
    ringtonePlayer.stop();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    proactiveAgentService.onCallAccepted(callEvent.callId);
    onAccept(callEvent);
  };

  const handleDecline = () => {
    ringtonePlayer.stop();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    proactiveAgentService.onCallDeclined(callEvent.callId);
    onDecline(callEvent);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/95 px-6 py-12 backdrop-blur-2xl animate-fade-in text-white select-none">
      {/* Top Header */}
      <div className="flex flex-col items-center text-center space-y-2 pt-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 text-xs font-semibold text-primary">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Incoming Live Voice Call</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-white">{callEvent.callerName}</h2>
        <p className="text-sm text-slate-300 font-medium">{callEvent.reason || 'Study Partner Check-in'}</p>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono pt-1">
          <Volume2 className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span>Ringing... ({30 - secondsRinging}s)</span>
        </div>
      </div>

      {/* Center Avatar with Pulsing Rings */}
      <div className="relative flex items-center justify-center my-auto">
        {/* Pulsing outer waves */}
        <div className="absolute w-44 h-44 rounded-full bg-primary/20 animate-ping opacity-30" />
        <div className="absolute w-36 h-36 rounded-full bg-primary/30 animate-pulse" />

        {/* Core Avatar Box */}
        <div className="relative w-28 h-28 rounded-full border-2 border-primary/60 bg-panel flex items-center justify-center shadow-2xl overflow-hidden ring-4 ring-white/10">
          <span className="text-4xl select-none">🌸</span>
        </div>
      </div>

      {/* Bottom Action Controls */}
      <div className="w-full max-w-xs flex items-center justify-around pb-6">
        {/* Decline Button */}
        <button
          type="button"
          onClick={handleDecline}
          className="group flex flex-col items-center gap-2 focus:outline-none"
        >
          <div className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-red-600/40">
            <PhoneOff className="w-7 h-7 text-white" />
          </div>
          <span className="text-xs font-semibold text-red-300">Decline</span>
        </button>

        {/* Accept Button */}
        <button
          type="button"
          onClick={handleAccept}
          className="group flex flex-col items-center gap-2 focus:outline-none"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-emerald-500/40 animate-bounce">
            <Phone className="w-7 h-7 text-white" />
          </div>
          <span className="text-xs font-semibold text-emerald-300 font-bold">Accept</span>
        </button>
      </div>
    </div>
  );
};

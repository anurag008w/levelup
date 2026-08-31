import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Volume2,
  RefreshCw,
  Sliders,
  Check,
  Play,
  Square,
  X,
  Layers,
  PhoneCall,
  Gauge,
  Brain,
  Cpu,
  Video,
} from 'lucide-react';
import type { GeminiLiveVoice, LiveSettingsConfig } from '../../core/domain/live-types';
import { OFFICIAL_GEMINI_VOICES } from '../../core/domain/live-types';
import { GeminiLiveClient } from '../../core/domain/live-client';
import { haptic, hapticSuccess, hapticError } from '../../lib/haptics';

interface LiveSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LiveSettingsConfig;
  defaultApiKey?: string;
  onSave: (config: LiveSettingsConfig) => void;
}

export default function LiveSettingsModal({
  isOpen,
  onClose,
  config,
  defaultApiKey = '',
  onSave,
}: LiveSettingsModalProps) {
  const [currentConfig, setCurrentConfig] = useState<LiveSettingsConfig>({ ...config });
  const [apiKeyInput, setApiKeyInput] = useState(config.apiKey || '');
  const [availableModels, setAvailableModels] = useState<string[]>([
    'gemini-3.1-flash-live-preview',
    'gemini-2.5-flash-native-audio-preview-09-2025',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash-realtime-exp',
  ]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);

  const [playingVoice, setPlayingVoice] = useState<GeminiLiveVoice | null>(null);

  async function handleFetchModels() {
    const keyToUse = apiKeyInput.trim() || defaultApiKey.trim();
    if (!keyToUse) {
      hapticError();
      setFetchMsg('Pehle API Key daalein ya default provider set karein.');
      return;
    }
    haptic();
    setFetchingModels(true);
    setFetchMsg(null);
    try {
      const models = await GeminiLiveClient.fetchLiveModels(keyToUse);
      setAvailableModels(models);
      setFetchMsg(`✅ ${models.length} live-compatible models mile!`);
      hapticSuccess();
    } catch (err: any) {
      hapticError();
      setFetchMsg(`❌ Error: ${err.message || 'Models fetch nahi ho sake'}`);
    } finally {
      setFetchingModels(false);
    }
  }

  async function playSampleVoice(voice: GeminiLiveVoice, text: string) {
    haptic();
    if (playingVoice === voice) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setPlayingVoice(null);
      return;
    }

    setPlayingVoice(voice);
    try {
      const keyToUse = apiKeyInput.trim() || defaultApiKey.trim();
      await GeminiLiveClient.previewVoice(keyToUse, voice, text, currentConfig.model);
    } catch {
      // Ignored
    } finally {
      setPlayingVoice(null);
    }
  }

  function handleSave() {
    hapticSuccess();
    const finalCfg = {
      ...currentConfig,
      apiKey: apiKeyInput.trim() || undefined,
    };
    onSave(finalCfg);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 15 }}
          className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-card shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-l/15 text-l">
                <Sliders size={20} />
              </span>
              <div>
                <h3 className="text-base font-bold text-text">Misa Live Settings</h3>
                <p className="text-xs text-muted">Gemini Live audio, voices & streaming config</p>
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

          {/* Body content */}
          <div className="no-scrollbar flex-1 space-y-5 overflow-y-auto p-5 text-xs text-text">
            {/* Section 1: Live Model & Provider */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold text-text">
                  <Layers size={16} className="text-l" /> Live Model & Provider
                </span>
                <span className="rounded-lg bg-l/10 px-2 py-0.5 text-[10px] font-semibold text-l">
                  Google Gemini
                </span>
              </div>

              {/* API Key Override */}
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">
                  Gemini API Key (Leave blank to use App default)
                </label>
                <div className="relative flex items-center">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={defaultApiKey ? 'Using default key from app settings' : 'AIzaSy...'}
                    className="w-full rounded-xl border border-border bg-bg/80 px-3 py-2 text-xs text-text placeholder:text-muted-dim focus:border-l focus:outline-none"
                  />
                </div>
              </div>

              {/* Live Model Selection + Fetch Button */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-muted">Live Model</label>
                  <button
                    type="button"
                    onClick={() => void handleFetchModels()}
                    disabled={fetchingModels}
                    className="flex items-center gap-1 text-[10px] font-bold text-l hover:underline"
                  >
                    <RefreshCw size={11} className={fetchingModels ? 'animate-spin' : ''} />
                    {fetchingModels ? 'Fetching...' : 'Fetch Live Models'}
                  </button>
                </div>

                <select
                  value={currentConfig.model}
                  onChange={(e) => setCurrentConfig({ ...currentConfig, model: e.target.value })}
                  className="w-full rounded-xl border border-border bg-bg/80 px-3 py-2 text-xs font-mono text-text focus:border-l focus:outline-none"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                {fetchMsg && <p className="mt-1 text-[10px] text-muted">{fetchMsg}</p>}
              </div>
            </div>

            {/* Section 2: Official Voices */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold text-text">
                  <Volume2 size={16} className="text-l" /> Official Gemini Voices
                </span>
                <span className="text-[10px] text-muted">Speech Config</span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {OFFICIAL_GEMINI_VOICES.map((v) => {
                  const isSelected = currentConfig.voice === v.id;
                  const isPlaying = playingVoice === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => {
                        haptic();
                        setCurrentConfig({ ...currentConfig, voice: v.id });
                      }}
                      className={`relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition-all ${
                        isSelected ? 'border-l bg-l/10 shadow-sm' : 'border-border bg-bg/50 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text">{v.name}</span>
                            <span className="rounded bg-white/5 px-1 py-0.5 text-[9px] text-muted">
                              {v.gender}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted leading-tight">{v.description}</p>
                        </div>
                        {isSelected && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-l text-bg">
                            <Check size={11} strokeWidth={3} />
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            playSampleVoice(v.id, v.previewSampleText);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-border bg-black/30 px-2 py-1 text-[10px] font-semibold text-text hover:bg-black/50"
                        >
                          {isPlaying ? <Square size={10} className="text-danger" /> : <Play size={10} className="text-l" />}
                          {isPlaying ? 'Stop' : 'Sample'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 2.5: Voice Playback Speed */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold text-text">
                  <Gauge size={16} className="text-l" /> Voice Output Speed
                </span>
                <span className="rounded-lg bg-l/15 px-2 py-0.5 text-[11px] font-bold text-l">
                  {(currentConfig.playbackSpeed ?? 1.0).toFixed(2)}x
                </span>
              </div>

              {/* Quick Preset Chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: '0.75x', val: 0.75 },
                  { label: '0.90x', val: 0.90 },
                  { label: '1.0x (Default)', val: 1.0 },
                  { label: '1.15x', val: 1.15 },
                  { label: '1.25x', val: 1.25 },
                ].map((p) => {
                  const isCur = Math.abs((currentConfig.playbackSpeed ?? 1.0) - p.val) < 0.02;
                  return (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => {
                        haptic();
                        setCurrentConfig({ ...currentConfig, playbackSpeed: p.val });
                      }}
                      className={`rounded-xl border px-2.5 py-1 text-[10px] font-semibold transition-all ${
                        isCur
                          ? 'border-l bg-l text-white shadow-sm'
                          : 'border-border bg-bg/50 text-muted hover:border-white/20 hover:text-text'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Precision Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted">
                  <span>Slow (0.5x)</span>
                  <span>Normal (1.0x)</span>
                  <span>Fast (1.5x)</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={currentConfig.playbackSpeed ?? 1.0}
                  onChange={(e) =>
                    setCurrentConfig({ ...currentConfig, playbackSpeed: parseFloat(e.target.value) })
                  }
                  className="w-full accent-l cursor-pointer"
                />
              </div>
            </div>

            {/* Section 3: Thinking & Reasoning Budget */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold text-text">
                  <Brain size={16} className="text-l" /> Thinking & Reasoning Budget
                </span>
                <span className="rounded-lg bg-l/15 px-2 py-0.5 text-[10px] font-bold text-l">
                  {currentConfig.thinkingBudget === 0 || !currentConfig.thinkingBudget
                    ? 'Off / Ultra Fast'
                    : `${currentConfig.thinkingBudget} Tokens`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Off / Fast', val: 0, desc: 'Instant live replies' },
                  { label: '512 Tokens', val: 512, desc: 'Quick reasoning' },
                  { label: '1024 Tokens', val: 1024, desc: 'Balanced JEE solving' },
                  { label: '2048 Tokens', val: 2048, desc: 'Deep derivations' },
                ].map((tb) => {
                  const isSel = (currentConfig.thinkingBudget ?? 0) === tb.val;
                  return (
                    <button
                      key={tb.val}
                      type="button"
                      onClick={() => {
                        haptic();
                        setCurrentConfig({ ...currentConfig, thinkingBudget: tb.val });
                      }}
                      className={`flex flex-col items-start rounded-xl border p-2 text-left transition-all ${
                        isSel
                          ? 'border-l bg-l/15 text-text shadow-sm'
                          : 'border-border bg-bg/50 text-muted hover:border-white/20 hover:text-text'
                      }`}
                    >
                      <span className="text-[11px] font-bold">{tb.label}</span>
                      <span className="text-[9px] text-muted-dim">{tb.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section 4: Temperature & Max Tokens */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <span className="flex items-center gap-2 font-bold text-text">
                <Cpu size={16} className="text-l" /> Generation Config & Tokens
              </span>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-muted">Temperature (Creativity)</label>
                    <span className="font-mono text-[10px] text-l font-bold">
                      {(currentConfig.temperature ?? 0.7).toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.5"
                    step="0.1"
                    value={currentConfig.temperature ?? 0.7}
                    onChange={(e) =>
                      setCurrentConfig({ ...currentConfig, temperature: parseFloat(e.target.value) })
                    }
                    className="w-full accent-l cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-muted-dim mt-0.5">
                    <span>Precise (0.2)</span>
                    <span>Natural (0.7)</span>
                    <span>Expressive (1.2)</span>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Max Output Tokens</label>
                  <select
                    value={currentConfig.maxOutputTokens ?? 2048}
                    onChange={(e) =>
                      setCurrentConfig({ ...currentConfig, maxOutputTokens: parseInt(e.target.value, 10) })
                    }
                    className="w-full rounded-xl border border-border bg-bg/80 px-2.5 py-2 text-xs text-text focus:border-l focus:outline-none font-mono"
                  >
                    <option value={512}>512 tokens (Short voice replies)</option>
                    <option value={1024}>1024 tokens (Standard voice)</option>
                    <option value={2048}>2048 tokens (Detailed step-by-step)</option>
                    <option value={4096}>4096 tokens (Maximum explanations)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 5: Video & Screen Share Streaming FPS */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <span className="flex items-center gap-2 font-bold text-text">
                <Video size={16} className="text-l" /> Vision & Screen Share Quality
              </span>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Camera Stream (FPS)</label>
                  <select
                    value={currentConfig.videoFps ?? 2}
                    onChange={(e) =>
                      setCurrentConfig({ ...currentConfig, videoFps: parseInt(e.target.value, 10) })
                    }
                    className="w-full rounded-xl border border-border bg-bg/80 px-2.5 py-2 text-xs text-text focus:border-l focus:outline-none"
                  >
                    <option value={1}>1 FPS (Low bandwidth / save data)</option>
                    <option value={2}>2 FPS (Recommended / smooth)</option>
                    <option value={3}>3 FPS (Fast motion)</option>
                    <option value={5}>5 FPS (High fidelity)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Screen Share (FPS)</label>
                  <select
                    value={currentConfig.screenFps ?? 2}
                    onChange={(e) =>
                      setCurrentConfig({ ...currentConfig, screenFps: parseInt(e.target.value, 10) })
                    }
                    className="w-full rounded-xl border border-border bg-bg/80 px-2.5 py-2 text-xs text-text focus:border-l focus:outline-none"
                  >
                    <option value={1}>1 FPS (PDFs / static notes)</option>
                    <option value={2}>2 FPS (Recommended)</option>
                    <option value={3}>3 FPS (Interactive solving)</option>
                    <option value={5}>5 FPS (Real-time tracking)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 6: Persona Continuity */}
            <div className="rounded-2xl border border-l/25 bg-l/5 p-4 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-l">
                <Sparkles size={16} /> Persona Synchronization
              </div>
              <p className="text-[11px] leading-relaxed text-text/80">
                Voice calls automatically use LevelUp's <strong>Misa JEE Coach</strong> prompt, Roman Hinglish rules,
                and your active memory facts for 100% personality continuity.
              </p>
            </div>

            {/* Section 7: Audio Routing & VAD */}
            <div className="rounded-2xl border border-border bg-black/20 p-4 space-y-3">
              <span className="flex items-center gap-2 font-bold text-text">
                <PhoneCall size={16} className="text-l" /> Call Audio & Interruption
              </span>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Default Audio Output</label>
                  <select
                    value={currentConfig.defaultAudioRoute}
                    onChange={(e) =>
                      setCurrentConfig({ ...currentConfig, defaultAudioRoute: e.target.value as any })
                    }
                    className="w-full rounded-xl border border-border bg-bg/80 px-2.5 py-2 text-xs text-text focus:border-l focus:outline-none"
                  >
                    <option value="speaker">📢 Loudspeaker</option>
                    <option value="earpiece">📞 Phone Earpiece</option>
                    <option value="bluetooth">🎧 Bluetooth / Headset</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Interruption (VAD)</label>
                  <select
                    value={currentConfig.vadSensitivity}
                    onChange={(e) =>
                      setCurrentConfig({ ...currentConfig, vadSensitivity: e.target.value as any })
                    }
                    className="w-full rounded-xl border border-border bg-bg/80 px-2.5 py-2 text-xs text-text focus:border-l focus:outline-none"
                  >
                    <option value="high">High (Bich me bolna)</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
              }}
              className="btn btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="btn btn-primary text-xs font-bold px-5"
            >
              Save Settings
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

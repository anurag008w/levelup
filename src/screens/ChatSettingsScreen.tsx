import { Brain, ChevronLeft, Clock, MessageSquare, Save, Sparkles, Type } from 'lucide-react';
import type { AppState } from '../types';
import type { ChatSettings } from '../core/domain/state';
import type { ThinkingLevel } from '../core/domain/llm';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';
import { DEFAULT_USER_PERSONA, INTERNAL_SYSTEM_PROMPT, globalChatPrefsFromSettings } from '../core/domain/chat';
import { deviceTimeZone } from '../core/ports/clock';
import { container } from '../di/container';

/** Common IANA zones users can pin for the app's day boundary. */
const TIME_ZONES: Array<{ id: string; label: string }> = [
  { id: 'Asia/Kolkata', label: 'India (Asia/Kolkata)' },
  { id: 'Asia/Karachi', label: 'Pakistan (Asia/Karachi)' },
  { id: 'Asia/Dhaka', label: 'Bangladesh (Asia/Dhaka)' },
  { id: 'Asia/Kathmandu', label: 'Nepal (Asia/Kathmandu)' },
  { id: 'Asia/Colombo', label: 'Sri Lanka (Asia/Colombo)' },
  { id: 'Asia/Dubai', label: 'UAE (Asia/Dubai)' },
  { id: 'Asia/Singapore', label: 'Singapore (Asia/Singapore)' },
  { id: 'Asia/Kuala_Lumpur', label: 'Malaysia (Asia/Kuala_Lumpur)' },
  { id: 'Asia/Shanghai', label: 'China (Asia/Shanghai)' },
  { id: 'Asia/Tokyo', label: 'Japan (Asia/Tokyo)' },
  { id: 'Europe/London', label: 'UK (Europe/London)' },
  { id: 'Europe/Berlin', label: 'Germany (Europe/Berlin)' },
  { id: 'Europe/Paris', label: 'France (Europe/Paris)' },
  { id: 'America/New_York', label: 'US East (America/New_York)' },
  { id: 'America/Chicago', label: 'US Central (America/Chicago)' },
  { id: 'America/Los_Angeles', label: 'US West (America/Los_Angeles)' },
  { id: 'America/Sao_Paulo', label: 'Brazil (America/Sao_Paulo)' },
  { id: 'Australia/Sydney', label: 'Australia (Australia/Sydney)' },
];

interface ChatSettingsScreenProps {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  onBack?: () => void;
}

export default function ChatSettingsScreen({ state, update, onBack }: ChatSettingsScreenProps) {
  const chat = state.aiSettings.chat;

  function updateChat(partial: Partial<ChatSettings>) {
    haptic();
    const next = { ...chat, ...partial };
    update((s) => ({
      ...s,
      aiSettings: {
        ...s.aiSettings,
        chat: { ...s.aiSettings.chat, ...partial },
      },
    }));
    container.chat.applyGlobalPrefs(globalChatPrefsFromSettings(next));
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="AI CHAT"
        title="Chat Settings"
        subtitle="AI responses ko customize karo"
        right={
          onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-sm text-muted hover:text-text"
            >
              <ChevronLeft size={18} />
              Back
            </button>
          ) : undefined
        }
      />

      {/* Response Quality */}
      <div className="mb-6">
        <SectionHeader
          icon={<Sparkles size={14} color="var(--color-success)" />}
          accent="var(--color-success)"
          title="Response Quality"
        />

        <div className="gradient-border rounded-[1.25rem] p-px">
          <div className="rounded-[calc(1.25rem-1px)] bg-panel p-4 space-y-5">
            {/* Temperature */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Temperature</label>
                <span className="font-mono text-xs text-muted">{chat.temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={chat.temperature}
                onChange={(e) => updateChat({ temperature: parseFloat(e.target.value) })}
                className="slider w-full"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>

            {/* Max Tokens */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Max Response Length</label>
                <span className="font-mono text-xs text-muted">{chat.maxTokens}</span>
              </div>
              <input
                type="range"
                min="256"
                max="32768"
                step="256"
                value={chat.maxTokens}
                onChange={(e) => updateChat({ maxTokens: parseInt(e.target.value) })}
                className="slider w-full"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted">
                <span>Short</span>
                <span>Long</span>
              </div>
            </div>

            {/* Thinking / reasoning */}
            <div>
              <label className="mb-2 block text-sm font-medium">Thinking / reasoning</label>
              <select
                className="field"
                value={chat.thinking ?? ''}
                onChange={(e) =>
                  updateChat({ thinking: (e.target.value || undefined) as ThinkingLevel | undefined })
                }
              >
                <option value="">Provider default</option>
                <option value="off">Off</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <p className="mt-1 text-[10px] text-muted">Reasoning models ke liye thinking budget.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Memory & Context */}
      <div className="mb-6">
        <SectionHeader
          icon={<Brain size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title="Memory & Context"
        />

        <div className="gradient-border rounded-[1.25rem] p-px">
          <div className="rounded-[calc(1.25rem-1px)] bg-panel p-4 space-y-4">
            {/* Memory Toggle */}
            <Toggle
              icon={<Brain size={16} />}
              label="AI Memory"
              description="AI ko previous conversations yaad rahegi"
              checked={chat.memoryEnabled}
              onChange={(v) => updateChat({ memoryEnabled: v })}
            />

            {/* Journey Context */}
            <Toggle
              icon={<Sparkles size={16} />}
              label="Journey Context"
              description="AI prompts mein journey context include karega"
              checked={chat.includeJourneyContext}
              onChange={(v) => updateChat({ includeJourneyContext: v })}
            />

            {/* Conversation History */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-muted" />
                  <label className="text-sm font-medium">Conversation History</label>
                </div>
                <span className="font-mono text-xs text-muted">{chat.conversationHistoryLength} messages</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={chat.conversationHistoryLength}
                onChange={(e) => updateChat({ conversationHistoryLength: parseInt(e.target.value) })}
                className="slider w-full"
              />
              <p className="mt-1 text-[10px] text-muted">0 = full conversation memory (koi trimming nahi); 5/10/... = sirf last N messages</p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Behavior */}
      <div className="mb-6">
        <SectionHeader
          icon={<MessageSquare size={14} color="var(--color-m)" />}
          accent="var(--color-m)"
          title="Chat Behavior"
        />

        <div className="gradient-border rounded-[1.25rem] p-px">
          <div className="rounded-[calc(1.25rem-1px)] bg-panel p-4 space-y-4">
            {/* Auto Save */}
            <Toggle
              icon={<Save size={16} />}
              label="Auto-Save Chats"
              description="Chats automatically save hoke history mein jaenge"
              checked={chat.autoSaveChats}
              onChange={(v) => updateChat({ autoSaveChats: v })}
            />

            {/* Show thinking */}
            <Toggle
              icon={<Type size={16} />}
              label="Show thinking"
              description="AI ki thinking process dikhao (experimental)"
              checked={chat.showThinking}
              onChange={(v) => updateChat({ showThinking: v })}
            />
          </div>
        </div>
      </div>

      {/* Time zone */}
      <div className="mb-6">
        <SectionHeader
          icon={<Clock size={14} color="var(--color-w)" />}
          accent="var(--color-w)"
          title="Time zone"
        />

        <div className="gradient-border rounded-[1.25rem] p-px">
          <div className="rounded-[calc(1.25rem-1px)] bg-panel p-4 space-y-4">
            <div>
              <label className="field-label">Day boundary timezone</label>
              <select
                className="field"
                aria-label="Time zone"
                value={state.timeZone ?? ''}
                onChange={(e) =>
                  update((s) => ({ ...s, timeZone: e.target.value || null }))
                }
              >
                <option value="">Auto (device · {deviceTimeZone()})</option>
                {TIME_ZONES.map((tz) => (
                  <option key={tz.id} value={tz.id}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted">
                Journey ka "aaj" kis timezone ke hisaab se roll hota hai. India ke liye Asia/Kolkata — raat
                12 baje naya day shuru hota hai.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Persona */}
      <div className="mb-6">
        <SectionHeader
          icon={<span className="font-mono text-xs text-text">L</span>}
          accent="var(--color-text)"
          title="Persona"
        />

        <div className="gradient-border rounded-[1.25rem] p-px">
          <div className="rounded-[calc(1.25rem-1px)] bg-panel p-4 space-y-4">
            <div>
              <label className="field-label">User persona / custom instructions</label>
              <textarea
                className="field min-h-[96px] resize-none"
                value={chat.userPersona}
                onChange={(e) => updateChat({ userPersona: e.target.value })}
                placeholder="Blank by default — optional personal instructions yahan likho."
              />
              <button
                type="button"
                className="mt-1.5 text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                onClick={() => updateChat({ userPersona: DEFAULT_USER_PERSONA })}
              >
                Clear user persona
              </button>
            </div>

            <details className="border-t border-border/70 pt-4">
              <summary className="cursor-pointer select-none text-sm font-medium text-muted marker:text-muted-dim">
                Advanced settings · system persona
              </summary>
              <div className="mt-3">
                <label className="field-label">System persona (hidden)</label>
                <textarea
                  className="field min-h-[120px] resize-none"
                  value={chat.systemPrompt}
                  onChange={(e) => updateChat({ systemPrompt: e.target.value })}
                  placeholder="Misa persona, tone, Markdown/LaTeX rules..."
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted">{chat.systemPrompt.length} characters</span>
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => updateChat({ systemPrompt: INTERNAL_SYSTEM_PROMPT })}
                  >
                    Reset Misa persona
                  </button>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg text-muted">
          {icon}
        </span>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted">{description}</p>
        </div>
      </div>
      <label className="toggle shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
        <span className="track">
          <span className="thumb" />
        </span>
      </label>
    </div>
  );
}

import { Bot, Brain, ChevronLeft, MessageSquare, Save, Sparkles, Trash2 } from 'lucide-react';
import type { AppState } from '../types';
import type { ChatSettings } from '../core/domain/state';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';
import { INTERNAL_SYSTEM_PROMPT } from '../core/domain/chat';

interface ChatSettingsScreenProps {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  onBack?: () => void;
}

export default function ChatSettingsScreen({ state, update, onBack }: ChatSettingsScreenProps) {
  const chat = state.aiSettings.chat;

  function updateChat(partial: Partial<ChatSettings>) {
    haptic();
    update((s) => ({
      ...s,
      aiSettings: {
        ...s.aiSettings,
        chat: { ...s.aiSettings.chat, ...partial },
      },
    }));
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
                max="8192"
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
              description="AI plans mein journey context include karega"
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
              <p className="mt-1 text-[10px] text-muted">0 = no history, full conversation memory</p>
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

            {/* Show Thinking */}
            <Toggle
              icon={<Bot size={16} />}
              label="Show Thinking"
              description="AI ki thinking process dikhao (experimental)"
              checked={chat.showThinking}
              onChange={(v) => updateChat({ showThinking: v })}
            />
          </div>
        </div>
      </div>

      {/* System Prompt */}
      <div className="mb-6">
        <SectionHeader
          icon={<Bot size={14} color="var(--color-text)" />}
          accent="var(--color-text)"
          title="Editable System Persona"
        />

        <div className="gradient-border rounded-[1.25rem] p-px">
          <div className="rounded-[calc(1.25rem-1px)] bg-panel p-4">
            <textarea
              className="field min-h-[120px] resize-none"
              value={chat.systemPrompt}
              onChange={(e) => updateChat({ systemPrompt: e.target.value })}
              placeholder="Divya coach persona, tone aur LaTeX rules..."
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted">{chat.systemPrompt.length} characters</span>
              <button
                className="btn btn-ghost text-xs"
                onClick={() => updateChat({ systemPrompt: INTERNAL_SYSTEM_PROMPT })}
              >
                <Trash2 size={12} className="mr-1" />
                Reset Divya
              </button>
            </div>
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

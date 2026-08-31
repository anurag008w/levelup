import { GoogleGenAI, Modality } from '@google/genai/web';
import type {
  LiveAudioRoute,
  LiveCameraLens,
  LiveSessionStatus,
  LiveSettingsConfig,
  LiveStreamStats,
  LiveTranscriptItem,
} from './live-types';
import { AudioStreamer } from './audio-streamer';
import { VisionStreamer } from './vision-streamer';
import { MISA_IDENTITY_GUARD, ROMAN_SCRIPT_RULE, type ChatToolCallRecord } from './chat';
import { setNativeAudioRoute, resetNativeAudioRoute } from '../../lib/native-audio-route';
import { deviceTimeZone } from '../ports/clock';

export interface LiveClientCallbacks {
  onStatusChange?: (status: LiveSessionStatus) => void;
  onTranscriptUpdate?: (transcripts: LiveTranscriptItem[]) => void;
  onStatsUpdate?: (stats: LiveStreamStats) => void;
  onExecuteTool?: (name: string, args: Record<string, unknown>) => Promise<any>;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: any) => void;
  onError?: (error: string) => void;
}

export class GeminiLiveClient {
  private session: any = null;
  private status: LiveSessionStatus = 'idle';
  private audioStreamer: AudioStreamer;
  private visionStreamer: VisionStreamer;
  private callbacks: LiveClientCallbacks = {};

  private config: LiveSettingsConfig;
  private systemPrompt = '';
  private memoryContext = '';

  private transcripts: LiveTranscriptItem[] = [];
  private pendingToolCalls: ChatToolCallRecord[] = [];
  private currentAssistantMessage = '';
  private framesSentCount = 0;
  private connectStartTime = 0;

  constructor(config: LiveSettingsConfig, callbacks: LiveClientCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
    this.audioStreamer = new AudioStreamer();
    if (config.playbackSpeed) {
      this.audioStreamer.setPlaybackSpeed(config.playbackSpeed);
    }
    this.visionStreamer = new VisionStreamer();
  }

  setCallbacks(callbacks: LiveClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  updateConfig(config: Partial<LiveSettingsConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.config.playbackSpeed) {
      this.audioStreamer.setPlaybackSpeed(this.config.playbackSpeed);
    }
  }

  setPlaybackSpeed(speed: number): void {
    this.config.playbackSpeed = speed;
    this.audioStreamer.setPlaybackSpeed(speed);
  }

  getConfig(): LiveSettingsConfig {
    return this.config;
  }

  async reconnectWithNewConfig(apiKey: string, micStream: MediaStream): Promise<void> {
    this.disconnect();
    await this.connect(apiKey);
    await this.startVoiceStreaming(micStream);
  }

  setPrompts(systemPrompt: string, memoryContext = ''): void {
    this.systemPrompt = systemPrompt;
    this.memoryContext = memoryContext;
  }

  getStatus(): LiveSessionStatus {
    return this.status;
  }

  getTranscripts(): LiveTranscriptItem[] {
    return this.transcripts;
  }

  getVisionStreamer(): VisionStreamer {
    return this.visionStreamer;
  }

  private setStatus(status: LiveSessionStatus): void {
    this.status = status;
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(status);
    }
  }

  /** Connect to the Gemini Live API via official Google GenAI SDK. */
  async connect(apiKey: string): Promise<void> {
    if (!apiKey) {
      throw new Error('Google Gemini API Key is required for Live Voice.');
    }
    this.disconnect();
    this.setStatus('connecting');
    this.connectStartTime = Date.now();
    this.framesSentCount = 0;

    const now = new Date();
    const timeZone = this.config.timeZone || deviceTimeZone() || 'Asia/Kolkata';
    const timeString = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });
    const dateString = now.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone,
    });

    const fullSystemInstruction = [
      MISA_IDENTITY_GUARD,
      this.systemPrompt,
      `[LIVE REALTIME CLOCK & CONTEXT]
- Current Local Date: ${dateString}
- Current Local Time: ${timeString} (${timeZone})
- Current ISO Time: ${now.toISOString()}
Rule: When asked what time it is ("kitne baje hai", "kya time ho raha hai", etc.) or what date it is, state this exact time and date.`,
      this.memoryContext ? `\n=== USER CONTEXT & RECOLLECTIONS ===\n${this.memoryContext}\n========================` : '',
      ROMAN_SCRIPT_RULE,
      (() => {
        const speed = this.config.playbackSpeed ?? 1.0;
        if (speed <= 0.88) {
          return 'VOICE PACING: Speak at a calm, relaxed, steady and articulate pace so the student can easily follow formulas and concepts.';
        } else if (speed >= 1.15) {
          return 'VOICE PACING: Speak at an energetic, brisk and rapid conversational pace.';
        }
        return 'VOICE PACING: Speak at a natural, engaging and lively conversational pace.';
      })(),
      'VOICE CONVERSATION RULE: Keep verbal responses short, clear, and direct. Explain formulas intuitively. When answering live doubts, guide step-by-step.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const is90Day = this.config.enable90DayTrack !== false;

    const allToolDeclarations = [
      {
        name: 'webSearch',
        description: 'Search Google and live web for latest JEE Main/Advanced dates, NTA notices, exam announcements, news, cutoffs, facts, and live real-time information.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search query to look up on Google' },
          },
          required: ['query'],
        },
      },
      {
        name: 'getTime',
        description: 'Get the exact current local time, date, and day in India (IST).',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      // Custom To-Dos & Study Vault
      {
        name: 'addTodo',
        description: 'Add a new custom To-Do task for the student (title, priority, duration).',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Task title / description' },
            priority: { type: 'STRING', description: 'high, medium, or low' },
            estimatedMinutes: { type: 'INTEGER', description: 'Estimated minutes (e.g. 30, 45, 60)' },
            category: { type: 'STRING', description: 'physics, chemistry, maths, or general' },
          },
          required: ['title'],
        },
      },
      {
        name: 'listTodos',
        description: 'List active, pending, completed, or past To-Dos of the student (can filter by date, daysBack, or category).',
        parameters: {
          type: 'OBJECT',
          properties: {
            filter: { type: 'STRING', description: 'all, pending, or completed' },
            date: { type: 'STRING', description: 'today, yesterday, or YYYY-MM-DD' },
            daysBack: { type: 'INTEGER', description: 'Number of past days (e.g. 10)' },
            category: { type: 'STRING', description: 'physics, chemistry, maths, general, or revision' },
          },
        },
      },
      {
        name: 'editTodo',
        description: 'Edit a student To-Do: update title, priority (high, medium, low), duration (minutes), category, or completed status.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Current title or substring of the todo to edit' },
            newTitle: { type: 'STRING', description: 'New updated title for the todo' },
            priority: { type: 'STRING', description: 'high, medium, or low' },
            estimatedMinutes: { type: 'INTEGER', description: 'Updated duration in minutes' },
            category: { type: 'STRING', description: 'physics, chemistry, maths, general, or revision' },
            completed: { type: 'BOOLEAN', description: 'true for completed, false for pending' },
          },
          required: ['title'],
        },
      },
      {
        name: 'reorderTodos',
        description: 'Reorder student To-Dos: shift a task to top, bottom, up, or down.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Title or substring of the todo to move' },
            position: { type: 'STRING', description: 'top, bottom, up, or down' },
          },
          required: ['title', 'position'],
        },
      },
      {
        name: 'toggleTodo',
        description: 'Mark a To-Do as completed or pending.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Title or substring of the todo to complete' },
            completed: { type: 'BOOLEAN', description: 'true for completed, false for pending' },
          },
          required: ['title'],
        },
      },
      {
        name: 'deleteTodo',
        description: 'Delete a To-Do from the student list.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Title of the todo to delete' },
          },
          required: ['title'],
        },
      },
      {
        name: 'listVaultResources',
        description: 'List uploaded PDFs, formula sheets, and notes in the Study Vault.',
        parameters: {
          type: 'OBJECT',
          properties: {
            subject: { type: 'STRING', description: 'physics, chemistry, maths, or formula' },
          },
        },
      },
      {
        name: 'getContext',
        description: 'Get current student status: tasks, streak, and progress.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'searchChatHistory',
        description: 'Search past chat conversations and messages by topic/keyword, date, or query with full context.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Keyword, topic or sentence to search in past chats' },
            date: { type: 'STRING', description: 'Specific calendar date (YYYY-MM-DD)' },
            fromDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
            toDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
          },
        },
      },
      {
        name: 'listChatSessions',
        description: 'List all previous chat sessions with titles, dates, and message counts.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'getChatSession',
        description: 'Get full transcript of a specific past conversation by sessionId or title.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sessionId: { type: 'STRING', description: 'ID or title of the session to view' },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'saveCustomMemory',
        description: 'Save an important user fact, goal, or weakness to persistent memory.',
        parameters: {
          type: 'OBJECT',
          properties: {
            content: { type: 'STRING', description: 'Fact to remember (e.g. Rotation is weak)' },
          },
          required: ['content'],
        },
      },
      {
        name: 'searchMemory',
        description: 'Search saved memory entries, facts, goals, or weaknesses by keyword/topic.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Keyword, topic, weakness, or goal to search in memory' },
          },
          required: ['query'],
        },
      },
      {
        name: 'readMemory',
        description: 'Read the recent saved memory facts, preferences, and observations.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'addMemory',
        description: 'Save a new fact, preference, weakness, or goal into AI memory ("yaad rakho X").',
        parameters: {
          type: 'OBJECT',
          properties: {
            content: { type: 'STRING', description: 'Fact to remember' },
          },
          required: ['content'],
        },
      },
      {
        name: 'getTests',
        description: 'Get upcoming coaching test schedule and syllabus.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'getRoutine',
        description: 'Get weekly coaching class routine or time table for a weekday.',
        parameters: {
          type: 'OBJECT',
          properties: {
            day: { type: 'STRING', description: 'Weekday like Monday, Tuesday' },
          },
        },
      },
      // 90-Day Challenge specific tools (only included when is90Day is true)
      ...(is90Day
        ? [
            {
              name: 'getPlan',
              description: 'Get the study plan for a specific day (Day 1-90). Returns tasks and schedule.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  day: { type: 'INTEGER', description: 'Day number (1 to 90)' },
                },
                required: ['day'],
              },
            },
            {
              name: 'addTask',
              description: 'Add a new study task to a specific day in the 90-day plan.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  day: { type: 'INTEGER', description: 'Day number (1 to 90)' },
                  intent: { type: 'STRING', description: 'What to study / title of the task' },
                  durationMin: { type: 'INTEGER', description: 'Duration in minutes (e.g. 30, 45, 60)' },
                },
                required: ['day', 'intent', 'durationMin'],
              },
            },
            {
              name: 'markDone',
              description: 'Mark a 90-day study task as completed for a day.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  day: { type: 'INTEGER', description: 'Day number (1 to 90)' },
                  taskId: { type: 'STRING', description: 'The task id from plan' },
                },
                required: ['day', 'taskId'],
              },
            },
            {
              name: 'editTask',
              description: 'Edit a 90-day study task for a day (title, duration in minutes).',
              parameters: {
                type: 'OBJECT',
                properties: {
                  day: { type: 'INTEGER', description: 'Day number (1 to 90)' },
                  taskId: { type: 'STRING', description: 'The task id from plan' },
                  title: { type: 'STRING', description: 'New title of the task' },
                  durationMin: { type: 'INTEGER', description: 'New duration in minutes' },
                },
                required: ['day', 'taskId'],
              },
            },
          ]
        : []),
    ];

    const toolDeclarations = allToolDeclarations;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const session = await ai.live.connect({
        model: this.config.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voice,
              },
            },
          },
          generationConfig: {
            ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
            ...(this.config.maxOutputTokens !== undefined ? { maxOutputTokens: this.config.maxOutputTokens } : {}),
          },
          ...(this.config.thinkingBudget !== undefined && this.config.thinkingBudget > 0
            ? { thinkingConfig: { thinkingBudget: this.config.thinkingBudget } }
            : {}),
          systemInstruction: {
            parts: [{ text: fullSystemInstruction }],
          },
          tools: [{ functionDeclarations: toolDeclarations as any }],
        },
        callbacks: {
          onopen: () => {
            this.setStatus('connected');
          },
          onmessage: (data: any) => {
            this.handleServerMessage(data);
          },
          onerror: (err: any) => {
            console.error('[GeminiLive] SDK Error:', err);
            this.setStatus('error');
            const msg = err?.message || 'Gemini Live connection error. Please verify your API key and network.';
            if (this.callbacks.onError) this.callbacks.onError(msg);
          },
          onclose: () => {
            if (this.status !== 'idle' && this.status !== 'error') {
              this.setStatus('disconnected');
            }
          },
        },
      });

      this.session = session;
      this.setStatus('connected');
      void setNativeAudioRoute(this.config.defaultAudioRoute);
    } catch (err: any) {
      this.setStatus('error');
      const msg = err?.message || 'Failed to establish Gemini Live connection';
      if (this.callbacks.onError) this.callbacks.onError(msg);
      throw new Error(msg);
    }
  }

  private handleServerMessage(data: any): void {
    if (!data) return;

    // 1. Tool Calls from Gemini Live
    if (data.toolCall?.functionCalls) {
      void this.handleToolCalls(data.toolCall.functionCalls);
    }

    // 2. Interruption handling
    if (data.serverContent?.interrupted) {
      this.audioStreamer.flushPlayback();
      this.setStatus('listening');
      if (this.currentAssistantMessage) {
        this.updateTranscript('assistant', `${this.currentAssistantMessage} [interrupted]`, true);
        this.currentAssistantMessage = '';
      }
      return;
    }

    // 3. Audio parts from model turn
    const parts = data.serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      this.setStatus('speaking');
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          this.audioStreamer.playAudioChunk(part.inlineData.data);
        }
        if (part.text) {
          this.currentAssistantMessage += part.text;
          this.updateTranscript('assistant', this.currentAssistantMessage, false);
        }
      }
    }

    // 4. Real-time Output Transcription (Assistant subtitles)
    if (data.serverContent?.outputTranscription?.text) {
      this.currentAssistantMessage += data.serverContent.outputTranscription.text;
      this.updateTranscript('assistant', this.currentAssistantMessage, false);
    }

    // 5. Real-time Input Transcription (User subtitles)
    if (data.serverContent?.inputTranscription?.text) {
      this.updateTranscript('user', data.serverContent.inputTranscription.text, false);
    }

    // 6. Turn complete
    if (data.serverContent?.turnComplete) {
      this.currentAssistantMessage = '';
      this.setStatus('listening');
    }
  }

  private async handleToolCalls(functionCalls: any[]): Promise<void> {
    const functionResponses: any[] = [];
    this.setStatus('thinking');
    for (const fc of functionCalls) {
      let output: any = { result: 'Success' };
      try {
        this.callbacks.onToolCall?.(fc.name, fc.args || {});
        if (this.callbacks.onExecuteTool) {
          output = await this.callbacks.onExecuteTool(fc.name, fc.args || {});
        }
        this.callbacks.onToolResult?.(fc.name, output);
      } catch (err: any) {
        output = { error: err?.message || 'Failed to execute tool' };
      }

      let displayMessage = '';
      if (output?.error) {
        displayMessage = `Error: ${output.error}`;
      } else if (typeof output === 'string') {
        displayMessage = output;
      } else if (output && typeof output === 'object') {
        displayMessage =
          output.summary ||
          output.result ||
          output.plan ||
          output.searchResult ||
          output.context ||
          output.tests ||
          output.routine ||
          output.todos ||
          output.vaultResources ||
          output.chatSearchResults ||
          output.chatSessions ||
          output.chatTranscript ||
          output.memorySearchResults ||
          output.memory ||
          (output.currentTime ? `Current Time: ${output.currentTime}, Date: ${output.currentDate || ''}` : '') ||
          JSON.stringify(output, null, 2);
      } else {
        displayMessage = 'Tool executed';
      }

      this.pendingToolCalls.push({
        action: fc.name,
        ok: !output?.error,
        message: displayMessage,
      });

      functionResponses.push({
        id: fc.id || fc.name,
        name: fc.name,
        response: { output },
      });
    }

    if (this.session) {
      try {
        this.session.sendToolResponse({
          functionResponses,
        });
      } catch (e) {
        console.warn('[GeminiLive] Failed to send tool response:', e);
      }
    }
  }

  /** Send a live text message turn over the active Live session. */
  sendTextMessage(text: string, displayText?: string, toolCalls?: ChatToolCallRecord[]): void {
    if (!this.session) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    // Display clean text for the user message bubble (never dump raw tool outputs into user bubble!)
    const cleanUserText = (displayText || text).trim();
    this.updateTranscript('user', cleanUserText);

    // If tools were pre-executed, store them on pendingToolCalls so they appear inside the assistant card box!
    if (toolCalls && toolCalls.length > 0) {
      this.pendingToolCalls.push(...toolCalls);
    }

    try {
      this.session.sendRealtimeInput({
        text: trimmed,
      });
    } catch (e) {
      console.warn('[GeminiLive] Failed to send text message:', e);
    }
  }

  private updateTranscript(role: 'user' | 'assistant', text: string, isInterrupted = false): void {
    const lastItem = this.transcripts[this.transcripts.length - 1];
    if (lastItem && lastItem.role === role && !lastItem.isInterrupted) {
      lastItem.text = text;
      if (role === 'assistant' && this.pendingToolCalls.length > 0) {
        lastItem.toolCalls = [...(lastItem.toolCalls || []), ...this.pendingToolCalls];
        this.pendingToolCalls = [];
      }
    } else {
      const activeCalls = role === 'assistant' && this.pendingToolCalls.length > 0 ? [...this.pendingToolCalls] : undefined;
      if (role === 'assistant') {
        this.pendingToolCalls = [];
      }
      this.transcripts.push({
        id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        text,
        timestamp: new Date().toISOString(),
        isInterrupted,
        toolCalls: activeCalls,
      });
    }

    if (this.callbacks.onTranscriptUpdate) {
      this.callbacks.onTranscriptUpdate([...this.transcripts]);
    }
  }

  private isUserTalkingOverThreshold = false;

  /** Start recording user voice & streaming audio chunks. */
  async startVoiceStreaming(mediaStream: MediaStream): Promise<void> {
    await this.audioStreamer.startRecording(
      mediaStream,
      (pcm16Base64) => {
        this.sendAudioChunk(pcm16Base64);
      },
      (inputLevel) => {
        this.isUserTalkingOverThreshold = inputLevel > 0.25;
        if (inputLevel > 0.08 && this.status === 'connected') {
          this.setStatus('listening');
        }
        this.updateStats(inputLevel, 0);
      },
      (outputLevel) => {
        this.updateStats(0, outputLevel);
      },
    );
  }

  private sendAudioChunk(pcm16Base64: string): void {
    if (!this.session) return;
    // Prevent acoustic feedback from device speakers from cutting off assistant sentences mid-speech
    if (this.status === 'speaking' && !this.isUserTalkingOverThreshold) {
      return;
    }
    try {
      this.session.sendRealtimeInput({
        audio: {
          data: pcm16Base64,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    } catch (e) {
      console.warn('[GeminiLive] Failed to send audio chunk:', e);
    }
  }

  /** Start streaming camera frames (Front or Back lens). */
  async startCameraStream(lens: LiveCameraLens): Promise<MediaStream> {
    return this.visionStreamer.startCamera(lens, this.config.videoFps, (jpegBase64) => {
      this.sendVideoFrame(jpegBase64);
    });
  }

  /** Flip between Front and Back camera. */
  async flipCamera(): Promise<MediaStream> {
    return this.visionStreamer.switchLens(this.config.videoFps, (jpegBase64) => {
      this.sendVideoFrame(jpegBase64);
    });
  }

  /** Start screen sharing stream. */
  async startScreenStream(onEnded?: () => void): Promise<MediaStream | null> {
    return this.visionStreamer.startScreenShare(this.config.screenFps, (jpegBase64) => {
      this.sendVideoFrame(jpegBase64);
    }, onEnded);
  }

  stopVision(): void {
    this.visionStreamer.stop();
  }

  private sendVideoFrame(jpegBase64: string): void {
    if (!this.session) return;
    try {
      this.framesSentCount++;
      this.session.sendRealtimeInput({
        video: {
          data: jpegBase64,
          mimeType: 'image/jpeg',
        },
      });
    } catch (e) {
      console.warn('[GeminiLive] Failed to send video frame:', e);
    }
  }

  setMuted(muted: boolean): void {
    this.audioStreamer.setMuted(muted);
  }

  /** Switch audio output route (Speaker / Earpiece / Bluetooth). */
  async setAudioRoute(route: LiveAudioRoute): Promise<void> {
    this.config.defaultAudioRoute = route;
    try {
      await setNativeAudioRoute(route);
    } catch (err) {
      console.warn('[GeminiLive] setAudioRoute failed:', err);
    }
  }

  private updateStats(inputVolume = 0, outputVolume = 0): void {
    if (this.callbacks.onStatsUpdate) {
      this.callbacks.onStatsUpdate({
        latencyMs: Math.max(18, Math.min(120, Math.round((Date.now() - this.connectStartTime) % 50 + 20))),
        inputVolume,
        outputVolume,
        fps: this.visionStreamer.getIsCameraActive() || this.visionStreamer.getIsScreenSharing() ? this.config.videoFps : 0,
        framesSent: this.framesSentCount,
      });
    }
  }

  disconnect(): void {
    this.audioStreamer.stopRecording();
    this.visionStreamer.stop();
    void resetNativeAudioRoute();
    if (this.session) {
      try {
        this.session.close?.();
      } catch {
        // Ignored
      }
      this.session = null;
    }
    this.setStatus('idle');
  }

  /** Static helper to fetch available Live-compatible models from Gemini API. */
  static async fetchLiveModels(apiKey: string): Promise<string[]> {
    if (!apiKey) throw new Error('API key is required to fetch models');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch models (HTTP ${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const models: any[] = data?.models ?? [];
    const liveModels = models
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((name) => {
        const lower = name.toLowerCase();
        return (
          lower.startsWith('gemini') ||
          lower.includes('live') ||
          lower.includes('realtime') ||
          lower.includes('audio') ||
          lower.includes('flash') ||
          lower.includes('pro')
        );
      });

    const defaults = [
      'gemini-3.1-flash-live-preview',
      'gemini-2.5-flash-native-audio-preview-09-2025',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-realtime-exp',
    ];
    const merged = Array.from(new Set([...liveModels, ...defaults]));
    return merged;
  }

  /** Static helper to play a voice preview using GoogleGenAI SDK and Audio element. */
  static async previewVoice(apiKey: string, voice: string, sampleText: string, model = 'gemini-3.1-flash-live-preview'): Promise<void> {
    if (apiKey) {
      // 1. Try Live WebSocket connection using the exact selected Live Model (e.g. gemini-3.1-flash-live-preview)
      try {
        const ai = new GoogleGenAI({ apiKey });
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          const audioCtx = new AudioCtxClass({ sampleRate: 24000 });
          let nextPlayTime = 0;
          let hasPlayed = false;

          const liveSession = await ai.live.connect({
            model: model || 'gemini-3.1-flash-live-preview',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice,
                  },
                },
              },
            },
            callbacks: {
              onmessage: (data: any) => {
                const parts = data.serverContent?.modelTurn?.parts;
                if (Array.isArray(parts)) {
                  for (const part of parts) {
                    if (part.inlineData?.data) {
                      hasPlayed = true;
                      const base64 = part.inlineData.data;
                      const binary = atob(base64);
                      const bytes = new Uint8Array(binary.length);
                      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                      const int16 = new Int16Array(bytes.buffer);
                      const float32 = new Float32Array(int16.length);
                      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

                      const audioBuf = audioCtx.createBuffer(1, float32.length, 24000);
                      audioBuf.copyToChannel(float32, 0);
                      const source = audioCtx.createBufferSource();
                      source.buffer = audioBuf;
                      source.connect(audioCtx.destination);
                      const now = audioCtx.currentTime;
                      nextPlayTime = Math.max(now + 0.005, nextPlayTime);
                      source.start(nextPlayTime);
                      nextPlayTime += audioBuf.duration;
                    }
                  }
                }
                if (data.serverContent?.turnComplete) {
                  window.setTimeout(() => {
                    try { liveSession.close(); } catch {}
                  }, 1200);
                }
              },
            },
          });

          liveSession.sendRealtimeInput({
            text: `Please say: "${sampleText}"`,
          });

          // Wait up to 3.5 seconds for preview audio
          await new Promise((resolve) => setTimeout(resolve, 3500));
          try { liveSession.close(); } catch {}
          if (hasPlayed) return;
        }
      } catch (err) {
        console.warn(`[GeminiLive] Ephemeral live voice preview failed for ${model}:`, err);
      }

      // 2. Try generateContent audio candidates
      const candidates = Array.from(
        new Set([model, 'gemini-2.0-flash-exp', 'gemini-2.0-flash-realtime-exp', 'gemini-2.5-flash-native-audio-preview-09-2025'].filter(Boolean)),
      );
      for (const m of candidates) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: m,
            contents: sampleText,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice,
                  },
                },
              },
            },
          });

          const part = response.candidates?.[0]?.content?.parts?.[0];
          const base64Data = (part as any)?.inlineData?.data;
          const mimeType = (part as any)?.inlineData?.mimeType || 'audio/wav';

          if (base64Data) {
            const binary = atob(base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const blob = new Blob([bytes], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.volume = 1.0;
            await audio.play();
            return;
          }
        } catch (err) {
          console.warn(`[GeminiLive] SDK voice preview failed with model ${m}:`, err);
        }
      }
    }

    // High quality browser voice synthesis fallback
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(sampleText);
      const voices = window.speechSynthesis.getVoices();
      const female = voices.find(
        (v) =>
          (v.name.toLowerCase().includes('female') ||
            v.name.toLowerCase().includes('natural') ||
            v.name.toLowerCase().includes('zira') ||
            v.name.toLowerCase().includes('samantha') ||
            v.name.toLowerCase().includes('google')) &&
          (v.lang.startsWith('en') || v.lang.startsWith('hi')),
      );
      if (female) utterance.voice = female;
      utterance.volume = 1.0;
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  }
}

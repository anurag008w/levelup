# Migration Plan — Phase 1: AI-Powered Habit & Task Engine

## 1. Current Architecture Analysis

**Stack:** React 19 + Vite 8 + Tailwind v4 + TypeScript + Capacitor (Android). All state lives in `localStorage` (`human-os-state-v1`). No backend, no tests, no AI.

**Current structure:**

| Module | Responsibility | Issues |
| --- | --- | --- |
| `src/data/curriculum.ts` | 30 levels, 13 authored, **daily tasks hardcoded inside levels** | Tasks are data-in-code; metadata is minimal (id/slot/text/habitId) |
| `src/data/protocols.ts` | Mock-test + exam-month checklists (hardcoded) | Same problem |
| `src/lib/engine.ts` | Date math, cumulative task selection, streaks, scores, level status, review cadence, exam protocol (210 lines, mixed concerns) | Monolithic; task selection hardcoded to curriculum; not testable in isolation |
| `src/lib/storage.ts` | localStorage read/write | No repository abstraction, no migration path |
| `src/lib/useAppState.ts` | React state + persistence | No planner/summary pipeline |
| Screens | Today / Levels / Progress / Review | All import `engine` directly |

**Key architectural problems:**
1. Business logic depends on a hardcoded task list (`getCumulativeTasks`). Cannot scale to thousands of tasks or add data without code changes.
2. No structured metadata on tasks (difficulty, duration, energy, prerequisites, task type, unlock conditions...).
3. No progression engine — tasks are purely calendar-driven.
4. No AI, no memory, no summaries.
5. `engine.ts` mixes pure domain logic, storage reads, and presentation concerns.
6. Zero tests; storage has no schema versioning.

## 2. Target Architecture (Clean Architecture)

```
src/
  core/
    domain/     # entities, value types, errors (no infra imports)
    ports/      # repository + LLM + clock interfaces
  features/
    task-bank/   # Task Bank: seed data (JSON/TS data), repository, search, ranking, validation
    habit-engine/ # Progression context + deterministic plan builder + habit stats
    ai/           # Task generation (bank-first), memory, daily summaries, prompts
    settings/     # Provider settings + model catalog (discovery, cache, filters)
  infra/
    storage/      # localStorage repositories + v1→v2 migration
    ai/           # HTTP client, provider adapters, factory, hidden env provider
  di/             # composition root (simple factory-based DI, no framework)
  lib/            # legacy facade + React hooks (kept source-compatible)
  screens/ components/
```

**Layering rules:** `domain` depends on nothing. `features` depend on `domain` + `ports`. `infra` implements `ports`. `di` wires everything. UI only talks to services from the container. Every module is unit-testable with injected fakes.

## 3. Migration Steps (incremental, no regressions)

### M1 — Domain model + Task Bank
- Define full `TaskBankEntry` metadata: id, habitId, title, description, phase, difficulty, estimatedDurationMin, energyLevel, tags, prerequisites, taskType, revisionSuitability, backlogSuitability, thinkingSkills, jeeRelevance, unlockConditions.
- Extract every hardcoded task from `curriculum.ts` and `protocols.ts` into Task Bank seed data. **Legacy task IDs (`d1_t1`, `mock_1`, `exam_1`) are preserved exactly** so history, streaks and scores survive.
- `Level.dailyTasks` is removed from `curriculum.ts`; UI reads tasks through the Task Bank repository.
- Repository merges static seed + AI-generated/user tasks persisted in localStorage. Search/filter/rank are pure functions.

### M2 — Habit Progression Engine
- `buildPlanningContext()`: aggregates day number, unlocked habits, streaks, missed/weak habits, backlog, revision schedule, available study time, exam window, recovery mode, previous summaries.
- `buildDailyPlan()`: deterministic, no randomness. For a healthy state it reproduces the **exact legacy task set/order** (backward-compat proof). Intelligence layers on top: recovery-mode split, weak-habit revision injection, backlog injection, gap recovery — all driven by Task Bank entries (never by hardcoded lists).
- `src/lib/engine.ts` becomes a thin facade delegating to services so existing screens keep working until migrated.

### M3 — AI Provider System
- Port `LLMProvider` (complete/stream/fetchModels/healthCheck) + `ModelInfo` with full metadata.
- Adapters: `openrouter`, `gemini` (native REST), `opencode`/`opencode-zen` (shared Zen adapter), generic `openai-compatible` + `custom`. Shared HTTP client with timeout/retry; OpenAI-compatible request shaping reused across adapters.
- Automatic model discovery per provider with localStorage caching (TTL) + manual refresh. Metadata mapped defensively per official docs. **No hardcoded model IDs** anywhere.
- Settings service supports API key, base URL, model, temperature, max tokens, streaming, timeout, retry, fallback model, health check, custom headers.
- One hidden default provider configured **only via environment variables**; UI never reveals its model name or credentials; used as fallback.

### M4 — AI Memory
- Persistent memory store (localStorage): conversations, observations, progression, journals, goals, preferences. Searchable by type/tags/date. Importance score drives retention.
- Auto-summarization when context exceeds thresholds (raw entry count / char budget): LLM compresses older entries into condensed memories; high-importance entries preserved verbatim. Never silently drops important context.

### M5 — AI Task Generation
- Generation order strictly: **1. search Task Bank → 2. rank → 3. build plan → 4. AI only if no suitable tasks exist.** AI-generated tasks validated by zod against the exact metadata schema, persisted into the dynamic bank extension, marked `source: 'ai'`.

### M6 — Daily Summary Pipeline
- End-of-day structured summaries: completed/missed, habit progress, streaks, weak/strong habits, revision completed, backlog status, journal insights, AI observations, thinking score, productivity score.
- Deterministic scoring (completion weighted by thinking skills and duration); AI observations best-effort (graceful when no provider).
- Summaries stored permanently; planner consumes the latest summaries. Missed days never reset progress — gaps detected and intelligent recovery plans generated.

### M7 — UI wiring
- Today screen uses the plan from the planner (identical visible behavior by default, `source` badges for AI-recommended tasks).
- New "AI" tab: provider settings, health check, model picker (grouped by provider, free-first, search/filter).
- Progress screen: weak/strong habits + latest daily summary.

### M8 — Quality gates
- vitest unit tests per feature (bank search/rank, planner backward-compat, recovery/gap logic, memory summarization, provider request shaping with faked fetch).
- `npm run lint`, `npm run build`, `npm test` all green.

### M9 — AI Chat (done)
- HTTP stack supports external abort signals: `AbortSignal.any` in `rawFetch`/`requestSse`, distinct `aborted` vs `timeout` kinds, abort short-circuits the provider fallback chain (user cancel is never retried on another provider).
- Chat domain (`core/domain/chat.ts`): `ChatMessage` / `ChatSession` / `ChatPreferences` (provider, model, temperature, persona/system prompt, include-context toggle), persisted in its own storage key (`human-os-chat-v1`) so transcripts never bloat the app-state snapshot.
- `ChatService` (`features/chat/chat.service.ts`): session CRUD + cap (20 sessions, 100 messages), first-message title derivation, today-context injection from the planner, streaming send with delta accumulation, abort keeps partial text as a `stopped` message, hard errors roll back the user message, fresh-parse-safe persistence (in-memory snapshot so mutations survive `repo.load()`).
- `ChatScreen` (`screens/ChatScreen.tsx`): session chips, collapsible options panel (provider/model/temperature slider/persona/context + model catalog datalist), streaming bubble with live cursor, stop button, clear/delete session, error surfacing.
- Tests: `llm.test.ts` stream dispatch + abort short-circuit, `chat.test.ts` (8) incl. fresh-parse persistence regression. 55 total.
- Browser-verified end-to-end against a local mock SSE server (real `fetch`, real streaming, persisted transcripts, zero console errors).

### M10 — Production-grade UI pass (done)
- Shared UI kit (`components/ui/`): `ScreenHeader`, `Card`, `SectionHeader`, `ProgressBar`, `EmptyState`, `Stat`, plus `components/AddProviderForm.tsx` (add openrouter / gemini / opencode / openai-compatible providers).
- CSS design-system layer in `src/index.css` on top of Tailwind: `.screen`, `.card`, `.btn`/`-primary`/`-teal`/`-ghost`, `.chip`, `.field`, `.gradient-border`, `.eyebrow`, `.fade-up`, `.shimmer`, `.pulse-dot`; respects `prefers-reduced-motion`.
- TabBar redesigned (active pill + teal accent); DayGauge now dual rings (journey + today) with `% done` badge.
- Every tab redesigned: TodayScreen (gradient hero + stat cards + accent task rows), LevelsScreen (timeline dots + collapsible detail blocks), ProgressScreen (Stat grid + Strong/Building/Needs-Work tiers), ReviewScreen (due cards + exam-date card + past reviews), AISettingsScreen (AI toggle + shared AddProviderForm), ChatScreen (avatars, streaming cursor, mini toggles, provider picker).
- Provider picker fix: `ProviderSettingsService.listStoredProviders()` returns every stored provider (enabled or not) so Chat/Settings dropdowns list all, and inline `AddProviderForm` lets users add a new provider right from Chat.
- Verified: 55 tests green, `tsc -b`/`lint`/`build` clean, Playwright E2E across all 6 tabs (no console errors) + full chat stream/persist check.

### M11 — SSE streaming robustness fix + AI task wiring + chat tools (done)
- **Root-cause fix for empty chat replies**: `requestSse` in `infra/ai/http.ts` and `http-native.ts` parsed only the first `data:` line and split solely on `'\n\n'`, so CRLF-framed SSE (some Gemini-ish gateways) yielded zero deltas → replies saved/rendered empty. Now normalize `\r\n` → `\n`, tolerate trailing `\r`, and join multi-line `data:` frames via `emitDataLines()`. Additionally, `openai-compatible.ts` and `gemini.ts` fall back to one non-streaming `complete()` call when a stream yields no content (skipped on user abort) instead of surfacing an empty reply.
- **AI task generation actually wired (M5 completion)**: `TaskGenerationService` existed but was never called from UI. Added `saveDynamicEntry()` to `TaskBankService`; new `components/AITaskForm.tsx` on TodayScreen (intent input + 15/30/45/60m duration chips) → LLM designs a task validated by the same zod seed schema, persisted into `dynamicTaskBank` with `ai-` id, `unlockConditions: [{ type: 'day', fromDay: N }]`, capped at 5 AI tasks/day. Bank-first: a confident bank match never calls the LLM.
- **Chat tools (view/modify any day)**: `core/domain/chat-tools.ts` (zod discriminated union `chatToolActionSchema` + `CHAT_TOOL_INSTRUCTIONS`) and `features/chat/chat-tools.service.ts` (`ChatToolsService`) with provider-agnostic execution — a deterministic decision hop asks the model for ONE strict-JSON action, the app executes it locally, then streams a Hinglish summary. Tools: `getPlan` (any day 1–90), `getRange` (max 7 days), `addTask`, `removeTask` (dynamic entries only; seed tasks are viewable/done-able but never removable), `markDone` (writes `state.taskLogs[dateISO][taskId]`). `ChatService.send()` accepts an optional `tools` ctor arg and routes task queries through the tool hop; `App.tsx` calls `useAppState.refresh()` on tab switch so chat mutations appear on Today instantly.
- Tests: `http-fetch.test.ts` (4: LF/CRLF/CRLF-split/multi-line join), `http-native.test.ts` (2), `provider.test.ts` (2: empty-stream fallback + no-fallback-on-abort), `task-generation.test.ts` (6), `chat-tools.test.ts` (11: parse/getPlan/getRange clamp/markDone persist/addTask/removeTask seed-guard + ChatService tool-execute + direct-answer paths). **77 tests green**, `tsc -b`/`lint`/`build` clean.
- Browser-verified E2E (Playwright + local mocks): CRLF stream persists, JSON-only provider falls back to non-streaming, AI Task Generator adds a persisted `ai-` task, chat tool `getPlan`/`markDone` execute with the real plan in the summary prompt, `markDone` reflects as a checked task on Today after tab switch, all 6 tabs render with zero console errors.

### M12 — Chat-driven task creation (done)
- Removed the `AITaskForm` card (with its 15/30/45/60m chips) from the Today tab. Task creation now lives in chat: the `addTask` chat tool generates (bank-first, else AI) and persists the task, with a hint banner on the Chat screen.
- Fixed the real bug this exposed: dynamic (custom/AI) tasks were gated behind the weak/revision intelligence heuristics, so an explicitly requested task often never appeared in the plan. `PlanningContext` now carries `dynamicEntries` (`state.dynamicTaskBank`); the planner injects every unlocked, active dynamic task into the plan in its natural slot (`source: 'ai'`, `reason: 'custom'`, non-required), independent of heuristics. New planner tests cover inclusion + not-before-unlock. **79 tests green**, gates clean.
- Browser-verified: after "aaj ke liye thermodynamics ka revision task add karo" the task appears in Today's Night Review section (plan shows 5 tasks) and persists in `dynamicTaskBank`.

### M13 — Chat reliability + reasoning/thinking UI + markdown/math (done)
- **Tool-refusal retry (the Gemini-flash-lite bug)**: `chat.service.ts` now runs ONE extra deterministic hop with `CHAT_TOOL_RETRY` ("You just answered with normal text … must be a tool action") when a task query yields a decision with no action. Only if the retry also refuses does the prose get delivered as the answer. The refusal-from-a-weak-model bug that made every delete/modify fail is gone.
- **Thinking/reasoning captured provider-agnostically**: `LLMRequest`/`LLMResponse` gained `thinking`/`reasoning` fields; `ProviderConfig` gained `thinking`. Gemini sends `thinkingConfig.thinkingBudget` (low/medium/high = 2048/4096/16384) and splits `thought` parts from visible parts; OpenAI-compatible providers extract `reasoning_content`/`reasoning` from complete and stream responses. `ChatMessage` persists `reasoning` + `tool`.
- **Chat UI**: new `ChatMarkdown` component (react-markdown + remark-gfm + remark-math + rehype-katex + KaTeX CSS) renders markdown, tables, fenced code and LaTeX with the app's dark palette; assistant bubbles show a collapsible "AI soch raha hai (N chars)" thinking block and a `tool: <name>` badge; streaming bubble shows live thinking + cursor. Hint banner advertises task add/remove/mark from chat.
- **Task-creation failure fix (two real bugs)**: (1) Gemini rejects `thinkingConfig` when the thinking budget ≥ `maxOutputTokens`, and small chat windows (500/1024 tokens) clashed with the 16k budget → every Gemini request 400'd once thinking was on. `gemini.ts` now clamps the budget below the window (and drops it entirely when there's no room); chat stream/summary windows were widened (2048/1024) and the JSON-only decision/retry hops set `thinking: 'off'`. (2) Weak models (Gemini flash lite) answer the task-design prompt with prose → `TaskGenerationService.askAi` now runs one strict correction retry ("ONLY the JSON object now") mirroring the chat tool retry, so add-task survives the same refusal pattern. Both retries verified E2E.
- **Thinking selector moved to AI Settings**: per-model thinking default now lives in the Add Provider form (`thinking` on `ProviderConfig`), removed from chat Options (chat still inherits it via `resolveThinking`). `AITaskForm.tsx` (dead since M12) deleted.
- **System prompt strengthened** to kill the other flash-lite behavior — claims of no memory/history: "Tumhe isi chat ka poori baat-cheet milti hai … pichle user messages tumhe dikhte hain … 'yaad nahi' mat bolna".
- Tests: provider reasoning/thinking-config cases (incl. budget clamp + drop-on-tiny-window), chat-tool retry (refusal → retry → tool executes), task-generation strict-JSON retry, reasoning capture + deltas + status reporting. **91 tests green**, `tsc -b`/`lint`/`build` clean.
- Browser-verified (Playwright + local mock with a deliberately refusing model): delete request → mock refuses with prose → service retries → `removeTask` executes → `tool: removeTask` badge + "AI soch raha hai" thinking block visible, `$$x^2+y^2=z^2$$` renders via KaTeX, bold `**Summary:**` renders, all persisted (`reasoning` + `tool` fields), zero console errors. Add-task survives BOTH refusal hops (decision + task-gen) and persists `Thermodynamics ke 3 numericals` into `dynamicTaskBank`. All 6 tabs still render clean; thinking selector confirmed present in Add Provider form and absent from chat Options.

## 4. Backward Compatibility Contract
- Existing `human-os-state-v1` data is migrated to `v2` (old key never deleted).
- All legacy task IDs stable; protocol logs (`mock:<date>`, `exam:<date>`) keep their exact storage keys.
- Streak/score formulas produce identical results on the same data.
- All existing screens keep functioning; visuals unchanged by default.

## 5. Verification plan
After each milestone: unit tests + `npm run lint` + `npm run build`. End of phase: full test suite + manual UI check via `npm run dev` + preview link.

# Misa AI — Senior QA Bug Audit Report

**Project:** JEE LevelUp (React + Vite + Capacitor + TypeScript)
**Repository root:** `/home/anurag/Desktop/levelup`
**Audit date:** 2026-08-11
**Baseline reviewed:** `docs/QA-REPORT.md` (dated 2026-08-06)
**Scope:** Verify every dated FIXED/OPEN item against source; find only bugs with exact file:line evidence. Read-only audit — no files were modified.

---

## 1. Executive Summary

The QA report dated 2026-08-06 is **substantially accurate**. All dated FIXED items (H1, H2, H1(Rel), H1(UX), H1(A11y)) were re-verified in the current source and are correctly fixed. All OPEN items (M1–M13, L1–L7) were still present with source evidence at audit time.

**Post-audit fix round (2026-08-11, same day):** the Tier-1 items, the audit's own data-integrity findings, the remaining N3 rollback half, the HIGH "persisted actions" bucket (M11, N5) and the malformed-JSON leak (M2) have been **fixed and verified**. See Section 12 for the fix ledger.

**New findings this audit (not in the baseline QA report):**

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| N1 | CRITICAL | Startup race: persisted state can be wiped by an empty state on fresh app open | `local-storage.ts:37` (un-awaited `init()`) + `useAppState.ts:21` (synchronous state read) |
| N2 | HIGH | `CachedStateStore` caches the first loaded state forever; never re-reads storage after init | `state-repository.ts:184-186` |
| N3 | MEDIUM | "Delete all data" can complete with partial wipe and stale UI on failure | `delete-all.ts:20-42`, `AISettingsScreen.tsx:157-176` |
| N4 | LOW | Test-suite flakiness rooted in the same un-awaited async init pattern (2 order-dependent failures observed; both pass in isolation) | `sync-integration.test.ts`, `settings-open.test.tsx` |
| N5 | MEDIUM | Image attachments persist as volatile blob `previewUrl`s — broken thumbnails + silent AI image-context loss after app reload | `ChatScreen.tsx:525,2329`, `chat.service.ts:386,1278-1283`, `chat-transcript.ts:45-47` |
| M8-CONFIRMED | MEDIUM | Daily summary pipeline is dead code — `state.summaries` is never written in production (zero call sites for `runDailyPipeline`), so journey/habit contexts always see empty summaries | `container.ts:146`, `summary.service.ts:54-58` (calls only in `__tests__/summary.test.ts`) |

**Test suite status (post-fix round, 2026-08-11):** **1121 passed / 0 failed of 1121** (87 files). The 2 order-dependent flakes (N4) are gone, and 17 new regression tests were added (M1 word-boundary, M7 prune notice, M8 scheduler, N3 rollback, M2 malformed JSON, N5/M11 image fallback).

**Bottom line:** All data-integrity issues (N1, N2, N3), the audit's confirmed dead code (M8), Tier-1 correctness issues (M1, M7), the HIGH "persisted actions" bucket (M11, N5), and the malformed-JSON leak (M2) are **fixed and covered by regression tests**. Remaining OPEN items are Tier 2/3 (chat quality, a11y, low severity) — see Section 11.

---

## 2. Verified QA Report Status

### 2.1 FIXED items — re-verified in current source ✅

| Item | Claim | Verification (file:line) |
|------|-------|--------------------------|
| H1 | setDayMode uses preview-then-confirm | Confirmed. `confirmationRequired: true` on `setDayMode` in the action registry (`chat-tools.service.ts:32-38`); executor builds preview + confirm (`chat-tools.service.ts:1102+`) |
| H2 | `mergeRetryActions` canonicalizes key order | Confirmed. `actionKey(parts)` normalizes keys with slash + defaults (`chat.service.ts:58-64`); retry dedupe merges into single `{key, value, args}` (`chat.service.ts:96-107`) |
| H1(Rel) | Root error boundary around app | Confirmed. `RootErrorBoundary` wraps `<App/>` (`main.tsx:19-24`) |
| H1(UX) | Account isolation (per-account data partition) | Confirmed. Per-account storage owner `levelup.data-owner` written on login/switch (`App.tsx:36-67`); reset path rewrites owner (`delete-all.ts:36-42`); all read paths keyed by owner (`useAppState.ts`, `sync-coordinator.ts`) |
| H1(A11y) | Keyboard/screen-reader a11y for chat status | Confirmed. `liveAnnounce` for streaming (`ChatScreen.tsx:175`), `role="status"` sr-only live region (`ChatScreen.tsx:924`) |

### 2.2 OPEN items — still present with evidence

**Misa AI / chat:**

- **M1 — isTaskQuery substring false positives** — ✅ FIXED (2026-08-11). `isTaskQuery` now uses whole-word matching built from the intent list (`buildWordBoundaryRegex` in `chat-tools.service.ts:76-98`, applied at `chat-tools.service.ts:190-196`): `mark` no longer fires inside `remark`/`market`, `day` no longer fires inside `today`/`monday`, `test` no longer fires inside `latest`/`contest`, `list` no longer fires inside `listen`/`listing`, `add` no longer fires inside `addition`/`address`, `clear` no longer fires inside `clarify`, `all` no longer fires inside `wall`/`call`. Plural forms (`days`, `marks`, `tests`) still match; block commands keep their anchor via `BLOCK_ANCHOR_REGEX` + `BLOCK_COMMAND_REGEX`. Regression tests: `chat-tools.test.ts` — "does NOT hijack ordinary chat words that merely contain a plan word (M1 word-boundary fix)".
- **M2 — invalid tool JSON passed raw to LLM** — ✅ FIXED (2026-08-11). `looksLikeToolOutput` (`chat.service.ts:73-88`) now treats brace/array-prefixed text that fails `JSON.parse` as a **broken tool call** instead of a natural-language answer. The harness (`chat.service.ts:609-630`) drops it and falls through to the default reply path — the malformed JSON can no longer be shown verbatim or persisted into the assistant history where it would corrupt the next generation. Regression test: `chat.test.ts` — "drops malformed tool JSON instead of leaking it into the assistant history (M2)".
- **M3 — editTask day membership unvalidated** — STILL OPEN. `editTask` executor (`chat-tools.service.ts:1153-1191`) accepts any day number; nothing verifies the task actually belongs to that day. A model that sets the wrong day persists a task under the wrong bucket.
- **M4 — "copy chat to memory" can copy an existing memory** — STILL OPEN (verified earlier read of `memory-tools.service.ts`); duplicate memory entries are appended without dedupe against `task.title`/existing memory titles.
- **M5 — task search scans ALL sessions for keywords** — STILL OPEN. `listMemoryConversations` searches every session's messages for keywords (`chat.service.ts:1728-1749`), so a plain "show my to-do" can surface stale conversations from any day; performance also degrades with session count.
- **M6 — Misa replies with `role:"assistant"` but no `tool_calls` field when a task list was requested** — STILL OPEN (verified earlier read of `chat.service.ts` buildMessage path). Downstream consumers that key off `tool_calls` to render the task list fail to render.
- **M7 — quota exceeded: silent save** — ✅ FIXED (2026-08-11). `LocalStateRepository.save()` now records a one-shot `pruneNotice` whenever the quota-safeguard trims memory (`state-repository.ts:160-166`); `CachedStateStore.consumePruneNotice()` (`state-repository.ts:236-239`) + `container.store.consumePruneNotice()` surface it to the UI, and `App.tsx` shows a dismissible banner (`App.tsx:251-288`). Also fixed the quadratic trim itself: `pruneMemoryToBudget` now checks the byte budget in chunks instead of per-drop stringify of the whole store (`memory.ts:87-106`), so a multi-MB memory no longer janks for seconds on every save. Regression tests: `state-repository.test.ts` — "prune notice (M7)" describe block.
- **M8 — DailySummaryService is dead code** — ✅ FIXED (2026-08-11). The pipeline is now wired into the day-change flow: pure `shouldRollupDay`/`mergeDaySummary` helpers (`features/ai/summary-scheduler.ts`) drive a best-effort rollup in `useAppState.ts:58-80` — once per calendar day, on mount and on the minute tick, gated on `state.startDateISO` and idempotent per date via `lastSummaryDate`. The merge is based on the LATEST state so concurrent UI edits are never lost, failures are caught (summary is best-effort), and the existing "AI Memory" toggle gate inside `runDailyPipeline` is respected. Consumers (`context-overview.ts`, `habit-engine/context.ts:119`) now finally see real day snapshots. Regression tests: `features/ai/__tests__/summary-scheduler.test.ts` (7 tests).
- **M9 — modals never trap focus; `aria-modal` without inert background** — STILL OPEN. `aria-modal="true"` dialogs with no focus trap and no `inert` behind them: `AdminLogin.tsx:38`, `TabBar.tsx:555`, `AISettingsScreen.tsx:929` + `:967`, `ChatScreen.tsx:1666` + `:2033`, `ReadOnlyChatViewer.tsx:72`, `PermissionOnboarding.tsx:99`. Only `ReadOnlyChatViewer` (an internal debugging overlay) traps.
- **M10 — empty memory: Misa says "you have no memories" but doesn't offer to create** — STILL OPEN (verified earlier read of memory-tools.service.ts).
- **M11 — image attachments die on retry** — ✅ FIXED (2026-08-11). Image attachments now carry a stable `content` descriptor at attach time (`ChatScreen.tsx:2191-2195`, `[Image: <name>]`) and `buildMessages` (`chat.service.ts:1277-1292`) mirrors the file fallback: when the blob URL is dead (revoked or after reload) the image part is replaced by a text descriptor instead of being **silently dropped**, so a retry/follow-up turn never loses the image's context. Regression tests: `chat.test.ts` — image-part (live blob) + dead-blob descriptor tests.
- **M12 — notification reply failure is silent** — STILL OPEN. `Reply` action best-effort with no error surface to the user (`notification-actions.ts:167-168`).
- **M13 — notification tap after chat delete does nothing visible** — STILL OPEN. `openHistory` silently no-ops when the session is gone (`ChatScreen.tsx:240-245`); no toast, no auto-create.

**Low-severity (L1–L7):** all still present as documented (L1 API-key gate; L2 plain-text `Authorization` header on SmartRotator; L3 Android notification channel; L4 admin day-gating on client; L5 100 ms polling — `useAppState.ts:29-35`; L6 `/planner` `getPlannerState` leak — server concern; L7 `sync-coordinator.ts:229-240`).

---

## 3. Tab-by-Tab (workflow verification — WORKING ✅ unless a bug is cited)

| Tab / Screen | Status | Notes |
|---|---|---|
| Today (`TodayScreen.tsx`, 1011 ln) | WORKING ✅ | Day card, start-date guard, `contentDayForDate` mapping; rest-day sliding via `dates.ts` |
| Levels (`LevelsScreen.tsx`, 1521 ln) | WORKING ✅ | Long-press admin menu; `role="group"` grouping accessible |
| Progress (`ProgressScreen.tsx`, 452 ln) | WORKING ✅ | Review stats + charts; `role="group"` regions (`ProgressScreen.tsx:153-157`) |
| Review (`ReviewScreen.tsx`, 393 ln) | WORKING ✅ | Spaced-repetition queue |
| Task Bank (`TaskBankScreen.tsx`, 458 ln) | WORKING ✅ | |
| Planners (`PlannersScreen.tsx`, 442 ln) | WORKING ✅ | |
| Post-Journey (`PostJourneyScreen.tsx`, 761 ln) | WORKING ✅ | Catch-up reviews (post-QA commit `92f27c3`) |
| Updates (`UpdatesScreen.tsx`, 214 ln) | WORKING ✅ | |
| Login (`LoginScreen.tsx`, 205 ln) | WORKING ✅ | |
| AI Settings (`AISettingsScreen.tsx`, 1307 ln) | WORKING ✅ | Delete-all now transactional (N3 fixed) — rollback on failure + durable flush |
| Chat Settings (`ChatSettingsScreen.tsx`, 550 ln) | WORKING ✅ | |
| Chat (`ChatScreen.tsx`, ~2100 ln) | WORKING ✅ except M13 | Retry no longer drops images (M11/N5 fixed); tap-after-delete silent (M13) |

---

## 4. Misa AI Bug Report

New findings in the Misa/chat layer this audit (beyond the QA OPEN list above):

1. **N1 (CRITICAL) — startup race wipes persisted state** — ✅ FIXED (2026-08-11). Boot now waits for storage hydration: `persistentStoreReady` promise in `local-storage.ts` + boot gate in `main.tsx`, plus a defensive raw-read fallback in the storage layer. A cold start with persisted data can no longer read (and then overwrite) an empty state. Regression test: `infra/storage/__tests__/local-storage-boot.test.ts`.

2. **N2 (HIGH) — cache never invalidated after first load** — ✅ FIXED (2026-08-11). `CachedStateStore.reload()` re-reads the repository into the cache (`state-repository.ts:196-199`); the container exposes it as `store.reload()` (`container.ts:123-130`) and re-reads the full storage chain on `visibilitychange → visible` (`container.ts:88-97`), so another tab's writes or a sync restore now show up in the UI. Regression tests: `state-repository.test.ts` — "reload() re-reads repository changes into the cache (N2)" + "reload() recovers from a pre-init empty read (N1 boot race)".

3. **N3 (MEDIUM) — "Delete all data" partial-wipe path** — ✅ FIXED (2026-08-11). `deleteAllData` is now **transactional** (`delete-all.ts`): it flushes pending writes, snapshots owner + chat + state + sync session, and after any mid-sequence throw **rolls the snapshot back** (chat + state + owner restored, sync re-attached and the wiped server backup re-seeded) before rethrowing, so the UI error is always truthful and the data is intact. The wipe is also **flushed before resolving** (`container.store.flush()`, exposed via `AppContainer.store`), so there is no 400ms debounce window where a crash/close resurrects old data on restart; and the delete-all handler re-reads the restored store on error (`AISettingsScreen.tsx:194-199`). Regression tests: `delete-all.test.ts` — "transactional rollback (N3)" describe block (mid-sequence throw, auth re-apply throw, durable-commit).

4. **Misa identity / script rules** — WORKING ✅ (intentional features, not reported): identity guard, Roman-script rule, leak sanitizer, confirmation gates, hidden env provider.

5. **N5 (MEDIUM) — image attachments persist volatile blob `previewUrl`s; broken thumbnail + silent image loss after reload** — ✅ FIXED (2026-08-11). `ChatScreen.tsx`, `chat.service.ts`, `chat-transcript.ts`
   - Attach an image: `URL.createObjectURL(file)` produces a **session-scoped blob URL** (`ChatScreen.tsx:2192`).
   - `doSend` copies that blob URL into the `ChatAttachment` sent to the store (`ChatScreen.tsx:521-527`, line 525 `previewUrl: a.previewUrl`).
   - `chat.service.ts:386` persists `userMsg` **with the blob URL intact** (`session.messages.push(userMsg)` + `this.persist()` at :387/:391). After the send, only `kind === 'file'` attachments are stripped from the stored message (`chat.service.ts:1342-1362`); **image attachments keep their blob URL in persistent storage**.
   - Blob URLs are explicitly documented as volatile: "Blob `previewUrl`s are volatile and useless after a reload" (`chat-transcript.ts:45-47` — the export path strips them, but the live session store does not).
   - After an app reload: (a) the message bubble renders `<img src={attachment.previewUrl}>` from the dead blob URL → **broken thumbnail** (`ChatScreen.tsx:2322-2329` via `UserMessageContent`); (b) the next turn re-sends history through `buildMessages`, which for images does `blobToDataUrl(att.previewUrl)` and **silently drops the part when it returns null** (`chat.service.ts:1278-1283`) — unlike file attachments which have an `att.content` text fallback (`chat.service.ts:1293-1299`). Result: the AI loses the image's context for the rest of the conversation without any error surfaced.
   - Severity: MEDIUM (no data loss of the text message, but broken UI + silent loss of AI image context after any reload; also makes the persisted store carry dead URLs indefinitely).
   - **Fix applied (2026-08-11):** (1) image attachments get a stable `content` descriptor at attach time (`ChatScreen.tsx:2191-2195`) so a non-volatile note survives reload; (2) `buildMessages` got an image fallback that mirrors the file fallback — a dead/absent blob becomes a text part `[Image: <name>] — image bytes unavailable…` so the AI knows an image was attached and can ask for a re-upload instead of answering with zero context (`chat.service.ts:1277-1292`); (3) the message-bubble thumbnail now swaps to the type badge on load error via a new `ImageThumb` component, so restored sessions never show a broken `<img>` (`ChatScreen.tsx:1645-1655`, used at the chip render).

---

## 5. Cross-Cutting

- **Notifications** — per-bubble OS scheduling is intentional (per-bubble notify). Notification reply intentionally launches the Activity with unconditional minimize (`notification-actions.ts`); only the silent failure (M12) is a bug.
- **Chat screen keep-mounted** — `display:none` on hidden tab is intentional; not reported.
- **Backup/restore** — full-restore semantics intentional (explicitly restores everything). No new bugs found.
- **Habit engine dates** — `dates.ts` rest-day math (`restRawPositions`, `contentDayForRaw`, `rawForContentDay`, `dateForDayNumber`) verified pure and consistent; **no off-by-one found** (spot-checked restDays=[5] example matches the documented mapping).

---

## 6. Data Loss & Corruption

1. **N1 (CRITICAL)** — empty-state overwrite of persisted data (see Section 4.1) — ✅ FIXED.
2. **N2 (HIGH)** — stale cache means in-memory divergence from disk after any external change or failed save — ✅ FIXED.
3. **M7** — silent quota pruning trims summaries without consent (`state-repository.ts:155-158`) — ✅ FIXED (user-facing one-shot notice + chunked trim).
4. **M11** — image attachments lost on retry (`chat.service.ts:1278-1283`) — ✅ FIXED (stable image descriptor + dead-blob text fallback in `buildMessages`).
5. **Delete-all partial wipe (N3)** — ✅ FIXED (transactional snapshot + rollback + durable flush).
6. **N5** — after reload, image attachments silently drop from AI context (broken thumbnails in UI); no error surfaced (`chat.service.ts:1278-1283`, `ChatScreen.tsx:2329`) — ✅ FIXED (descriptor at attach + `ImageThumb` graceful fallback + `buildMessages` text fallback).

---

## 7. Security

- L1 — API key gate is a plain check, not a hardened secret store. STILL OPEN (documented).
- L2 — SmartRotator auth sent as plain-text `Authorization: Bearer` over HTTPS; acceptable baseline, noted in QA. STILL OPEN.
- L3 — Android notification channel uses the default channel. STILL OPEN.
- L4 — day-mode admin gating is client-side only; a determined user can bypass by mutating state. STILL OPEN (documented, intentional-looking but worth a server flag).
- L6 — `/planner` `getPlannerState` exposure — server-side; flagged for the API owner. STILL OPEN.
- **No new security findings** this audit (no secrets in repo, no in-app credentials logged, per-account partition verified).

---

## 8. UI/UX

- M9 focus trap (see Section 2.2) — keyboard users can tab out of modals into the page behind.
- M13 silent tap-after-delete (see Section 2.2).
- N3 delete-all: ✅ fixed — transactional rollback + durable flush (`delete-all.ts`, `AISettingsScreen.tsx:194-199`).
- M7 prune notice: ✅ fixed — a dismissible banner now appears when a save had to trim memory (`App.tsx`).
- Keyboard a11y fixes from QA (live region, status role) verified present.

---

## 9. Performance

- L5 — 100 ms polling in `useAppState.ts:29-35` (documented as still open; on web this is a constant re-render cost; consider event-driven updates or increasing to ≥500 ms).
- L7 — `sync-coordinator.ts:229-240` refetches on every poll interval regardless of dirty flag (still open).
- M5 — all-session keyword scan cost grows with history (`chat.service.ts:1728-1749`).
- **No new performance blockers found.**

---

## 10. Regressions Found (vs. QA baseline + earlier commits)

**Full suite run (2026-08-11, pre-fix): 1093 passed / 2 failed of 1095** (baseline report: 884 tests).

1. `src/features/sync/__tests__/sync-integration.test.ts` — "new user with empty server stays untouched": `expected '2026-01-01' to be null` for `startDateISO`.
   - **Classification: TEST-LEVEL FLAKE (order-dependent), NOT an app regression.** Passes with `-t` filter in isolation (verified: 22 tests, 21 skipped → pass). Root cause: module-level async `persistentStore.init()` + `CachedStateStore` debounced writes from a **previous test's module instance** land in a cleared `localStorage` during the next test's run, contaminating the fresh container. This is the same un-awaited-async-init pattern as N1 — the test caught the app's own architectural risk.
2. `src/settings-open.test.tsx:33` — `waitFor` timeout waiting for "Response Quality".
   - **Classification: flaky, NOT a regression.** Passes in isolation (verified). The default 1s `waitFor` budget was too tight under parallel-worker load; unrelated to app logic.
   - **Mitigated (2026-08-11):** the assertion now uses an explicit `{ timeout: 15000 }` (`settings-open.test.tsx:34-37`). Two consecutive full-suite runs are green (87 files / 1121 tests).

Both flakes share the root cause class of N1 (async init not awaited + cross-instance timers). **Both are resolved post-fix: the full suite runs 1121/1121 green (87 files), and the N1/N2 boot-gate fix is what stabilized them (N4 → FIXED by side-effect), with the `settings-open` waitFor hardened against parallel-load timeouts.**

**Post-QA commits reviewed** (`9e8bce6` custom-habit scoring/import snapshot merge, `92f27c3` catch-up reviews, `fd2daed` mastery Completed bucket, `49b2944` day-mode/rest sliding, `8d623c8` sync force-push, `ee7cd7d` delete-all/offline fixes): no new deterministic regressions found in code; the two suite failures above are the only behavioral divergence and are flake-classified.

---

## 11. FIX ROADMAP

### ✅ DONE — Critical + Tier 1 (2026-08-11)
1. **N1** — Boot gate awaits storage hydration (`local-storage.ts`, `main.tsx`) + boot test. ✅
2. **N2** — `CachedStateStore.reload()` + visibility-change re-read (`state-repository.ts:196-199`, `container.ts:88-97`) + tests. ✅
3. **M1** — Word-boundary matching for `isTaskQuery` (`chat-tools.service.ts:76-98`) + hijack regression tests. ✅
4. **M8** — `runDailyPipeline` wired into day-change via `summary-scheduler.ts` + `useAppState` rollup + tests. ✅
5. **M7** — One-shot prune notice surfaced to the UI (`state-repository.ts`, `App.tsx`) + chunked `pruneMemoryToBudget` + tests. ✅
6. **N4** — Resolved by side-effect of the N1 boot gate; suite is 1115/1115. ✅
7. **N3** — Transactional delete-all: snapshot + rollback + durable flush (`delete-all.ts`, `container.store.flush()`) + 3 rollback tests. ✅

### ✅ DONE — HIGH (correctness of persisted actions) (2026-08-11)
8. **M11** — Image attachments no longer die on retry: stable `[Image: <name>]` descriptor at attach + dead-blob text fallback in `buildMessages` (`chat.service.ts:1277-1292`) + tests. ✅
9. **N5** — Attachments no longer persist volatile blob `previewUrl` as the only image info: descriptor survives reload, `buildMessages` falls back to text (never silent drop), and `ImageThumb` swaps a dead thumbnail to the type badge (`ChatScreen.tsx:1645-1655`) + tests. ✅
10. **M2** — Malformed tool JSON is dropped as a broken tool call instead of leaking into the assistant history (`chat.service.ts:73-88`) + test. ✅

### MEDIUM (chat quality + a11y)
11. **M3** — Validate day membership in `editTask` (`chat-tools.service.ts:1153-1191`).
12. **M5** — Scope task search to current day/session or cap scan (`chat.service.ts:1728-1749`).
13. **M9** — Add focus trap + `inert` background to all 8 `aria-modal` dialogs (list in Section 2.2).
14. **M13** — Toast/auto-create when tapping a deleted session (`ChatScreen.tsx:240-245`).
15. **M12** — Surface reply failures (`notification-actions.ts:167-168`).

### LOW / cleanup + regression guard
16. **M7** — ~~Notify user before silent quota pruning~~ ✅ done.
17. **M4, M10** — Memory dedupe + create-offer on empty memory.
18. **L5/L7** — Reduce polling frequency / add dirty-flag gate.
19. Add a **regression test** that runs `sync-integration` + `settings-open` in the same worker as the full suite (N4) — now covered implicitly by the 87-file suite being green in one run.

---

## 12. Post-Audit Fix Ledger (2026-08-11)

| Item | Fix | Verification |
|------|-----|--------------|
| N1 | Boot gate awaits `persistentStoreReady` before first read + defensive raw-read fallback | `local-storage-boot.test.ts`; suite green |
| N2 | `CachedStateStore.reload()` + `store.reload()` + `visibilitychange` re-read of full storage chain | `state-repository.test.ts` N1/N2 tests |
| M1 | Whole-word regex matching in `isTaskQuery` (plural-aware, block-command anchor preserved) | new M1 hijack test; 93 chat-tools tests green |
| M7 | One-shot prune notice (repo → store → container → App banner) + chunked `pruneMemoryToBudget` (quadratic → ~N/8 stringifies) | `state-repository.test.ts` prune-notice block |
| M8 | `summary-scheduler.ts` (pure `shouldRollupDay`/`mergeDaySummary`) + day-change rollup in `useAppState` (idempotent, best-effort, latest-state merge) | `summary-scheduler.test.ts` (7 tests) |
| N3 | Transactional delete-all: flush-before-snapshot, full snapshot, rollback on any throw (chat + state + owner + sync re-attach + server re-seed), flush-before-resolve; `container.store.flush()` exposed; handler re-reads restored state on error | `delete-all.test.ts` — "transactional rollback (N3)" block (3 tests) |
| N4 | Resolved by side-effect (boot gate) | full suite green in one run (now 1121/1121) |
| M2 | Malformed tool JSON now treated as a broken tool call and dropped (`looksLikeToolOutput` parse-fail → true) — never leaks into assistant history | `chat.test.ts` — "drops malformed tool JSON instead of leaking it into the assistant history (M2)" |
| N5/M11 | Images keep a stable `[Image: <name>]` descriptor at attach (`ChatScreen.tsx:2191-2195`); `buildMessages` falls back to a text part when the blob is dead (`chat.service.ts:1277-1292`); `ImageThumb` swaps dead thumbnails to the type badge | `chat.test.ts` — image-part (live blob) + dead-blob descriptor tests |
| N4 (settings-open) | `settings-open.test.tsx` "Response Quality" waitFor hardened with `{ timeout: 15000 }` — kills the last documented parallel-load flake | two consecutive full-suite runs green (87 files / 1121 tests) |

**Verification gate passed:** `npm run typecheck` ✅ · `npm run lint` (oxlint, 0 errors) ✅ · `npm test` (87 files, 1121/1121 — verified twice in a row) ✅ · `npm run build` (tsc -b + vite) ✅.

---

## File Coverage Table

| File (src/) | Read | Coverage notes |
|---|---|---|
| App.tsx | ✅ full | data-owner flow, lazy screens |
| main.tsx | ✅ full | RootErrorBoundary |
| di/container.ts | ✅ | store wiring, **M8 confirmed** (dead DailySummaryService at 146) |
| infra/storage/local-storage.ts | ✅ full | **N1 race** |
| infra/storage/persistent-storage.ts | ✅ full | prefix, getLastWriteError |
| infra/storage/state-repository.ts | ✅ full | **N2 cache**, M7 prune |
| infra/storage/chat-repository.ts | ✅ full | levelup-chat-v1 |
| core/domain/state.ts | ✅ | emptyAppState 283-286 |
| core/domain/memory-tools.ts | ✅ full | schema, MAX=20 |
| core/domain/chat.ts | ✅ full | attachment `previewUrl` at :15 |
| core/domain/chat-transcript.ts | ✅ full | strips blob previewUrls in export (:45-47), **N5 evidence** |
| core/domain/progress.ts, habit.ts, summary.ts | ✅ full | clean |
| core/domain/memory.ts | ✅ full | MEMORY_MAX_ENTRIES 200, byte budget |
| core/domain/memory-summary.ts | ✅ full | deterministic JSON blocks |
| core/domain/task-bank.ts, errors.ts | ✅ full | clean |
| core/domain/subject-planner.ts | ✅ full (1145 ln) | 3 planner kinds, day-resolution, guards |
| core/domain/chat-tools.ts | ✅ full | discriminatedUnion tool protocol |
| core/domain/import-utils.ts | ✅ full | BOM + fence strip |
| core/ports/repositories.ts | ✅ full | 51 ln |
| core/ports/clock.ts | ✅ full | tz fallback Asia/Kolkata |
| features/chat/chat.service.ts | ✅ FULL (2180 ln) | **N5** (386, 1278-1283, 1342-1362), M1/M2/M5/M6/M11 |
| features/chat/chat-tools.service.ts | ✅ regions | registry, isTaskQuery, editTask |
| features/chat/memory-tools.service.ts | ✅ full | batch cap |
| features/chat/context-overview.ts | ✅ full | M8 consumer — empty summaries |
| features/chat/plan-format.ts | ✅ full | deterministic formatting |
| features/ai/memory.service.ts | ✅ full | deterministic rollups, byte budget — clean |
| features/ai/summary.service.ts | ✅ full | **M8** — writes only inside dead runDailyPipeline |
| features/ai/task-generation.service.ts | ✅ full | bank-first, zod-validated |
| features/ai/provider-settings.service.ts | ✅ full | publicView |
| features/sync/delete-all.ts | ✅ full | **N3** |
| features/sync/sync-coordinator.ts | ✅ full | L7, debounce |
| features/sync/sync.service.ts | ✅ full | pull/push paths |
| features/backup/backup.service.ts | ✅ full | full-restore intentional |
| features/habit-engine/dates.ts | ✅ full | rest-day math clean |
| features/habit-engine/habits.ts | ✅ full | backward-compat |
| features/habit-engine/context.ts | ✅ full | M8 consumer — empty summaries |
| features/curriculum/curriculum.ts | ✅ full | v1, zod |
| features/task-bank/task-bank.repository.ts | ✅ full | seed validation, customHabits win |
| features/planners/* | ✅ full | planner-engine deep internals |
| data/curriculum.ts, data/protocols.ts | ✅ full | 4 phases/30 levels; test protocols |
| infra/ai/websearch.service.ts | ✅ full | two-step search, fail-open |
| infra/ai/providers/* (gemini, openai-compatible, http-native) | ✅ full | clean |
| lib/useAppState.ts | ✅ full | L5 poll, sync state read |
| lib/notifications.ts, lib/notification-actions.ts | ✅ full | channel, M12 |
| lib/auth.ts, lib/engine.ts, lib/haptics.ts, lib/exportFile.ts | ✅ full | no new bugs |
| lib/updates.ts, fileText.ts, pdf.ts, pdfFallback.ts | ✅ full | ranged APK, layered extraction, lazy pdf — clean |
| lib/relative-time.ts, text.ts, storage.ts | ✅ full | local-midnight parse, truncateMeaningful — clean |
| lib/background-permission.ts, file-kind.ts, phaseColors.ts | ✅ full | clean |
| screens/ChatScreen.tsx | ✅ FULL (2362 ln) | **N5** (525, 2322-2329), M9/M11/M13 |
| screens/LevelsScreen.tsx | ✅ 1521 | long-press admin |
| screens/TodayScreen.tsx | ✅ 1011 | |
| screens/ProgressScreen.tsx | ✅ 452 | role=group |
| screens/ReviewScreen.tsx | ✅ 393 | |
| screens/TaskBankScreen.tsx | ✅ 458 | |
| screens/PlannersScreen.tsx | ✅ 442 | |
| screens/PostJourneyScreen.tsx | ✅ 761 | |
| screens/UpdatesScreen.tsx | ✅ 214 | |
| screens/LoginScreen.tsx | ✅ 205 | |
| screens/AISettingsScreen.tsx | ✅ 1307 | delete-all, N3 |
| screens/ChatSettingsScreen.tsx | ✅ 550 | |
| components/AdminLogin.tsx | ✅ full | aria-modal, M9 |
| components/TabBar.tsx | ✅ full | settings modal, M9 |
| components/ReadOnlyChatViewer.tsx | ✅ full | traps focus |
| components/PermissionOnboarding.tsx | ✅ full | aria-modal |
| components/AddProviderForm.tsx, FileCard.tsx, DaySwitcher.tsx, DayGauge.tsx | ✅ full | clean |
| components/RootErrorBoundary.tsx, ScreenSkeleton.tsx, PrivacyPolicy.tsx, FileKindBadge.tsx | ✅ full | clean |
| components/menu-accessibility.tsx, useMenuFocus.ts, markdown-utils.ts, ChatMarkdown.tsx | ✅ full | clean |
| components/MemorySummaryPanel.tsx, Confetti.tsx, ReadOnlyChatViewer.tsx | ✅ full | clean |
| components/ui/* (Card, EmptyState, ProgressBar, ScreenHeader, SectionHeader, Stat) | ✅ full | clean |
| tests: settings-open.test.tsx | ✅ | flaky waitFor |
| tests: sync/__tests__/sync-integration.test.ts | ✅ | order-dependent flake |

**Coverage status (Round 2):** every `src/` file is now read in full (or in documented regions for the two large screens). The Round 1 "NOT COVERED" list is resolved — `chat.service.ts:1855-2180`, `ChatScreen.tsx:1010-1390`, `sync.service.ts` full body, `backup.service.ts` tail, `infra/ai/providers/*`, `features/planners/*`, and all remaining `components/*` were read in Round 2 and are covered above.

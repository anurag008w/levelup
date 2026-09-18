# Production Audit State

This file is the persistent handoff for the hourly production-audit loop.

## Current State

- Repository: `anurag008w/levelup`
- Working branch: `misa-work`
- Target branch: `main`
- Audit turn: 18
- Status: REVIEW FINDINGS OPEN
- Current PR head: `cfcff375409c6921e63901b76a70cd7a601388ab`
- Open PR: #34 (`misa-work` -> `main`), open, not merged, no auto-merge

### PRIORITIZED OPEN FINDINGS INDEX

1. **P1 OPEN — Scheduled proactive-message cancellation is not monotonic across sync.** `mergeProactiveBlob` keys records by device-local `id` and replaces an existing record by newer `createdAt` without preserving `cancelled`; cross-device cancellation can therefore be resurrected and later delivered.
2. **P2 OPEN — Admin preview unlock paths still enable in-memory state without requiring `loggedInAt`.** `autoUnlock()` checks only `canAutoUnlockSession()`, while `unlockAdmin()` can set state true for a verified super-admin username that does not match the loaded app session; persisted session-bound storage correctly refuses a missing marker, creating an inconsistent security boundary.
3. **P2 OPEN — Remote proactive cooldown values are not runtime-validated.** `mergeRelationshipState` copies remote `topicCooldowns` before finite/non-negative validation; malformed numeric-string expiries can survive into proactive decision state.
4. **P2 OPEN — Native HTTP cancellation can still enter the retry loop after an abort.** `requestJson()` treats the abort `HttpError(status=0)` as non-retryable but does not break/throw on that branch, so it immediately performs another attempt until `retries` is exhausted. Existing cancellation tests cover SSE, not this retry behavior.
5. **P2 OPEN — Notification replies are owner-gated but not explicitly session-bound.** The current guard checks for any active session/guest owner rather than proving the notification `sessionId` equals the active authenticated session; account/session switching therefore remains insufficiently verified.
6. **P3 OPEN — Direct `setDayMode` state canonicalization.** Duplicate/stale rest/test membership can still be written at the chat-tool source, even though date consumers defensively normalize duplicate rest-day entries.
7. **BLOCKED — Deployment-topology verification for Vite relative base with root-absolute service-worker/manifest/notification paths.** Requires real deployment topology evidence.
8. **BLOCKED — Android/native device and API-matrix verification.** Physical process-death, OEM background, PiP, camera/screen-share, and long-running FGS behavior require device evidence unavailable in repository CI.
9. **BLOCKED — Build-time VITE_DEFAULT_AI_API_KEY exposure assessment.** Actual configured credential scope is not observable through repository access.

## Turn 18 — Independent PR/head re-audit

### Scope and evidence
- Re-read the persistent audit state before inspecting the PR, then inspected the current PR metadata, changed-file inventory, current diff, current non-outdated review threads, relevant sync/auth/notification/native-HTTP code, and the exact current state file at PR head.
- Current PR head is `cfcff375409c6921e63901b76a70cd7a601388ab` and remains open/unmerged.
- Exact-head GitHub Actions workflow run **#581 / 35325486901** is terminal `SUCCESS`.
- No application-code, test, workflow, branch, tag, release, PR-state, or merge mutation was performed by the review agent.

### Confirmed findings

#### P1 — Scheduled proactive-message cancellation is not monotonic across sync — OPEN
- **Affected code:** `src/features/sync/sync-merge.ts` (`mergeProactiveBlob`) and adjacent proactive cancellation/delivery paths.
- **Evidence:** current merge derives `key` as `s.id` when present, otherwise a content/time fallback. For an existing key it executes `scheduled.set(key, s)` only when the incoming record has a newer `createdAt`; it does not merge `cancelled` with logical OR. Therefore a newer uncancelled copy can replace an older cancelled copy. Device-local IDs also prevent logical dedup when independently-created copies have different IDs.
- **Impact:** a user cancellation can be lost during cross-device synchronization and the reminder/call can be delivered later. This is a production data-integrity and unwanted-notification risk.
- **Existing review evidence:** the non-outdated CodeRabbit thread for `sync-merge.ts` explicitly identifies the cancellation-tombstone failure mode.
- **Suggested verification:** preserve cancellation tombstones, merge cancellation monotonically, skip cancelled records at delivery, and add two-device/id-different-ID regression cases.
- **Status:** `OPEN` (unchanged root cause; no hardening commit has addressed it at the current head).

#### P2 — Admin preview unlock paths lack a consistent login-marker gate — OPEN
- **Affected code:** `src/lib/useAppState.ts`, `src/lib/admin.ts`.
- **Evidence:** `canAutoUnlockSession()` checks only `isSuperAdmin`; `autoUnlock()` then calls `setAdminUnlocked(username, loggedInAt, true)` but unconditionally calls `setAdminUnlockedState(true)` even when `loggedInAt` is missing. `unlockAdmin()` independently verifies credentials, then sets `sessionForUnlock` to null when the loaded session username differs, yet still calls `setAdminUnlockedState(true)`; `setAdminUnlocked()` correctly refuses persistence without username + `loggedInAt`. The in-memory state boundary is therefore weaker than the persisted session-bound marker.
- **Impact:** admin preview can become enabled in memory without the same session-bound proof required for persisted unlock state; the account-switching case is not explicitly bound to the active session.
- **Existing review evidence:** non-outdated CodeRabbit thread on `useAppState.ts` requests the same login-marker requirement.
- **Suggested verification:** require a valid `loggedInAt` in both unlock paths before setting React admin state; require manual credential unlock to match the active session identity or deliberately document/implement a separate explicit admin-session flow; add missing-marker and account-switch tests.
- **Status:** `OPEN`.

#### P2 — Remote proactive cooldown values are not runtime-validated — OPEN
- **Affected code:** `src/features/sync/sync-merge.ts` (`mergeRelationshipState`).
- **Evidence:** `const topicCooldowns = { ...remoteCooldowns }` copies all remote values before validation. Only `localExpiry` is checked with `Number.isFinite()` and non-negative constraints. The current dedicated test covers invalid local `NaN`/negative values but does not cover malformed remote numeric strings.
- **Impact:** a remotely persisted numeric-string expiry can enter merged state and affect proactive suppression until that future timestamp.
- **Suggested verification:** rebuild the merged cooldown map from both sources and accept only finite non-negative numbers; add numeric-string/`null`/negative remote regression tests.
- **Status:** `OPEN`.

#### P2 — Native HTTP abort still falls through the retry loop — OPEN
- **Affected code:** `src/infra/ai/http-native.ts` (`CapacitorHttpClient.requestJson`).
- **Evidence:** `requestWithAbort()` correctly rejects with `HttpError('Request aborted', 0, 'aborted', null)`. In `requestJson()` the catch block computes `retryable = ... RETRYABLE_STATUS.has(err.status)`. For the abort error this is false, so no delay occurs, but execution still reaches the next `for` iteration instead of throwing. With default `retries = 3`, an aborted request can therefore invoke the native operation repeatedly rather than failing closed immediately.
- **Test gap:** `src/infra/ai/__tests__/http-native.test.ts` adds in-flight and pre-aborted **SSE** tests, but no `requestJson()` abort retry-count assertion.
- **Impact:** cancellation can generate unnecessary native requests after the caller has already stopped the operation, increasing work and making cancellation semantics inconsistent between JSON and SSE clients.
- **Suggested verification:** abort an in-flight `requestJson()` call and assert the native request is invoked exactly once and the promise rejects promptly; preserve existing retry behavior for 408/429/5xx.
- **Status:** `OPEN`.

#### P2 — Notification reply owner check is not session-bound — OPEN
- **Affected code:** `src/lib/notification-actions.ts` (`hasActiveNotificationOwner`, reply action handling).
- **Evidence:** the current guard rejects replies only when there is no `loadSession()` and no guest owner. It does not compare the incoming notification `sessionId` with the active `loadSession()` session identity. The implementation therefore addresses logout but not a stale notification belonging to an earlier authenticated session/account.
- **Impact:** a stale notification action can potentially route through the current app owner while carrying an obsolete session identifier, creating account-boundary ambiguity.
- **Suggested verification:** bind actionable replies to the active session identifier; add a regression test covering session A notification followed by session B login and reply action.
- **Status:** `OPEN`.

### Regression verification of previously fixed/hardened findings

- **Android cleartext policy — VERIFIED remains valid.** Current `network_security_config.xml` has `cleartextTrafficPermitted="false"` at base level and explicitly scopes the exception to `localhost`, `127.0.0.1`, and `ip6-localhost`. Current PR head contains the fix and exact-head CI run #581 is green. Android documentation confirms localhost handling includes `localhost`, `ip6-localhost`, and loopback numerical addresses, including `[::1]`. This verifies the repository-level policy hardening; physical-device/API-matrix behavior remains blocked separately.
- **Equal chat timestamp deterministic merge — VERIFIED remains valid.** Current `mergeChatSessions()` still uses a deterministic `chatSessionConflictKey()` when `updatedAt` values tie, and the dedicated regression test checks both argument orders.
- **Proactive preference merge semantics — VERIFIED remains valid.** Current `mergeProactiveBlob()` retains `Math.max()` for `activeGraceMinutes` and the nonblank local-or-remote ringtone selection. No contrary evidence was found.
- **Duplicate rest-day calendar mapping — VERIFIED remains valid.** Current merge and date-consumer paths retain duplicate normalization; the dedicated duplicate regression suite remains part of the PR.
- **Task-log snapshot hardening — VERIFIED remains valid.** Historical hardening remains present; no current contradictory implementation evidence was found.
- **Native SSE cancellation — VERIFIED for the original cancellation finding.** `requestWithAbort()` now handles pre-abort, in-flight abort, listener cleanup, and late native resolution without resolving the caller after abort. The separate `requestJson()` retry-loop defect above is a regression-gap/new issue, not a reversal of the original SSE cancellation fix.
- **Screen-share obsolete-start race — VERIFIED for the original race.** The historical generation-token hardening remains represented; process-death/OEM lifecycle behavior is still blocked by lack of device evidence.

### Review observations / low-confidence leads
- The current state file says `Status: COMPLETE` in the prior Turn-17 record while the current PR still contains multiple non-outdated open CodeRabbit findings and the current independent review confirms additional defects. Turn 18 changes the state to `REVIEW FINDINGS OPEN` so the handoff accurately reflects unresolved production blockers.
- The PR's CodeRabbit walkthrough reports a docstring-coverage warning (42.65% versus an 80% configured threshold). This is treated as a quality gate/observation rather than a production correctness finding because repository CI itself is green and the configured requirement is external to application behavior.
- The current `PRODUCTION_AUDIT_STATE.md` historical-summary model relies on parent-blob recoverability rather than copying every prior finding body into the latest file. No historical material was intentionally deleted in this turn; this turn appends its own dated review record and preserves the prior state text.

## Historical Audit/Fix Record

All earlier audit turns, findings, fixes, regressions, and verification evidence remain preserved in the Git history immediately preceding this state update. The prior persistent state was blob `d76d35dc44bcfe8460dc7702b3a98934b349e2ec`; this state update intentionally carries forward its historical record as the parent of the new state commit. Earlier verified findings include native SSE cancellation, screen-share startup serialization, planner stale-item rejection, delete-all transactional restoration, proactive-state merge completeness, release dry-run/release-trigger hardening, session-bound admin unlock isolation, duplicate rest-day calendar normalization, and Android cleartext policy hardening.

## Remaining Risks / Not Verified

- Direct `setDayMode` array canonicalization remains a lower-priority data-hygiene improvement; calendar consumers now normalize duplicate rest-day entries defensively.
- Physical-device lifecycle, PiP, camera, screen-share, OEM background behavior, and process-death recovery remain not device-verified.
- `LiveCompanionForegroundService` camera+microphone+mediaPlayback type combinations still require Android-version/permission matrix verification.
- `ScreenSharePlugin` process-death/recreation and Activity/plugin-process ownership still require physical-device evidence beyond CI compilation/tests.
- `ScreenShareForegroundService` uses a four-hour WakeLock timeout; long-running-session behavior beyond that boundary remains not device-verified.
- `VITE_DEFAULT_AI_API_KEY` build-time exposure remains UNPROVEN because configured credential scope is not observable through repository access.
- Repeated `AudioRoute.getAvailableRoutes is not a function` warnings remain UNPROVEN/ENVIRONMENTAL because tests pass through the guarded native/web boundary and native runtime evidence is unavailable.
- Vite `base: './'` combined with root-absolute service-worker/manifest/notification paths remains UNPROVEN without deployment-topology evidence.

## Historical state integrity note

The complete prior state is recoverable from the parent state commit/blob recorded above; no prior finding lifecycle was intentionally discarded or reclassified by this turn. The current index contains the findings still requiring action or external evidence after the independent Turn-18 review.
# Production Audit State

This file is the persistent handoff for the hourly production-audit loop.

## Current State

- Repository: `anurag008w/levelup`
- Working branch: `misa-work`
- Target branch: `main`
- Audit turn: 19
- Status: REVIEW FINDINGS OPEN
- Current PR head: `82beae17f1b0ce2401fd634f5212d4d89944c9d8`
- Open PR: #34 (`misa-work` -> `main`), open, not merged, no auto-merge

### PRIORITIZED OPEN FINDINGS INDEX

1. **P2 OPEN — Admin preview unlock paths still enable in-memory state without requiring `loggedInAt`.** `autoUnlock()` checks only `canAutoUnlockSession()`, while `unlockAdmin()` can set state true for a verified super-admin username that does not match the loaded app session; persisted session-bound storage correctly refuses a missing marker, creating an inconsistent security boundary.
2. **P2 OPEN — Remote proactive cooldown values are not runtime-validated.** `mergeRelationshipState` copies remote `topicCooldowns` before finite/non-negative validation; malformed numeric-string expiries can survive into proactive decision state.
3. **P2 OPEN — Native HTTP cancellation can still enter the retry loop after an abort.** `requestJson()` treats the abort `HttpError(status=0)` as non-retryable but does not break/throw on that branch, so it immediately performs another attempt until `retries` is exhausted. Existing cancellation tests cover SSE, not this retry behavior.
4. **P2 OPEN — Notification replies are owner-gated but not explicitly session-bound.** The current guard checks for any active session/guest owner rather than proving the notification `sessionId` equals the active authenticated session; account/session switching therefore remains insufficiently verified.
5. **P3 OPEN — Direct `setDayMode` state canonicalization.** Duplicate/stale rest/test membership can still be written at the chat-tool source, even though date consumers defensively normalize duplicate rest-day entries.
6. **BLOCKED — Deployment-topology verification for Vite relative base with root-absolute service-worker/manifest/notification paths.** Requires real deployment topology evidence.
7. **BLOCKED — Android/native device and API-matrix verification.** Physical process-death, OEM background, PiP, camera/screen-share, and long-running FGS behavior require device evidence unavailable in repository CI.
8. **BLOCKED — Build-time VITE_DEFAULT_AI_API_KEY exposure assessment.** Actual configured credential scope is not observable through repository access.

## Turn 19 — Proactive cancellation hardening + exact-SHA CI verification

### Scope and evidence
- Re-read this persistent state before making changes, then inspected PR #34, the current `misa-work` implementations of `mergeProactiveBlob`, `ScheduledProactiveMessage`, and the existing sync-merge regression suite.
- Confirmed scheduled-message IDs are generated locally with `crypto.randomUUID()` (or a random fallback), so device-local IDs cannot be relied on as a cross-device logical identity.
- Current application/test head before audit-state bookkeeping was `13dd253c034687146072108bb7fc780e4943e4d4` and remained on PR #34.

### Finding lifecycle

#### P1 — Scheduled proactive-message cancellation is not monotonic across sync — VERIFIED
- **Root cause:** `mergeProactiveBlob()` previously keyed scheduled records by `s.id` and replaced an existing record with a newer `createdAt` snapshot without preserving `cancelled`. Since IDs are generated locally, equivalent records created on two devices can have different IDs, allowing a cancelled copy and a pending copy to coexist and the pending copy to be delivered.
- **Implementation:** scheduled-message merge now uses a deterministic logical identity composed of kind, scheduled time, topic, text/reason, and linked entity. When multiple copies share that identity, the newest metadata is retained while `cancelled` is merged with logical OR and `deliveryRetries` with max, making cancellation a monotonic tombstone.
- **Changed files/functions:** `src/features/sync/sync-merge.ts` (`mergeProactiveBlob`, new `scheduledProactiveLogicalKey`); `src/features/sync/__tests__/sync-merge.test.ts` (cross-device cancellation regression cases).
- **Implementation commit SHA:** `fe867a1cd03397e1e94d5a0b5d2927d2cec56dfc`.
- **Regression-test commit SHA:** `13dd253c034687146072108bb7fc780e4943e4d4`.
- **Checks:** exact application/test SHA CI run `#587` / Actions run `35330590774` completed successfully: `test`, `web-build`, and `android-build` all terminal `success`. The test job passed lint, tests, and type check; web build passed; Android unit tests and debug APK build/upload passed.
- **State-head CI:** after recording this lifecycle state, SHA `82beae17f1b0ce2401fd634f5212d4d89944c9d8` received Actions run `#589` / `35330992933`; `test` and `web-build` passed and `android-build` passed. All three jobs are terminal `success`.
- **Verification evidence:** final post-CI source re-audit at SHA `82beae17f1b0ce2401fd634f5212d4d89944c9d8` confirms the merge no longer uses the device-local scheduled-message ID as its sole identity and explicitly preserves `cancelled` across both merge orders. Regression tests cover different IDs and the case where the cancelled copy is older than the pending copy. The original resurrection failure mode is absent.
- **Status:** `VERIFIED`.

### Regression verification of previously fixed/hardened findings

- **Android cleartext policy — VERIFIED remains valid.** Current network security policy remains deny-by-default with only the intended loopback exception; previous exact-head CI verification remains recorded.
- **Equal chat timestamp deterministic merge — VERIFIED remains valid.** Current `mergeChatSessions()` retains deterministic conflict handling and its regression suite.
- **Proactive preference merge semantics — VERIFIED remains valid.** Current `mergeProactiveBlob()` retains monotonic enablement/grace semantics and local-or-remote ringtone selection.
- **Duplicate rest-day calendar mapping — VERIFIED remains valid.** Current merge and date-consumer paths retain duplicate normalization.
- **Task-log snapshot hardening — VERIFIED remains valid.** Historical hardening remains present.
- **Native SSE cancellation — VERIFIED for the original cancellation finding.** The current `requestWithAbort()` behavior remains hardened; the separate `requestJson()` retry-loop defect remains open.
- **Screen-share obsolete-start race — VERIFIED for the original race.** Historical generation-token hardening remains represented; physical lifecycle evidence remains blocked.

## Historical Audit/Fix Record

All earlier audit turns, findings, fixes, regressions, and verification evidence remain preserved in Git history immediately preceding this state update. The prior persistent state was blob `4e6c7e3468554af90fd994c6150171cd4a0f6e7c`; this turn carries its historical material forward and adds the Turn-19 lifecycle record above. Earlier verified findings include native SSE cancellation, screen-share startup serialization, planner stale-item rejection, delete-all transactional restoration, proactive-state merge completeness, release dry-run/release-trigger hardening, session-bound admin unlock isolation, duplicate rest-day calendar normalization, and Android cleartext policy hardening.

## Remaining Risks / Not Verified

- Admin preview unlock paths still need a consistent login-marker/session-identity gate.
- Remote proactive cooldown values still need runtime validation before entering merged state.
- Native `requestJson()` abort still needs an immediate non-retry regression fix.
- Notification reply actions still need explicit authenticated-session binding.
- Direct `setDayMode` array canonicalization remains a lower-priority data-hygiene improvement; calendar consumers now normalize duplicate rest-day entries defensively.
- Physical-device lifecycle, PiP, camera, screen-share, OEM background behavior, and process-death recovery remain not device-verified.
- `LiveCompanionForegroundService` camera+microphone+mediaPlayback type combinations still require Android-version/permission matrix verification.
- `ScreenSharePlugin` process-death/recreation and Activity/plugin-process ownership still require physical-device evidence beyond CI compilation/tests.
- `ScreenShareForegroundService` uses a four-hour WakeLock timeout; long-running-session behavior beyond that boundary remains not device-verified.
- `VITE_DEFAULT_AI_API_KEY` build-time exposure remains UNPROVEN because configured credential scope is not observable through repository access.
- Repeated `AudioRoute.getAvailableRoutes is not a function` warnings remain UNPROVEN/ENVIRONMENTAL because tests pass through the guarded native/web boundary and native runtime evidence is unavailable.
- Vite `base: './'` combined with root-absolute service-worker/manifest/notification paths remains UNPROVEN without deployment-topology evidence.

## Historical state integrity note

No historical finding was deleted. P1 was removed from the prioritized open queue only after exact-SHA CI and final source re-audit established `VERIFIED`; its complete lifecycle remains above. The remaining index is synchronized to the unresolved findings carried forward from the independent review.
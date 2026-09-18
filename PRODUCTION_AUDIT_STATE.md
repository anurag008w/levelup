# Production Audit State

This file is the persistent handoff for the hourly production-audit loop.

## Current State

- Repository: `anurag008w/levelup`
- Working branch: `misa-work`
- Target branch: `main`
- Audit turn: 21
- Status: IN PROGRESS — CI GATE PENDING; EXTERNAL EVIDENCE REMAIN
- Current verified application/code head: `2f0fdd58ade5d0da23af8071b845b31879d199fa`
- Latest audit-state bookkeeping is recorded separately on `misa-work`; PR #34 remains the sole open PR
- Open PR: #34 (`misa-work` -> `main`), open, not merged, no auto-merge

### PRIORITIZED OPEN FINDINGS INDEX

1. **BLOCKED — Deployment-topology verification for Vite relative base with root-absolute service-worker/manifest/notification paths.** Requires real deployment topology evidence.
2. **BLOCKED — Android/native device and API-matrix verification.** Physical process-death, OEM background, PiP, camera/screen-share, and long-running FGS behavior require device evidence unavailable in repository CI.
3. **BLOCKED — Build-time VITE_DEFAULT_AI_API_KEY exposure assessment.** Actual configured credential scope is not observable through repository access.
4. **IN PROGRESS — Patch-package failure is not fail-closed during dependency installation.** Implementation is pushed; exact-SHA CI is still pending.
5. **IN PROGRESS — Release version scheme accepts an oversized final component that updater/Android parsing cannot represent consistently.** Helper guard is pushed, but the manual release workflow has its own parser and still needs matching validation.

## Turn 21 — Release/install guardrail hardening + CI regression recovery

### Scope and evidence
- Re-read the persistent state before changes and inspected PR #34, the current branch head, the independent deep-scan findings, release tooling, package installation behavior, and existing update-version tests.
- The independent scan identified safely actionable release/install reliability gaps: `postinstall` allowed a required `patch-package` patch to fail silently; the release-version helper accepted five-or-more-digit final version components even though the updater and Android version-code parser interpret the final component as `DDSS`; and environment/release documentation had drifted.
- Implemented fixes without merge/auto-merge/rebase/force-push or creation of another PR.

### Finding lifecycle

#### P3 — Required patch-package patch must fail closed — IN PROGRESS
- **Root cause:** `package.json` used `"postinstall": "patch-package"` without `--error-on-fail`. A patch mismatch could leave a dependency unpatched while `npm ci` still completed.
- **Changed files/functions:** `package.json` (`scripts.postinstall`).
- **Implementation commit:** `42887bba78528ac8cd933f34d1288437a48095d0`.
- **Regression/recovery commit:** `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` restored the accidentally omitted `vite` devDependency after inspecting the exact CI diff.
- **Checks:** CI #629 / Actions `35335841582` for `42887bba78528ac8cd933f34d1288437a48095d0` reached `npm ci` successfully and explicitly logged `patch-package --error-on-fail` plus `@capacitor/local-notifications@8.2.1 ✔`. The same run then failed lint on the first regression test because an `.mjs` file contained TypeScript-only type syntax; this was diagnosed and corrected in `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f`.
- **Status:** `IN PROGRESS` pending terminal-success CI for the corrected SHA.

#### P2/P3 — Release version ambiguity and release helper repository drift — IN PROGRESS
- **Root cause:** `parseVersion()` interprets 3/4-digit date suffixes as day plus sequence, while `scripts/release-version.mjs` accepted arbitrary-length final components. A value such as `2026.09.10000` could therefore be accepted by the helper but represented inconsistently by updater comparison and Android `versionCode` generation. Separately, `scripts/release.sh` printed the obsolete `jee-human-os` Actions URL.
- **Implementation:** constrained `scripts/release-version.mjs` to `YYYY.MM.DD` / `YYYY.MM.DDSS` with at most four final digits; added `scripts/release-version.test.mjs` covering supported forms and rejection of `2026.09.10000`; corrected the release helper's repository URL to `anurag008w/levelup`.
- **Changed files/functions:** `scripts/release-version.mjs`, `scripts/release-version.test.mjs`, `scripts/release.sh`.
- **Implementation commit:** `42887bba78528ac8cd933f34d1288437a48095d0`.
- **Regression/recovery commit:** `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` corrected the test syntax and restored `vite`.
- **Limitation:** `.github/workflows/release.yml` independently parses the manual version input and does not call `release-version.mjs`; it can still accept an oversized final component. This finding therefore remains `IN PROGRESS` and is not claimed fixed.
- **Status:** `IN PROGRESS`.

#### P3/S4 — Environment example must accurately document build-time exposure and app version — IN PROGRESS
- **Root cause:** `.env.example` omitted `VITE_APP_VERSION` even though the updater reads it, and its wording could imply that `VITE_DEFAULT_AI_API_KEY` is a hidden runtime secret. Vite `VITE_*` values are embedded into the client bundle.
- **Implementation:** documented `VITE_APP_VERSION`, explicitly stated that `VITE_*` values are build-time/client-bundle values rather than runtime secrets, and warned against shipping real credentials in `VITE_DEFAULT_AI_API_KEY` in public web builds.
- **Changed files:** `.env.example`.
- **Implementation commit:** `42887bba78528ac8cd933f34d1288437a48095d0`.
- **Status:** `IN PROGRESS` pending exact-SHA CI and final source re-audit.

### Turn 21 CI failure/recovery evidence
- Commit `42887bba78528ac8cd933f34d1288437a48095d0` triggered CI #629 / Actions `35335841582`.
- `npm ci` succeeded and demonstrated the new fail-closed patch command was actually executed; lint then failed on the newly added `scripts/release-version.test.mjs` because it contained TypeScript type annotations in an `.mjs` file.
- The failure was not ignored. Commit `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` removes those annotations and restores the `vite` devDependency accidentally omitted by the first commit.
- Exact-SHA CI for `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` was queued/in progress when this state record was prepared; no finding depending on that gate is marked `FIXED` or `VERIFIED` yet.

## Turn 20 — Admin/session + sync + native cancellation + notification + day-mode hardening

### Scope and implementation

This turn consumed the previous prioritized queue and implemented every safely actionable P2/P3 item before the externally blocked evidence items.

#### P2 Admin preview/manual unlock session binding — VERIFIED
- **Root cause:** auto-unlock trusted `isSuperAdmin` without requiring a non-empty username/login marker, while manual unlock could verify a different super-admin username and still flip in-memory admin state even when the active app session did not match.
- **Changed files/functions:** `src/lib/admin.ts` (`canAutoUnlockSession`); `src/lib/useAppState.ts` (`autoUnlock`, `unlockAdmin`); `src/lib/__tests__/misc.test.ts`; `src/lib/__tests__/use-app-state.test.tsx`.
- **Implementation/test commits:** `22d22a937c9e076991e14f9ed0ffdcf60f7d733b`, `805734dfccd26398a9f078494a9d178f648833d5`, `a97c30191f6e034e0f9acd97236f941fcd404029`, `a571bd4d01f354be44676c4283db433eb03e62e8`.
- **Verification:** exact application-head CI run #623 / Actions `35332445497` for final application SHA `2f0fdd58ade5d0da23af8071b845b31879d199fa`: `test`, `web-build`, and `android-build` all completed with terminal `success`. Test job completed lint, full test suite, and type check successfully.
- **Post-CI re-audit:** `canAutoUnlockSession` now requires super-admin + non-empty username + non-empty `loggedInAt`; `unlockAdmin` rejects credential verification when the active session is absent, username-mismatched, or markerless, and verifies the stored marker before setting React admin state.
- **Lifecycle:** `VERIFIED`.

#### P2 Remote proactive cooldown validation — VERIFIED
- **Root cause:** remote `topicCooldowns` values entered `mergeRelationshipState` before runtime validation; malformed strings, NaN, Infinity, negatives, blank topic keys could influence merged proactive state.
- **Changed files/functions:** `src/features/sync/sync-merge.ts` (`sanitizeTopicCooldowns`, `mergeRelationshipState`); `src/features/sync/__tests__/sync-merge.test.ts`.
- **Implementation/test commits:** `7cd6216959827837f18895a8128b133f11eae566`, `29e3addc00cb83c91857c4828cf8ff8c9ec5ae21`, `2f0fdd58ade5d0da23af8071b845b31879d199fa`.
- **Verification:** exact run #623 / `35332445497` terminal-success across all relevant jobs. Regression covers numeric strings, negative, NaN, Infinity, and cross-device max-expiry preservation.
- **Post-CI re-audit:** both local and remote cooldown maps are sanitized to finite, non-negative numbers with non-empty trimmed topic keys before max-merge.
- **Lifecycle:** `VERIFIED`.

#### P2 Native HTTP abort retry guard — VERIFIED
- **Root cause:** `requestJson()` classified abort as non-retryable but fell through the catch block without throwing, causing additional immediate attempts until the retry budget was exhausted.
- **Changed files/functions:** `src/infra/ai/http-native.ts` (`requestJson`, `isRetryableNativeError`); `src/infra/ai/__tests__/http-native.test.ts`.
- **Implementation/test commits:** `09c73b7fa856da1bc50bac25b1dff96c3c1f4925`, `c294717c9a81e2bfd95b6a3f96914b4a18515933`.
- **Verification:** run #623 / `35332445497` terminal-success. Regression proves an aborted native JSON request is attempted exactly once and surfaces `HttpError(kind="aborted")`; the existing native SSE cancellation coverage also remains green.
- **Post-CI re-audit:** retry loop now only continues for retryable errors while attempts remain; abort and other non-retryable `HttpError` values throw immediately.
- **Lifecycle:** `VERIFIED`.

#### P2 Notification authenticated-session binding — VERIFIED
- **Root cause:** notification replies were guarded only by the existence of an active owner. A persisted notification could survive a login/session transition without carrying proof that it belonged to the current authenticated login marker.
- **Changed files/functions:** `src/lib/notifications.ts` (`NotificationActionPayload`, notification extra payload, action extraction); `src/lib/notification-actions.ts` (`isNotificationReplyBoundToActiveOwner`, reply guard); `src/lib/__tests__/notification-actions.test.ts`.
- **Implementation/test commits:** `5009521525fd73baf901a4ae20d937599c61f2ba`, `a22f7268de3a04be0c5f46b3c72f31619e72d12f`, `48e7d92a95280e92a01049f3c86a980fe85c999e`, `37d140a216a8ae6032870fda5af0293921d4ef99`.
- **Verification:** run #623 / `35332445497` terminal-success. Notification action tests passed, including mismatched-marker rejection; authenticated notifications now capture `loggedInAt` and replies require that exact marker, while guest replies require explicit guest ownership.
- **Post-CI re-audit:** notification creation attaches `authSessionMarker`; native action dispatch forwards it; reply handling rejects markerless/mismatched authenticated replies and still permits explicit guest ownership.
- **Lifecycle:** `VERIFIED`.

#### P3 Direct day-mode canonicalization — VERIFIED
- **Root cause:** `setDayMode` normalized arrays for calculations but a no-op request could return before persisting the canonical sets, leaving duplicate legacy values in state.
- **Changed files/functions:** `src/features/chat/chat-tools.service.ts` (`normalizeToolDayList`, `setDayMode`); `src/features/chat/__tests__/chat-tools.test.ts`.
- **Implementation/test commits:** `61fd64aecf603a13fb815a1b29722315e02f5d47`, `b6352131ed649bc8a17476bee4858efe3f6ab235`, `33a74358dcc20eba88f62b13fd70adbef174a2d2`; CI-found regression fix commits `b6352131ed649bc8a17476bee4858efe3f6ab235` and `2f0fdd58ade5d0da23af8071b845b31879d199fa`.
- **Verification history:** first exact application CI run #619 / `35332289405` correctly failed two newly added regressions: duplicate day-mode state was not canonicalized on an idempotent request, and the cooldown test fixture accidentally shared the default nested fatigue object. Both were diagnosed from exact CI logs and fixed in the subsequent commits.
- **Final verification:** run #623 / `35332445497` completed with `test`, `web-build`, `android-build` all terminal `success`; the full suite reported 1422 tests passing. Post-CI re-audit confirms a no-op day-mode request now persists canonical unique, bounded, sorted day sets.
- **Lifecycle:** `VERIFIED`.

### Turn 20 failure/recovery evidence
- Application-head attempt `33a74358dcc20eba88f62b13fd70adbef174a2d2` triggered CI #619 / `35332289405`, where `test` failed exactly two regression cases and `web-build`/Android were skipped by the dependency chain.
- The failures were not ignored: the failing expectations were diagnosed, the production no-op canonicalization path was strengthened, and the cooldown fixture was isolated from the shared default nested object.
- Corrected application head `2f0fdd58ade5d0da23af8071b845b31879d199fa` then passed all three relevant jobs in CI #623 / `35332445497`.

### Regression verification of previously fixed/hardened findings

- **Android cleartext policy — VERIFIED remains valid.** Current network security policy remains deny-by-default with only the intended loopback exception; previous exact-head CI verification remains recorded.
- **Equal chat timestamp deterministic merge — VERIFIED remains valid.** Current `mergeChatSessions()` retains deterministic conflict handling and its regression suite.
- **Proactive preference merge semantics — VERIFIED remains valid.** Current `mergeProactiveBlob()` retains monotonic enablement/grace semantics and local-or-remote ringtone selection.
- **Duplicate rest-day calendar mapping — VERIFIED remains valid.** Current merge and date-consumer paths retain duplicate normalization.
- **Task-log snapshot hardening — VERIFIED remains valid.** Historical hardening remains present.
- **Native HTTP cancellation — VERIFIED.** The original SSE cancellation hardening remains present, and Turn 20 additionally verified the native `requestJson()` retry-loop guard after abort.
- **Screen-share obsolete-start race — VERIFIED for the original race.** Historical generation-token hardening remains represented; physical lifecycle evidence remains blocked.

## Historical Audit/Fix Record

All earlier audit turns, findings, fixes, regressions, and verification evidence remain preserved in Git history immediately preceding this state update. The prior persistent state was blob `4e6c7e3468554af90fd994c6150171cd4a0f6e7c`; this turn carries its historical material forward and adds the Turn-19 lifecycle record above. Earlier verified findings include native SSE cancellation, screen-share startup serialization, planner stale-item rejection, delete-all transactional restoration, proactive-state merge completeness, release dry-run/release-trigger hardening, session-bound admin unlock isolation, duplicate rest-day calendar normalization, and Android cleartext policy hardening.

## Remaining Risks / Not Verified

- Deployment-topology behavior for Vite `base: './'` with root-absolute service-worker/manifest/notification paths remains BLOCKED pending real deployment evidence.
- Physical-device lifecycle, PiP, camera, screen-share, OEM background behavior, and process-death recovery remain BLOCKED because repository CI cannot provide device evidence.
- `LiveCompanionForegroundService` camera+microphone+mediaPlayback combinations still require Android-version/permission-matrix verification on real devices.
- `ScreenSharePlugin` process-death/recreation and Activity/plugin-process ownership still require physical-device evidence.
- `ScreenShareForegroundService` four-hour WakeLock timeout and long-running-session behavior remain not device-verified.
- `VITE_DEFAULT_AI_API_KEY` build-time exposure remains BLOCKED/UNPROVEN because configured credential scope is not observable through repository access.
- Repeated `AudioRoute.getAvailableRoutes is not a function` warnings remain UNPROVEN/ENVIRONMENTAL because native runtime evidence is unavailable.
- No repository-CI finding from this turn is being treated as evidence of physical-device production readiness.

## Historical state integrity note

No historical finding was deleted. Turn-20 P2/P3 findings were removed from the prioritized open queue only after exact-SHA CI and final source re-audit established `VERIFIED`; their complete lifecycle remains in the Turn-20 record above. The prioritized queue now contains only findings blocked by external deployment/device/credential-scope evidence plus the new Turn-21 findings awaiting their exact-SHA CI gate.

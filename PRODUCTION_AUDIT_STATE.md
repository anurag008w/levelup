# Production Audit State

This file is the persistent handoff for the hourly production-audit loop.

## Current State

- Repository: `anurag008w/levelup`
- Working branch: `misa-work`
- Target branch: `main`
- Audit turn: 27
- Status: IN PROGRESS — RELEASE WORKFLOW CREDENTIAL ISOLATION FINDING OPEN; EXTERNAL PRODUCTION EVIDENCE REMAINS BLOCKED
- Current repository head before this state update: `859ac1e20d24e8ae22bd3070f8165284928ad2c5`
- Open PR: #34 (`misa-work` -> `main`), open, not merged, no auto-merge

### PRIORITIZED OPEN FINDINGS INDEX

1. **P1 — Release workflow checkout persists a write-capable GitHub credential across `npm ci`.** `.github/workflows/release.yml` grants `contents: write` and uses `actions/checkout` without `persist-credentials: false`, then executes `npm ci`. A compromised dependency/postinstall script could potentially access the persisted repository credential and gain write capability. Harden checkout credential persistence before treating release workflow security as production-ready.
2. **BLOCKED — Deployment-topology verification for Vite relative base.** Code-side mitigation for root-absolute service-worker/manifest/notification paths is verified, but real deployed-host evidence is still required before the deployment-topology finding can be upgraded from `BLOCKED`.
3. **BLOCKED — Android/native device and API-matrix verification.** Physical process-death, OEM background, PiP, camera/screen-share, and long-running FGS behavior require device evidence unavailable in repository CI.
4. **BLOCKED — Build-time VITE_DEFAULT_AI_API_KEY exposure assessment.** Actual configured credential scope is not observable through repository access.

## Turn 27 — Independent release credential-isolation review

### Scope and evidence
- Re-read `/PRODUCTION_AUDIT_STATE.md` first and consumed the persisted Turn-26 prioritized queue before reviewing the current PR.
- Current PR #34 remains open/unmerged, `misa-work -> main`, at head `859ac1e20d24e8ae22bd3070f8165284928ad2c5`; the PR currently reports mergeable and contains 165 commits / 61 changed files.
- Compared the current head with the Turn-26 repository head `5f7b8a90e343a662d8ae595a76fbee9166b2def9`. The three intervening commits modify `.github/workflows/release.yml`, `scripts/release-version.test.mjs`, and this audit state only; no unrelated application-code regression was introduced in that delta.
- Re-audited `.github/workflows/release.yml` as the current highest-impact actionable production surface. The workflow has `permissions: contents: write`, checks out the repository with `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`, and does not set `persist-credentials: false`. It then runs `npm ci` before building the release artifact.

### Finding lifecycle

#### P1 — Release workflow checkout persists write-capable repository credentials across dependency installation — OPEN
- **Root cause:** `actions/checkout` persists the workflow token in local git configuration by default when `persist-credentials` is not disabled. This release job has `contents: write` permission and executes `npm ci` afterward. A compromised/malicious dependency lifecycle script could potentially inspect git configuration and use the write-capable token to mutate repository contents/tags or otherwise act with the job's repository write authority.
- **Affected files/functions:** `.github/workflows/release.yml`, `Checkout repo` step; subsequent `Install dependencies` step.
- **Current evidence:** the checkout step specifies `fetch-depth: 0` only and has no `persist-credentials: false`; the same job declares `permissions: contents: write`; `npm ci` runs before the build/release steps. The workflow otherwise pins third-party actions to immutable commit SHAs.
- **Impact:** unnecessary supply-chain blast radius in the release path. A dependency compromise during install could potentially obtain a credential with repository write capability rather than only the minimum capability needed for dependency installation/building.
- **Suggested verification/fix coverage:** set `persist-credentials: false` on the release checkout; verify that the later `softprops/action-gh-release` step still authenticates through the Actions runtime token and can create the intended release/tag; add a static regression assertion that the release checkout explicitly disables credential persistence; run exact-head CI plus a release-workflow validation/dry-run where available.
- **Status:** `OPEN`.

### Independent fixed-finding verification

- **Manual release version shell boundary — VERIFIED.** Current `.github/workflows/release.yml` passes `github.event.inputs.version` through `RELEASE_INPUT_VERSION` and reads `VERSION="$RELEASE_INPUT_VERSION"`; the vulnerable direct shell interpolation is absent. The changelog command also uses `git log --format="- %s" --end-of-options "$LAST_TAG..HEAD"`. The Turn-26 exact-SHA CI evidence remains applicable to the implementation history.
- **Mutable GitHub Actions references — VERIFIED.** Current CI/release workflows retain full immutable commit SHAs for third-party actions. The current release workflow uses immutable SHAs for checkout, setup-node, setup-java, Android SDK, upload-artifact, and release creation.
- **Required patch-package fail-closed behavior — VERIFIED.** Historical hardening remains represented in the persistent record and current CI remains green; no contradictory current-head evidence was found.
- **Release version-width/parser alignment — VERIFIED.** Current release workflow still enforces the four-digit maximum final version component before computing `VERSION_CODE`, consistent with the release helper/updater contract.
- **Deployment-relative PWA hardening — VERIFIED for source/build contract; BLOCKED for real-host behavior.** No current-head delta reintroduced the previously hardened root-absolute PWA/service-worker paths. Real deployment-host verification remains externally blocked.
- **Android cleartext policy hardening — VERIFIED for repository-level policy.** The current branch retains the network-security configuration hardening; physical API/OEM verification remains covered by the broader blocked device-matrix item.
- **Historical chat/session/sync/proactive/task-log/screen-share hardening — no contradictory current-head evidence found.** These remain independently verified or externally blocked according to their prior lifecycle records; no relevant application-code delta appeared after Turn 26.

### Current CI evidence
- Exact current-head CI: run #690 / Actions `35421648207` for `859ac1e20d24e8ae22bd3070f8165284928ad2c5`.
- `test`: terminal `success`; checkout, install, lint, full tests, and type check all succeeded.
- `web-build`: terminal `success`; production web build succeeded.
- `android-build`: terminal `success`; checkout, Node/Java/Android setup, dependency installation, web build, Capacitor sync, Android unit tests/debug APK build, and artifact upload all succeeded.
- CI green is not treated as production releaseability evidence for the external deployment/device/credential items.

## Turn 26 — Release workflow shell-boundary verification

### Scope and evidence
- Re-read `/PRODUCTION_AUDIT_STATE.md` first and consumed the prioritized queue. The three remaining production findings require external deployment/device/credential evidence unavailable through repository access, so no unsupported claim was made and no arbitrary code change was introduced.
- Re-audited the current release workflow and the two hardening commits following Turn 25: `913dd398b5f735ade77595971611fbcfc7c89925` and `5f7b8a90e343a662d8ae595a76fbee9166b2def9`.
- Confirmed `.github/workflows/release.yml` reads the manual `workflow_dispatch` version through `RELEASE_INPUT_VERSION` and `VERSION="$RELEASE_INPUT_VERSION"`, so the workflow input is shell data rather than shell source.
- Confirmed the changelog command treats the previous tag as revision data with `git log --format="- %s" --end-of-options "$LAST_TAG..HEAD"`; the regression test added in `5f7b8a90e343a662d8ae595a76fbee9166b2def9` asserts this contract and rejects the vulnerable unquoted ordering.
- No merge, auto-merge, rebase, force-push, second PR, or PR close was performed.

### Finding lifecycle

#### P1/P2 — Manual release version input can cross into shell source — VERIFIED
- **Root cause:** `.github/workflows/release.yml` previously embedded `${{ github.event.inputs.version }}` directly inside a shell assignment, allowing a crafted manual input to be interpreted as shell syntax before validation.
- **Changed files/functions:** `.github/workflows/release.yml` (`Set version` step); `scripts/release-version.test.mjs` (workflow-boundary and changelog revision regression assertions).
- **Implementation history:** `913dd398b5f735ade77595971611fbcfc7c89925` isolated the manual input through an environment variable; `5f7b8a90e343a662d8ae595a76fbee9166b2def9` added the previous-tag `git log` boundary regression guard.
- **Targeted/static verification:** current workflow contains `RELEASE_INPUT_VERSION: ${{ github.event.inputs.version }}`, reads `VERSION="$RELEASE_INPUT_VERSION"`, and uses `git log --format="- %s" --end-of-options "$LAST_TAG..HEAD"`; the vulnerable direct version interpolation and old unguarded changelog command are absent.
- **Exact-SHA CI evidence:** commit `5f7b8a90e343a662d8ae595a76fbee9166b2def9` has completed GitHub Actions successfully. Check-runs for that exact SHA include `test`, `web-build`, and `android-build` with terminal `success`; Android build/test also completed successfully. Relevant run IDs include `35416244726` and `35416246239`.
- **Commit attribution:** the final hardening commit is authored by Anurag and contains exactly the required `Co-authored-by: Misa AI <323098813+misa-ai-a@users.noreply.github.com>` trailer.
- **Final re-audit:** release workflow source and regression tests still enforce both shell-boundary protections at the current head.
- **Lifecycle:** `VERIFIED`.

## Turn 25 — Release workflow input-boundary hardening

### Scope and evidence
- Re-read `/PRODUCTION_AUDIT_STATE.md` first and consumed the prioritized queue. The previously blocked deployment/device/credential findings cannot be completed with repository-only evidence, so the next safely actionable production issue was audited in the release workflow.
- Re-read `.github/workflows/release.yml` and confirmed that `github.event.inputs.version` was interpolated directly inside shell source as `VERSION="${{ github.event.inputs.version }}"`. Manual workflow inputs are untrusted strings; embedding them into shell source can turn shell metacharacters/command substitutions into executable workflow code before the version regex is reached.
- Implemented the boundary fix by exposing the workflow input as the `RELEASE_INPUT_VERSION` environment variable and reading it as normal shell data with `VERSION="$RELEASE_INPUT_VERSION"`. The input therefore no longer becomes part of the generated shell program.
- Added a static regression assertion to `scripts/release-version.test.mjs` requiring the environment-variable boundary and rejecting the vulnerable interpolation pattern.
- Existing version validation remains unchanged and still rejects oversized final components.
- No merge, auto-merge, rebase, force-push, second PR, or PR close was performed.

### Finding lifecycle

#### P1/P2 — Manual release version input can cross into shell source — IN PROGRESS
- **Root cause:** `.github/workflows/release.yml` previously embedded `${{ github.event.inputs.version }}` directly inside a shell assignment. A crafted manual input could therefore be interpreted by the shell as syntax rather than treated only as version data. The later regex validation does not protect against code execution that occurs while the assignment is being evaluated.
- **Changed files/functions:** `.github/workflows/release.yml` (`Set version` step); `scripts/release-version.test.mjs` (static workflow-boundary regression).
- **Implementation commit:** `913dd398b5f735ade77595971611fbcfc7c89925`.
- **Targeted/static verification:** checked-in workflow now contains `RELEASE_INPUT_VERSION: ${{ github.event.inputs.version }}` under `env:` and `VERSION="$RELEASE_INPUT_VERSION"`; the vulnerable `VERSION="${{ github.event.inputs.version }}"` pattern is absent. The version regex remains downstream as a validation guard.
- **Regression coverage:** `scripts/release-version.test.mjs` reads `.github/workflows/release.yml` and asserts the safe environment-variable boundary plus absence of the vulnerable direct interpolation.
- **CI evidence:** exact-SHA CI for `913dd398b5f735ade77595971611fbcfc7c89925` was not yet available at the time of that state update; no finding was marked `FIXED` or `VERIFIED` pending the CI gate.
- **Lifecycle at Turn 25:** `IN PROGRESS`.

## Turn 24 — GitHub Actions supply-chain pinning + exact-SHA CI verification

### Scope and evidence
- Re-read `/PRODUCTION_AUDIT_STATE.md` first and consumed the prioritized queue. All three existing findings were externally blocked, so no unsafe attempt was made to manufacture deployment/device/credential evidence.
- Audited the current `misa-work` CI and release workflows for mutable third-party action references.
- Confirmed the workflows used mutable version tags for checkout, Node, Java, Android SDK, artifact upload, and release creation.
- Verified the current upstream tag targets before editing: `actions/checkout@v7` -> `3d3c42e5aac5ba805825da76410c181273ba90b1`; `actions/setup-node@v7` -> `820762786026740c76f36085b0efc47a31fe5020`; `actions/setup-java@v5` -> `b6effb05e454b25005698d916606bdc6ffcbf961`; `android-actions/setup-android@v4` -> `be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd`; `actions/upload-artifact@v7` -> `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`; and the annotated `softprops/action-gh-release@v3` tag resolves to implementation commit `efb35369e0ad2afab669f228072c1b0d510eae64`.
- Pinned all CI/release action references to those immutable commit SHAs and retained version comments for auditability.
- No merge, auto-merge, rebase, force-push, second PR, or PR close was performed.

### Finding lifecycle

#### P2/P3 — Mutable GitHub Actions references permit dependency drift — VERIFIED
- **Root cause:** `.github/workflows/ci.yml` and `.github/workflows/release.yml` referenced mutable action tags (`@v7`, `@v5`, `@v4`, `@v3`). A future tag movement could change CI/release behavior without a repository commit, weakening supply-chain reproducibility and auditability.
- **Changed files/functions:** `.github/workflows/ci.yml` (checkout, setup-node, setup-java, setup-android, upload-artifact action references); `.github/workflows/release.yml` (checkout, setup-node, setup-java, setup-android, upload-artifact, action-gh-release references).
- **Implementation commits:** `778a1df8256817ec7902b5db5846826ecb8a662c` (CI workflow pins); `039f0a94671fa57d695e12d2996aae38c931aefa` (release workflow pins).
- **Targeted/static verification:** current checked-in workflow content uses full 40-character immutable commit SHAs for every third-party `uses:` reference in both workflows, with comments documenting the corresponding release tag.
- **Exact-SHA CI for first implementation:** run #650 / Actions `35351071476` for `778a1df8256817ec7902b5db5846826ecb8a662c` completed with terminal `success` for `test`, `web-build`, and `android-build`.
- **Exact-SHA CI for final implementation:** run #652 / Actions `35351462349` for `039f0a94671fa57d695e12d2996aae38c931aefa` completed with terminal `success` for `test`, `web-build`, and `android-build`.
- **Post-CI re-audit:** both workflow files retain immutable SHA references and the release workflow's annotated `v3` tag has been pinned to the resolved implementation commit rather than the mutable tag.
- **Lifecycle:** `VERIFIED`.

### Turn 24 CI evidence
- First implementation SHA: `778a1df8256817ec7902b5db5846826ecb8a662c`; exact CI run #650 / Actions `35351071476`; terminal success for `test`, `web-build`, and `android-build`.
- Final implementation SHA: `039f0a94671fa57d695e12d2996aae38c931aefa`; exact CI run #652 / Actions `35351462349`; terminal success for `test`, `web-build`, and `android-build`.
- No CI failure required a recovery commit in this turn.
- The state-bookkeeping commit for this turn is the only remaining CI gate before this turn's repository head can be treated as fully verified.

## Turn 23 — Deployment-relative PWA path hardening + exact-SHA CI verification

### Scope and evidence
- Re-read `/PRODUCTION_AUDIT_STATE.md` first and confirmed the highest-priority open finding was the deployment-topology item for `base: './'` combined with root-absolute PWA/service-worker paths.
- Re-audited the current `misa-work` versions of `index.html`, `src/main.tsx`, `public/manifest.json`, `public/sw.js`, `vite.config.ts`, and the open PR before editing.
- Confirmed the root-absolute paths were real code paths: HTML referenced `/icon-192.png` and `/manifest.json`; `main.tsx` registered `/sw.js`; and the service worker opened `/` after a notification click.
- Implemented code-side mitigation without changing the deployment model: HTML PWA assets are relative, the manifest uses relative `start_url`, `scope`, and icon paths, service-worker registration derives its URL from `import.meta.env.BASE_URL`, and notification clicks reopen the service worker's own registration scope.
- Added a regression test at `scripts/deployment-paths.test.mjs` covering all four path contracts so future changes cannot silently reintroduce root-absolute deployment coupling.
- No merge, auto-merge, rebase, force-push, second PR, or PR close was performed.

### Finding lifecycle

#### P2/P3 — Deployment-relative PWA/service-worker path hardening — BLOCKED
- **Root cause:** the Vite configuration uses `base: './'`, but PWA entry points used root-absolute paths. On a host where the app is served below `/`, those paths resolve outside the deployed application. The service worker also used `/` as its notification-click fallback, which similarly escapes a subpath deployment.
- **Changed files/functions:** `index.html` (favicon/manifest links); `public/manifest.json` (`start_url`, `scope`, icon `src`); `src/main.tsx` (service-worker registration URL); `public/sw.js` (notification-click fallback); `scripts/deployment-paths.test.mjs` (regression coverage).
- **Implementation commits:** `2411a8cd53284fe6e9f84c3e1419c9ea74e2ff0e`, `656faffcda50928ae2d8aaf8531643af1f038c45`, `7ac37a89b1b6880b5ed65c7dbdede762fcc2ccfc`, `d711d0d970f7ed1a45848679c4c163ba2fd097c3`, `b13fe22ba87446d62b93b504dc5052c83a79d6ca`.
- **Targeted/static verification:** post-change source re-audit confirms `index.html` no longer contains root-absolute favicon/manifest paths; the manifest uses `./` for start/scope and `./favicon.svg`; `main.tsx` constructs `${import.meta.env.BASE_URL}sw.js`; and `sw.js` uses `self.registration.scope` rather than `/`.
- **Regression coverage:** `scripts/deployment-paths.test.mjs` asserts the relative HTML paths, exact manifest `start_url`/`scope`/icon contract, BASE_URL-derived service-worker registration, and scope-relative notification fallback.
- **Exact-SHA CI:** run #646 / Actions `35345597971` for `b13fe22ba87446d62b93b504dc5052c83a79d6ca` completed with terminal `success` for `test`, `web-build`, and `android-build`.
- **Evidence limitation:** repository CI proves the source/build contract but does not prove behavior on the user's actual deployment host, especially rewrite/base-URL behavior for a subpath and browser service-worker scope. The deployment-topology finding therefore remains `BLOCKED`; the code-side mitigation is verified but real-host verification is still required.
- **Lifecycle:** `BLOCKED`.

### Turn 23 CI evidence
- Final implementation SHA: `b13fe22ba87446d62b93b504dc5052c83a79d6ca`.
- Exact CI run: #646 / Actions `35345597971`.
- `test`: terminal `success`; install, lint, full tests, and type check completed successfully.
- `web-build`: terminal `success`; production web build completed successfully.
- `android-build`: terminal `success`; Android SDK setup, dependency installation, web build, Capacitor sync, Android unit tests/debug APK build, and artifact upload completed successfully.
- No CI failure required a recovery commit in this turn.

## Turn 22 — Release workflow parser alignment + exact-SHA verification

### Scope and evidence
- Re-read `/PRODUCTION_AUDIT_STATE.md`, confirmed PR #34 and branch `misa-work`, and consumed the highest-priority safely actionable finding remaining from Turn 21.
- Re-audited the release workflow against `scripts/release-version.mjs` and `src/lib/updates.ts` before changing it.
- Implemented fail-closed validation in `.github/workflows/release.yml` so the manual release path accepts only the same `YYYY.MM.DD` / `YYYY.MM.DDSS` final-component width supported by the release helper and updater/Android parser.
- No merge, auto-merge, rebase, force-push, second PR, or PR close was performed.

### Finding lifecycle

#### P3 — Required patch-package patch must fail closed — VERIFIED
- **Root cause:** `package.json` previously ran `patch-package` without `--error-on-fail`, allowing a dependency patch mismatch to leave the dependency unpatched while installation still succeeded.
- **Changed files/functions:** `package.json` (`scripts.postinstall`).
- **Implementation commit:** `42887bba78528ac8cd933f34d1288437a48095d0`.
- **Regression/recovery commit:** `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` restored the accidentally omitted `vite` devDependency and corrected the new `.mjs` test syntax.
- **Verification:** exact corrected application SHA `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` was followed by successful CI run #633 / Actions `35336039254`; `test`, `web-build`, and `android-build` all completed with terminal `success`.
- **Lifecycle:** `VERIFIED`.

#### P2/P3 — Release version ambiguity and release helper repository drift — VERIFIED
- **Root cause:** `parseVersion()` interprets 3/4-digit date suffixes as day plus sequence, while `scripts/release-version.mjs` had accepted arbitrary-length final components. A value such as `2026.09.10000` could therefore be accepted by the helper but represented inconsistently by updater comparison and Android `versionCode` generation. Separately, `scripts/release.sh` had printed the obsolete `jee-human-os` Actions URL.
- **Implementation:** `scripts/release-version.mjs` now limits the final component to at most four digits; `scripts/release-version.test.mjs` covers supported forms and rejects `2026.09.10000`; `scripts/release.sh` points to `anurag008w/levelup`.
- **Turn 22 implementation:** `.github/workflows/release.yml` now independently rejects any `VERSION_NAME` outside `^[0-9]{4}\.[0-9]{2}\.[0-9]{1,4}$` before calculating `VERSION_CODE`.
- **Changed files/functions:** `scripts/release-version.mjs`, `scripts/release-version.test.mjs`, `scripts/release.sh`, `.github/workflows/release.yml`.
- **Implementation commits:** `42887bba78528ac8cd933f34d1288437a48095d0`, `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f`, `4d9c0c2090ec8d0995466b0d80a7982e1afd5cca`.
- **Exact-SHA CI:** run #635 / Actions `35340222728` for `4d9c0c2090ec8d0995466b0d80a7982e1afd5cca` completed with terminal `success` for `test`, `web-build`, and `android-build`.
- **Lifecycle:** `VERIFIED`.

#### P3/S4 — Environment example must accurately document build-time exposure and app version — VERIFIED
- **Root cause:** `.env.example` omitted `VITE_APP_VERSION` and its wording could imply `VITE_DEFAULT_AI_API_KEY` was a hidden runtime secret.
- **Implementation:** documented `VITE_APP_VERSION`, stated that `VITE_*` values are build-time/client-bundle values rather than runtime secrets, and warned against shipping real credentials in public web builds.
- **Changed files:** `.env.example`.
- **Implementation commit:** `42887bba78528ac8cd933f34d1288437a48095d0`.
- **Verification:** exact later CI run #633 / `35336039254` on corrected SHA `28a0d7f254e69651cc035ca5ab1cb6d5b65bb39f` passed `test`, `web-build`, and `android-build`; post-CI source re-audit confirms the documentation remains present.
- **Lifecycle:** `VERIFIED` for the documentation finding; the separate configured-credential exposure question remains `BLOCKED`.

### Turn 21–20 historical material

The complete historical Turn 21 and Turn 20 finding/fix records remain preserved in the immediately preceding Git history. No historical finding was deleted; the previously verified admin/session, sync, native cancellation, notification, day-mode, Android cleartext, deterministic merge, proactive preference, duplicate rest-day, task-log, and screen-share hardening remains represented by the prior persistent state and commits.

## Remaining Risks / Not Verified

- Deployment-topology behavior for Vite `base: './'` is code-hardened in Turn 23, but real deployed-host behavior for subpath hosting, SPA rewrites, service-worker scope, and notification-click navigation remains BLOCKED pending real deployment evidence.
- Physical-device lifecycle, PiP, camera, screen-share, OEM background behavior, and process-death recovery remain BLOCKED because repository CI cannot provide device evidence.
- `LiveCompanionForegroundService` camera+microphone+mediaPlayback combinations still require Android-version/permission-matrix verification on real devices.
- `ScreenSharePlugin` process-death/recreation and Activity/plugin-process ownership still require physical-device evidence.
- `ScreenShareForegroundService` four-hour WakeLock timeout and long-running-session behavior remain not device-verified.
- `VITE_DEFAULT_AI_API_KEY` build-time exposure remains BLOCKED/UNPROVEN because configured credential scope is not observable through repository access.
- Repeated `AudioRoute.getAvailableRoutes is not a function` warnings remain UNPROVEN/ENVIRONMENTAL because native runtime evidence is unavailable.
- No repository-CI finding from this turn is being treated as evidence of physical-device production readiness.

## Historical state integrity note

No historical finding was intentionally deleted. Turn 20 P2/P3 findings remain represented with their lifecycle above; Turn 21 release/install findings remain represented with their recovery history and subsequent VERIFIED records; Turn 23 adds verified code-side mitigation for the deployment-path failure mode while intentionally retaining the real-host deployment verification finding as `BLOCKED`; Turn 24 adds the immutable-action hardening finding as `VERIFIED`; Turn 25 adds the release-input shell-boundary finding as `IN PROGRESS` pending exact-SHA CI and final re-audit; Turn 26 independently verifies the release input and changelog revision shell boundaries at current head `5f7b8a90e343a662d8ae595a76fbee9166b2def9` with successful exact-SHA CI; Turn 27 independently audits the release checkout credential boundary at current head `859ac1e20d24e8ae22bd3070f8165284928ad2c5` and records the new P1 finding while preserving all prior history.

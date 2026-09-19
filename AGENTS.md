# AGENTS.md — LevelUp

Instructions for AI agents working in this repository.

## Production-grade engineering mandate

The autonomous production-audit loop is an **implementation loop**, not a review-only loop.
The objective is to bring the repository and its features to production-grade quality through
incremental, verified engineering work.

- Treat every proven actionable defect, regression, reliability gap, security/privacy issue,
  persistence/data-integrity issue, UX failure, performance issue, CI/CD failure, release issue,
  or missing regression test as a work item when it can be safely fixed in the repository.
- Actually implement fixes, add or strengthen regression coverage where appropriate, run the
  strongest available verification, update documentation/contracts when behavior changes, and
  re-audit the changed and adjacent surfaces in the same turn.
- Do not finish a turn with a known safely-fixable bug merely because the audit found it.
- Production-grade means more than “works on the happy path”: account for error handling,
  cancellation/cleanup, retries/timeouts, persistence and migration safety, concurrency/races,
  edge cases, security/privacy, offline/degraded operation, lifecycle behavior, performance,
  accessibility where applicable, observability/debuggability, tests, and release/CI reliability.
- Do not claim that a feature is production-ready merely because it has been reviewed or works in
  one happy-path test. Mark readiness only after the relevant hardening work and verification are
  actually complete.
- Keep a durable record of important findings, fixes, verification, blockers, and remaining risks
  in the repository's production-audit state file when that workflow requires it.

## Commit attribution

- Every commit made **through opencode** (i.e., by the AI agent) must append this
  trailer line to the commit message:

  `Co-authored-by: Misa AI <323098813+misa-ai-a@users.noreply.github.com>`

- Keep the commit **author** as the repository default identity (`anurag008w`).
- Do **not** add the trailer to commits the user makes on their own
  (terminal/IDE, no AI involvement) — those belong to the user only.
- Never duplicate the trailer if it is already present.

## Development status of Misa features

The following **Misa** features are currently **in development** (not production-ready).
Do **not** mark them as stable/done in docs, release notes, or UI copy simply because they are
being actively hardened. Bringing them to production requires the engineering, verification,
and operational evidence described above.

- **Misa Live voice** — real-time bidirectional voice & multimodal streaming.
- **Misa Memory** — conversation/context memory across sessions.
- **Proactive study nudges (messages)** — spontaneous auto check-ins & follow-ups.
- **Proactive WhatsApp-style calls** — live incoming calls for scheduled checks.

The production-audit loop is explicitly responsible for hardening these areas toward production
readiness. Keep this list in sync (`README.md` / `README.EN.md` / UI dev badges) until the relevant
acceptance evidence exists. A feature may be removed from this development-only list only after
its production-readiness has been genuinely established and the related documentation/UI has been
updated consistently.

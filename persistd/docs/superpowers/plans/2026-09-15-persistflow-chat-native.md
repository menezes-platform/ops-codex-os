# PersistFlow Hostinger-First v1 Implementation Plan

**Goal:** evolve `persistd` into a chat-native PersistFlow v1 with a Hostinger Node.js control-plane service while preserving existing lifecycle invariants.

**Architecture:** keep current Persistd browser/takeover code as the mechanical lifecycle engine. Introduce small pure modules for authority state, autonomy policy, Baton v2/capability profiles, watchdog decisions and operation receipts. Add a root Node HTTP app for Hostinger. Migrate local `CONTROL.md` through an `AuthorityStore` adapter rather than a big-bang rewrite.

**Tech stack:** Node.js 24/CommonJS, built-in `http`, built-in `node:test`; no new paid services and no unnecessary runtime dependency.

## Task 1 — Hostinger HTTP shell

Create `server.js`, root `package.json`, and `tests/persistflow-server.test.js`.

TDD:
1. RED: `/` and `/healthz` return 200 JSON and the server factory supports an injected port.
2. GREEN: minimum built-in HTTP server that listens on `process.env.PORT`.
3. RED: unknown routes return JSON 404.
4. GREEN/refactor.
5. Run root and persistd suites.

## Task 2 — Canonical run-state model

Create `persistd/src/persistflow/run-state.js` and `persistd/persistflow-state.test.js`.

TDD:
1. RED for schema normalization, monotonic generation, and single-successor invariant.
2. RED for stale-generation mutation denial.
3. GREEN with pure functions only.

## Task 3 — AuthorityStore

Create `persistd/src/persistflow/authority-store.js`, `control-projection-store.js`, and focused tests.

TDD:
1. RED for compare-and-swap generation promotion and one-time claim consumption.
2. GREEN in-memory store used by tests.
3. RED for local CONTROL projection preserving compatibility fields.
4. GREEN without making CONTROL a second authority.

## Task 4 — Baton v2 and capability resolver

Create `persistd/src/persistflow/baton-v2.js` and `capabilities.js`; extend `persistd/src/handoff.js`.

TDD:
1. RED for minimal tool selection: RDC/GitHub plus conditional Exa/Engram/Vercel/Supabase.
2. GREEN resolver.
3. RED for Baton v2 containing next-safe-action, autonomy and tool profile.
4. GREEN while preserving legacy claim markers.

## Task 5 — Deterministic autonomy policy
Extend `persistd/src/policy.js`; add `persistflow-policy.test.js`.

TDD hard gates: money, credentials/IAM, irreversible data loss, public security boundary, destructive shared history, material scope expansion and preset elevation. Return only `ALLOW`, `HUMAN`, or `DENY`. Keep compatibility wrapper for current callers.

## Task 6 — Watchdog and crash recovery

Create `persistd/src/persistflow/watchdog.js`; wire minimally into orchestrator.

TDD:
1. ACTIVE -> SUSPECTED_STALL -> RECOVERY_REQUIRED.
2. Known busy tool/browser activity delays rescue.
3. Unhealthy browser -> WAITING_BROWSER with no new successor.
4. Existing proactive rollover remains compatible.

## Task 7 — Archive invariants

Add only missing regression tests. Preserve the existing behavior already covered by the 84-test baseline: single active chat, exact failed-candidate cleanup, archive retry, prune and cleanup debt. Do not duplicate working code.

## Task 8 — Hostinger semantic run API

Extend `server.js` and create `persistd/src/persistflow/service.js`.

Initial endpoints:
- `GET /healthz`
- `GET /v1/runs/:runId`
- `POST /v1/runs`
- `POST /v1/runs/:runId/heartbeat`
- `POST /v1/runs/:runId/claim`
- `POST /v1/runs/:runId/checkpoints`

Use an injected `AuthorityStore`; expose no shell/filesystem/browser primitives.

## Task 9 — Persistence verification

Do not guess Hostinger filesystem guarantees. Verify runtime persistence before selecting a production store. If persistence is insufficient, keep the service adapter-backed and choose an already-owned durable backend only after explicit verification; do not silently add Supabase or any paid dependency.

## Task 10 — Deployment and verification

Update README/deployment docs and root `start` script.

Verification:
- `npm test`
- `npm --prefix persistd test`
- start server on an ephemeral port and curl `/` and `/healthz`
- inspect Git diff/status
- do not mutate the installed Persistd runtime until branch verification is green
- push only the verified branch/commit needed for Hostinger deployment

## DoD

Existing 84 Persistd tests remain green; new PersistFlow tests are green; Hostinger-compatible server listens on `process.env.PORT`; chat-native authority/archive/recovery invariants remain enforced; no cognitive worker and no automatic spend are introduced.

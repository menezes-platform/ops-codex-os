# MCP Reliability and Railway Ephemeral Integration Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax and each implementation task adds a failing test before code.

**Goal:** Determine the emitting layer for recurring MCP failures from correlated evidence, implement only proven P0 reliability fixes, and compose the already-tested Railway anonymous worker into PersistFlow without adding another authority, scheduler, queue, or retry engine.

**Architecture:** PersistFlow remains authoritative for runs, generations, claims, leases, checkpoints, and receipts. The existing PersistFlow MCP remains a facade. The already-merged `RailwayAnonymousProvider` and `EphemeralWorkerLoop` are composed only through an existing fleet/provider seam after that seam is verified; no production activation occurs until durable handoff, fallback, quota, and restart behavior pass. MCP reliability work instruments the actually observed request path; it does not assume which 429 source is responsible.

**Tech Stack:** Node.js 22+ CommonJS and `node:test` in `ops-codex-os`; Python `urllib`/Streamable HTTP in `ops-dev-orquestra`; TypeScript and Vitest/CI scripts in `ops-gabriel-ops`; JavaScript Cloudflare Worker in `ops-site-ops`; GitHub Actions and Railway deployment/log APIs.

**Spec:** `persistd/docs/superpowers/plans/2026-09-27-mcp-reliability-railway-integration.md` (this plan), informed by `ops-gabriel-ops/docs/operations/MCP_TOPOLOGY.md`, `MCP_FAILURE_ANALYSIS.md`, `MCP_RELIABILITY_PLAN.md`, and `MCP_RUNBOOK.md` on draft PR #69.

## Global Constraints

- Start each repository task by checking branch, status, remotes, and recent commits; work on a dedicated branch. Do not overwrite user work.
- Preserve authority boundaries: PersistFlow owns durable run/operation state; Git owns code; object storage is durable content-addressed storage; workers and local caches are disposable; MCP is transport/facade only.
- Reuse `PersistFlowService`, the existing `FleetRouter`/fleet contracts, sandbox operation IDs, `RailwayAnonymousProvider`, and `EphemeralWorkerLoop`. If no compatible seam exists, stop that integration task and document the missing contract instead of creating a second scheduler.
- Do not claim an MCP root cause until a captured failing request identifies the emitting hop. Preserve status, safe response headers, request/trace IDs, timing, and sanitized body at every owned boundary.
- Do not add nested retries. Mutations with an ambiguous outcome must inspect the same `operation_id` before any resubmission. Any retry must be bounded, jittered, idempotent, and honor `Retry-After`; if no retry is necessary, surface the upstream response without retry.
- Disconnect or MCP restart must not cancel persisted work. A reconnect must inspect the same `request_id`/`operation_id`/`run_id`.
- Keep Railway anonymous quotas intact (including the provider’s three-per-day local budget); never rotate identity/IP or exceed platform limits. A failed successor acquisition must preserve the predecessor and its checkpoint.
- Never log credentials, bearer/OAuth tokens, cookies, SSH private keys, or Railway claim URLs. Include a secret-leak regression check for new logs.
- Keep Railway activation off by default. Reuse an existing feature-flag/config mechanism; only add a default-off flag if repository inspection confirms none exists. Rollback is disabling that flag and reverting the isolated composition commit.
- Run relevant package tests, repository root tests, `git diff --check`, secret regression, and CI for each affected repository. Do not reduce or delete existing assertions.

## Review Focus

- A captured 429 can be attributed to Cloudflare edge, Tailscale origin, MCP process, backend, or external provider using status, response headers/body, request IDs, and matching logs; absent data stays explicitly unverified.
- One mutation sent once and then timed out is reconciled by its existing `operation_id`; no second effect is created.
- A 429 with numeric or HTTP-date `Retry-After` is not retried early; a missing header does not trigger an immediate retry loop.
- G1 remains alive and authoritative if G2 cannot be acquired or finalized. G2 is ready and resumes from a persisted checkpoint before G1 is released.
- Restarting the MCP does not erase a job or receipt; client reconnect reads the same durable state.
- Railway quota exhaustion is checked before box creation; no test deliberately creates a fourth anonymous box.

---

## Tasks

### Task 1: Capture the actual MCP failure hop and runtime envelope

**Files:** `ops-gabriel-ops/docs/operations/MCP_FAILURE_ANALYSIS.md`, `MCP_TOPOLOGY.md`, `MCP_RUNBOOK.md`; add an incident record only if a reproducible operational failure occurs.

- [ ] Capture one safe, representative failing call or a controlled probe at each accessible hop; record UTC time, method/path, payload bytes, concurrency, latency, status, sanitized body, relevant response headers, request IDs, and caller.
- [ ] Correlate the edge `cf-ray`/request ID with Worker, Tailscale origin, MCP, backend/provider logs for the same time window. Record unavailable log sources as evidence gaps.
- [ ] Run the bounded serial/concurrency matrix (1, 2, 5 serial; then 2, 3, 5 concurrent) only while responses remain healthy; stop at first characterized 429, timeout, reset, or restart. Report p50/p95/p99 and status counts; do not repeat a characterized limit.
- [ ] Update the topology and failure analysis with observed client/server/proxy timeouts, retries, auth, lifecycle, and state authority. Label findings confirmed/high-confidence/plausible/unverified.
- [ ] Gate all source-code changes in Tasks 2–3 on the identified emitter or on a demonstrated observability defect at an owned boundary.

**Verification:** Every claimed 429 source has a matching response signature and upstream log, or is marked delimited/unverified. Probe artifacts contain no secrets or claim URL.

### Task 2: Preserve safe cross-layer request identity and response evidence

**Files:** first add tests in the repository that owns the proven failing boundary; likely candidates are `ops-dev-orquestra/integrations/omniroute_mcp/client.py`, `ops-site-ops` edge Worker source, or `ops-gabriel-ops/src/server/app.ts`. Do not change all candidates by default.

- [ ] Add a failing unit test proving that an inbound correlation/request/operation ID is propagated unchanged (or minted once) and returned in structured logs/response metadata.
- [ ] Add a failing 429 test proving the boundary preserves status, sanitized body, `Retry-After`, request ID, and latency without logging bearer/cookie material.
- [ ] Implement only the missing propagation/response-preservation behavior in the proven boundary. Keep the current retry count unchanged (zero where the client has no retry).
- [ ] Add a secret-leak test that feeds representative authorization, cookie, refresh-token, private-key, and Railway claim URL values through the logging/error path and asserts they do not appear.
- [ ] Add counters/timers at that boundary using existing metrics/logging conventions: request/result counts, 429/5xx/timeouts, latency, attempt, and correlation ID.

**Verification:** Focused tests fail before the change and pass after it; root tests and CI pass. Logs for a synthetic failure can be followed using one ID across all instrumented layers.

### Task 3: Apply only evidence-backed MCP reliability correction

**Files:** the exact client, Worker, MCP, backend, or provider file identified by Task 1; corresponding existing test directory. Candidate paths are not a mandate.

- [ ] Add a failing regression for the reproduced mechanism: dropped `Retry-After`, timeout stacking, duplicate mutation after timeout, unbounded fan-out, token refresh race, or another mechanism supported by captured evidence.
- [ ] Implement the narrow correction at the layer responsible. For 429, parse numeric and HTTP-date `Retry-After`; do not retry before the deadline. For ambiguous mutation, call inspect using the same operation ID before deciding what to do. For concurrency, use the existing queue/scheduler or cap its existing entry point rather than creating a parallel queue.
- [ ] Keep retries centralized at the existing authority. If no central retry owner exists for the specific operation, prefer returning a typed retryable error over adding a new retry engine in an MCP handler.
- [ ] Add deterministic fault-injection coverage for the reproduced condition plus 500/502/503, delayed response, dropped connection, malformed response, and expired bearer where the owning code permits it.
- [ ] Update `MCP_RELIABILITY_PLAN.md` with the change, retry budget, rollback, and measured before/after behavior.

**Verification:** Regression reproduces against the pre-change path, passes with the fix, and shows bounded request count. Do not claim unrelated hypotheses were solved.

### Task 4: Compose Railway ephemeral execution through the existing PersistFlow seam

**Files:** `ops-codex-os/persistd/src/start-entrypoint.js`, `persistd/src/persistflow/http-server.js`, `persistd/src/persistflow/service.js`, `persistd/src/fleet/ephemeral-loop.js`, `persistd/src/fleet/railway-anonymous.js`, and focused tests. Touch `ops-persistflow-sandbox` only if its existing provider contract is the verified integration seam.

- [ ] Add a failing composition test that starts PersistFlow with the ephemeral feature disabled and proves current routing/provider behavior is unchanged.
- [ ] Inspect and encode the existing acquisition/operation contract in a contract test; reuse it for both persistent and ephemeral workers. If the only available path is the standalone loop and it cannot be called through the existing PersistFlow service without a second scheduler, stop and document the interface gap before coding.
- [ ] Add a failing durable-checkpoint test: run/task ID, generation, operation ID, selected provider, worker generation, resume checkpoint, and successor/handoff evidence remain inspectable from PersistFlow after client disconnect and process restart.
- [ ] Compose the existing provider and loop behind the existing fleet/provider path with default-off config. Persist state before remote execution; bind the operation to the existing idempotency key; reconnect by inspection, never by re-execution.
- [ ] Add failing tests for G1→G2 (checkpoint, G2 ready, finalize authority/handoff, release G1, resume), successor unavailable (G1 retained), fallback to another eligible existing provider, and exhausted quota (no provider call after the daily budget is spent).
- [ ] Implement only the composition and fallback behavior needed to satisfy those contracts. Do not alter quota limits, provider implementation, or local secret handling.
- [ ] Add a smoke path that reports provider/dependency health without exposing `claimUrl`, and leave production activation disabled pending explicit operational rollout.

**Verification:** `npm --prefix persistd test`, root `npm test`, existing Railway targeted tests, secret regression, and `git diff --check` pass. Test doubles verify quota and successor failure without contacting Railway.

### Task 5: Complete end-to-end lifecycle and operational runbook

**Files:** `ops-gabriel-ops/docs/operations/MCP_RUNBOOK.md`, `MCP_TOPOLOGY.md`, `MCP_FAILURE_ANALYSIS.md`, `MCP_RELIABILITY_PLAN.md`; affected repository tests and workflow definitions.

- [ ] Add end-to-end tests for normal MCP request→backend→receipt; disconnect during a durable job; reconnect/inspect; MCP crash/restart; and timeout after mutation with no duplicate effect.
- [ ] Add assertions for request/operation/run ID continuity, bounded attempts, queue depth/active work if a queue already exists, provider availability, circuit state only if implemented, and health dimensions (process, transport, auth, backend, provider).
- [ ] Verify rollback by disabling the existing/default-off Railway gate and show persistent-provider routing still works.
- [ ] Document exact health commands/endpoints, 429 attribution steps, correlation-ID log searches, retry-storm signals, queue/provider checks, safe restart, and rollback.
- [ ] Run complete affected repo suites and remote CI; record exact counts/results and commits/PRs in the plan/report.

**Verification:** Required cases A–L from the request are either automated with fault injection or explicitly marked blocked by unavailable runtime access; no test creates excess Railway capacity or uses real credentials.

---

## Expected delivery

- Updated factual MCP topology, evidence analysis, reliability plan, and runbook in `ops-gabriel-ops` (currently drafted on PR #69).
- Isolated, reviewed commits in each affected repository; no production deployment or Railway activation until validation and default-off rollout are complete.
- Final report separates confirmed causes from evidence gaps, lists exact test results, deploy/runtime state, feature flag, rollback, residual risks, and PR/commit references.

# Recall Enforcement and Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make controlled agents consult relevant personal/project memory through explicit policy, provenance and degraded-state handling; never claim that the consumer ChatGPT UI can be compelled to invoke its Drive connector.

**Architecture:** Extend the existing `createContextGateway` instance, not a second public context API. A trusted host scheduler/interceptor selects the recall path, captures a retrieval receipt and reports misses/outages; scope cannot come from LLM instructions.

**Tech Stack:** Node.js >=22 <25; reuse `modules/context-gateway`, existing Execution Plane client and Node node:test.

**Spec:** `docs/superpowers/specs/2026-10-15-rag-final-drive-first-design.md` — **OWNER APPROVED FOR SOURCE IMPLEMENTATION; OPERATIONAL GATES REMAIN**, proposed authority change must be accepted before implementation.

**Upstream:** Canonical P05 `docs/superpowers/plans/2026-10-11-p05-hybrid-rag.md` (PR #36, Tasks 1–10). This plan is additive and does not duplicate canonical P05.

## Global Constraints

- STATUS: **Owner-approved for source implementation**. No PR merge, paid spending, live indexing, Android permissions, or production authority change is authorized merely by this plan.
- Reuse the existing `menezes-platform/ops-codex-os` Node context modules and `menezesx2k26-byte/resident-node` Rust indexing runtime; do not fork their contracts.
- No `Engram` hard dependency; no paid model/API, analytics, telemetry or new cloud database without owner approval. Default capture OFF.
- The current approved Spec Kit remains authoritative until explicitly amended; **personal Git Memory remains personal-fact truth; Git remains project truth; PersistFlow remains run truth**.
- Source content, passwords, secret fields and untrusted prompt instructions must never be logged or treated as authority. Private scopes are verified by the runtime, not model text.
- Source/manifest changes use immutable content-addressed records and receipts; derived BM25/FAISS indexes are disposable; no actively open SQLite in Drive-synced directories.
- Write a failing test first. Run RED, implement one small behavior, run GREEN, commit. Do not claim tests, builds, or production gates completed by writing this plan.
- All new paths are **proposed locations**, verified existing paths are distinguished in the program index. Verify current branch/rebase and any existing implementation before creating a file.

## Review Focus

- **Agent proposes to answer from memory while retrieval service is down:** Task 31 returns unavailable and blocks remembered-fact wording. (Review Focus test).
- **Prompt-injected file tries to widen owner/project scope:** Task 30 rejects instructions embedded in evidence. (Review Focus test).
- **Search hit carries valid content but foreign repository:** Task 28 blocks before displaying hit. (Review Focus test).
- **Stale hit labeled current:** Task 29 validates source revision/generation and marks stale. (Review Focus test).
- **Native ChatGPT without automatic connector calls:** Task 32 documents unsupported enforcement instead of faking it. (Review Focus test).

## File Ownership and Cross-Lane Interfaces

- Agent Platform existing `modules/context-gateway/src/index.js` is the single public seam; new policy modules are composed into it. No parallel public gateway.
- Consumes Lane B `MemoryEvidenceV1` and returns `MemoryRecallV1` with explicit `ok|miss|unavailable|denied|stale` status to controlled runtimes.
- Only host-owned adapters can enforce retrieval timing. Consumer ChatGPT native connector activation cannot be guaranteed.

---

### Task 27: Deterministic must-recall decision policy

**Files:**
- Create: `modules/context-gateway/src/recall-trigger-policy.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/recall-trigger-policy.test.js`.

**Interfaces:** `decideRecall({userIntent,availableScopes,historyReferences}) -> {required,lanes,reason}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/recall-trigger-policy.test.js` with named scenario `task_27_contract`; assert **"as we decided" triggers; trivial math does not leak personal corpus; tool failure remains visible**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/recall-trigger-policy.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/recall-trigger-policy.js`, implement `decideRecall({userIntent,availableScopes,historyReferences}) -> {required,lanes,reason}`. Host-controlled classification with tests, not keyword heuristics alone. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/recall-trigger-policy.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 27 deterministic-must-recall-decision-policy"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 28: Gateway personal recall boundary

**Files:**
- Create: `modules/context-gateway/src/personal-recall.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-recall.test.js`.

**Interfaces:** `createPersonalRecall({executionPlaneClient,ownerResolver}).recall({query,filters}) -> MemoryRecallV1`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-recall.test.js` with named scenario `task_28_contract`; assert **model-selected personal scope and foreign owner hits denied**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-recall.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/personal-recall.js`, implement `createPersonalRecall({executionPlaneClient,ownerResolver}).recall({query,filters}) -> MemoryRecallV1`. Keep `createcontextgateway` wrapper as the only agent-facing seam. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-recall.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 28 gateway-personal-recall-boundary"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 29: Citable evidence validation and freshness

**Files:**
- Create: `modules/context-gateway/src/recall-evidence.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/recall-evidence.test.js`.

**Interfaces:** `validateRecallEvidence({hits,manifest,sourceAuthority}) -> MemoryEvidenceV1[]`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/recall-evidence.test.js` with named scenario `task_29_contract`; assert **malformed revision, foreign scope and unverified timestamp rejected**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/recall-evidence.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/recall-evidence.js`, implement `validateRecallEvidence({hits,manifest,sourceAuthority}) -> MemoryEvidenceV1[]`. Return source_ref, generation, retrieved_at and stale status. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/recall-evidence.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 29 citable-evidence-validation-and-freshness"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 30: Untrusted corpus and prompt injection defense

**Files:**
- Create: `modules/context-gateway/src/evidence-sanitizer.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/evidence-sanitizer.test.js`.

**Interfaces:** `sanitizeEvidenceForModel(hits) -> {evidence,promptBoundary}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/evidence-sanitizer.test.js` with named scenario `task_30_contract`; assert **embedded instructions cannot become tool invocation, scope change, or secret exfiltration**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/evidence-sanitizer.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/evidence-sanitizer.js`, implement `sanitizeEvidenceForModel(hits) -> {evidence,promptBoundary}`. Quote corpus as untrusted data; no url follow solely because content says so. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/evidence-sanitizer.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 30 untrusted-corpus-and-prompt-injection-defense"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 31: Miss, outage, stale and fallback result

**Files:**
- Create: `modules/context-gateway/src/recall-status.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/recall-status.test.js`.

**Interfaces:** `normalizeRecallStatus({primary,secondary,policy}) -> MemoryRecallV1`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/recall-status.test.js` with named scenario `task_31_contract`; assert **Drive down and Engram unavailable returns unavailable, never fabricated evidence**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/recall-status.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/recall-status.js`, implement `normalizeRecallStatus({primary,secondary,policy}) -> MemoryRecallV1`. Engram used only when explicitly opted in; no paid requirement. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/recall-status.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 31 miss-outage-stale-and-fallback-result"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 32: Enforcement integration in controlled agents

**Files:**
- Create: `modules/context-gateway/src/recall-enforcer.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/recall-enforcer.test.js`.

**Interfaces:** `enforceRecall({intent,gateway,answerProducer}) -> {answer,receipt}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/recall-enforcer.test.js` with named scenario `task_32_contract`; assert **when required, answerProducer never runs with "memory verified" before recall receipt**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/recall-enforcer.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/recall-enforcer.js`, implement `enforceRecall({intent,gateway,answerProducer}) -> {answer,receipt}`. Host integration contract; document consumer chatgpt native limitation. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/recall-enforcer.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 32 enforcement-integration-in-controlled-agents"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 33: Sanitized retrieval audit and budget

**Files:**
- Create: `modules/context-gateway/src/recall-audit.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/recall-audit.test.js`.

**Interfaces:** `recordRecallAudit({request,receipt}) -> SafeAuditEvent`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/recall-audit.test.js` with named scenario `task_33_contract`; assert **audit contains no query text, private content, tokens or secret-looking fields**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/recall-audit.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/recall-audit.js`, implement `recordRecallAudit({request,receipt}) -> SafeAuditEvent`. Counts/timing/generation/denied markers only, bounded retention. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/recall-audit.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 33 sanitized-retrieval-audit-and-budget"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 34: Agent full-path integration smoke

**Files:**
- Create: `scripts/run-rag-final-recall-smoke.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/rag-final-recall-e2e.test.js`.

**Interfaces:** `runControlledRecallSmoke({driveFixture,indexFixture}) -> receipt`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/rag-final-recall-e2e.test.js` with named scenario `task_34_contract`; assert **real locally rebuilt index + fake credential-free Drive transport recovers old decision; outage degrades**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/rag-final-recall-e2e.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `scripts/run-rag-final-recall-smoke.js`, implement `runControlledRecallSmoke({driveFixture,indexFixture}) -> receipt`. Test happy path, conflict, no hits, cross-scope, and lost index; actual drive smoke in task 42. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/rag-final-recall-e2e.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 34 agent-full-path-integration-smoke"`. Link RED/GREEN commands and SHA in checkpoint.

## Lane Acceptance

- Every task has test evidence, actual SHA and one reviewer gate. Source-only tests do not constitute production acceptance.
- A clean offline end-to-end smoke passes for this lane; a live Drive or Android credential dependency remains separately `BLOCKED` until independently verified.
- No mismatch with the current P05 Spec Kit, no widened project scope, and zero duplicate authority paths.
- Record residual blockers and exact next safe action in the execution checkpoint; hand off to next lane only after accepted contracts.

## Self-review and Execution Handoff

Plan checked for task count, one independent RED/GREEN per task, cross-lane contracts, explicit authority and the five Review Focus cases. **Do not execute until written design/spec is approved and operator chooses native or subagent-driven implementation.**

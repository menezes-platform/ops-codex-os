# Pocket Agent, Recovery and Final DoD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe opt-in Android event source and prove real recoverability, measured resource use and whole-program Definition of Done without inventing native background permissions.

**Architecture:** Android only sends minimally scoped, reviewed event metadata and text captured with ordinary authorized platform APIs. Uses bounded on-device queue and retries; the authoritative event store is Drive through host backend, not phone/Engram. The first usable Drive + desktop/agent path is independent of mobile.

**Tech Stack:** Kotlin Android 16 (Gradle project proposed, Android SDK gated), existing Rust Execution Plane and Node Context Gateway, Drive adapter.

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

- **Android 16 permission revoked mid-capture:** Task 36 stops capture immediately and returns denied. (Review Focus test).
- **Shizuku unavailable while agent is otherwise active:** Task 37 retains manual-only functionality. (Review Focus test).
- **Offline queue crashes between send and receipt:** Task 38 replays with same key and never duplicates. (Review Focus test).
- **Battery/CPU impact on budget device:** Task 40 reports measured impact and a safe disable mode. (Review Focus test).
- **Engram becomes paid, Drive temporarily unavailable:** Task 42 proves memory remains exportable/restorable; outage honest. (Review Focus test).

## File Ownership and Cross-Lane Interfaces

- Pocket Agent Android repo `menezesx2k26-byte/pocket-agent-android` contains only a short README on the inspected default branch; Android package paths here are a **proposed scaffold**, not observed files.
- Owner-approved capture sends Lane A event drafts; Lane C returns retrieval state. Lane D has no authority over Drive events, Git source, private personal facts, or PersistFlow.
- Final release evidence links all previous lanes and existing canonical P05 readiness gates.

---

### Task 35: Pocket Agent application scaffold and privacy UX

**Files:**
- Create: `app/src/main/java/com/menezes/pocketagent/MainActivity.kt` (**menezesx2k26-byte/pocket-agent-android**, proposed file; if already present on target branch, modify instead).
- Test: `app/src/test/java/com/menezes/pocketagent/PrivacyUiTest.kt`.

**Interfaces:** `PrivacyState(enabled=false,allowedSources=emptySet())`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `app/src/test/java/com/menezes/pocketagent/PrivacyUiTest.kt` with named scenario `task_35_contract`; assert **fresh app initializes with capture off and clear permission/empty/denied/success states**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `./gradlew testDebugUnitTest --tests "*PrivacyUiTest*"`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `app/src/main/java/com/menezes/pocketagent/MainActivity.kt`, implement `PrivacyState(enabled=false,allowedSources=emptySet())`. Scaffold kotlin/gradle only on authorized branch; confirm final namespace before merge. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `./gradlew testDebugUnitTest --tests "*PrivacyUiTest*"` (expected PASS), then `./gradlew testDebugUnitTest assembleDebug` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 35 pocket-agent-application-scaffold-and-privacy"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 36: Manual opt-in capture connector

**Files:**
- Create: `app/src/main/java/com/menezes/pocketagent/capture/ManualCapture.kt` (**menezesx2k26-byte/pocket-agent-android**, proposed file; if already present on target branch, modify instead).
- Test: `app/src/test/java/com/menezes/pocketagent/ManualCaptureTest.kt`.

**Interfaces:** `ManualCapture.capture(selectedText, grant) -> Result<MemoryEventDraft>`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `app/src/test/java/com/menezes/pocketagent/ManualCaptureTest.kt` with named scenario `task_36_contract`; assert **no permission, revoked permission and oversized text are rejected locally**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `./gradlew testDebugUnitTest --tests "*ManualCaptureTest*"`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `app/src/main/java/com/menezes/pocketagent/capture/ManualCapture.kt`, implement `ManualCapture.capture(selectedText, grant) -> Result<MemoryEventDraft>`. Explicit user action or supported android share intent; no all-screen recording. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `./gradlew testDebugUnitTest --tests "*ManualCaptureTest*"` (expected PASS), then `./gradlew testDebugUnitTest assembleDebug` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 36 manual-opt-in-capture-connector"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 37: Optional Shizuku adapter with safe fallback

**Files:**
- Create: `app/src/main/java/com/menezes/pocketagent/capture/ShizukuCapture.kt` (**menezesx2k26-byte/pocket-agent-android**, proposed file; if already present on target branch, modify instead).
- Test: `app/src/test/java/com/menezes/pocketagent/ShizukuCaptureTest.kt`.

**Interfaces:** `ShizukuCapture.captureIfAuthorized(grant) -> Result<MemoryEventDraft>`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `app/src/test/java/com/menezes/pocketagent/ShizukuCaptureTest.kt` with named scenario `task_37_contract`; assert **missing Shizuku permission never blocks manual capture and cannot read excluded app**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `./gradlew testDebugUnitTest --tests "*ShizukuCaptureTest*"`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `app/src/main/java/com/menezes/pocketagent/capture/ShizukuCapture.kt`, implement `ShizukuCapture.captureIfAuthorized(grant) -> Result<MemoryEventDraft>`. Do not infer root or bypass private app permissions; disable by default. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `./gradlew testDebugUnitTest --tests "*ShizukuCaptureTest*"` (expected PASS), then `./gradlew testDebugUnitTest assembleDebug` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 37 optional-shizuku-adapter-with-safe-fallback"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 38: Offline encrypted queue and idempotent replay

**Files:**
- Create: `app/src/main/java/com/menezes/pocketagent/sync/OutboundQueue.kt` (**menezesx2k26-byte/pocket-agent-android**, proposed file; if already present on target branch, modify instead).
- Test: `app/src/test/java/com/menezes/pocketagent/OutboundQueueTest.kt`.

**Interfaces:** `OutboundQueue.enqueue(event,ownerKey) / flush(sender) -> SyncReceipt`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `app/src/test/java/com/menezes/pocketagent/OutboundQueueTest.kt` with named scenario `task_38_contract`; assert **crash and duplicate ack resend one idempotency key; queue limit backpressure visible**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `./gradlew testDebugUnitTest --tests "*OutboundQueueTest*"`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `app/src/main/java/com/menezes/pocketagent/sync/OutboundQueue.kt`, implement `OutboundQueue.enqueue(event,ownerKey) / flush(sender) -> SyncReceipt`. Use android keystore-backed encryption; no secrets stored in plain text. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `./gradlew testDebugUnitTest --tests "*OutboundQueueTest*"` (expected PASS), then `./gradlew testDebugUnitTest assembleDebug` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 38 offline-encrypted-queue-and-idempotent-replay"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 39: Cross-device resume and visible sync state

**Files:**
- Create: `app/src/main/java/com/menezes/pocketagent/sync/SyncState.kt` (**menezesx2k26-byte/pocket-agent-android**, proposed file; if already present on target branch, modify instead).
- Test: `app/src/test/java/com/menezes/pocketagent/SyncStateTest.kt`.

**Interfaces:** `SyncState.fromReceipts(local,remote) -> {state,lastVerifiedAt}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `app/src/test/java/com/menezes/pocketagent/SyncStateTest.kt` with named scenario `task_39_contract`; assert **offline/stale/pending/synced differs; no false successful sync**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `./gradlew testDebugUnitTest --tests "*SyncStateTest*"`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `app/src/main/java/com/menezes/pocketagent/sync/SyncState.kt`, implement `SyncState.fromReceipts(local,remote) -> {state,lastVerifiedAt}`. Only after server readback, show attribution and allow owner resync. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `./gradlew testDebugUnitTest --tests "*SyncStateTest*"` (expected PASS), then `./gradlew testDebugUnitTest assembleDebug` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 39 cross-device-resume-and-visible-sync-state"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 40: Device and desktop performance guardrails

**Files:**
- Create: `scripts/evaluate-rag-final-resource-budget.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/rag-final-resource-budget.test.js`.

**Interfaces:** `evaluateBudget(measuredTrace,configuredLimits) -> {pass,metrics}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/rag-final-resource-budget.test.js` with named scenario `task_40_contract`; assert **unmeasured trace cannot claim pass; overloaded queue triggers throttle**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/rag-final-resource-budget.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `scripts/evaluate-rag-final-resource-budget.js`, implement `evaluateBudget(measuredTrace,configuredLimits) -> {pass,metrics}`. Capture actual moto g75 and 8gb windows/wsl traces; choose thresholds with owner. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/rag-final-resource-budget.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 40 device-and-desktop-performance-guardrails"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 41: Backup/restore and disaster recovery rehearsal

**Files:**
- Create: `scripts/rehearse-memory-recovery.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/rag-final-recovery.test.js`.

**Interfaces:** `rehearseRecovery({exportPath,emptyStore,fixtures}) -> {receipt,verified}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/rag-final-recovery.test.js` with named scenario `task_41_contract`; assert **fresh database rebuild retains same evidence identities; corrupted archive fails closed**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/rag-final-recovery.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `scripts/rehearse-memory-recovery.js`, implement `rehearseRecovery({exportPath,emptyStore,fixtures}) -> {receipt,verified}`. Restore on clean temp directory, verify digests, current/previous and tombstones. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/rag-final-recovery.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 41 backup-restore-and-disaster-recovery-rehearsa"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 42: Final live E2E and gated release audit

**Files:**
- Create: `scripts/verify-rag-final-dod.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/rag-final-dod-gate.test.js`.

**Interfaces:** `verifyRagFinalDoD(evidenceManifest) -> {status:"passed"|"blocked",failedChecks}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/rag-final-dod-gate.test.js` with named scenario `task_42_contract`; assert **missing Drive live smoke, consent, Engram-off, cross-scope or rollback proof blocks**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/rag-final-dod-gate.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `scripts/verify-rag-final-dod.js`, implement `verifyRagFinalDoD(evidenceManifest) -> {status:"passed"|"blocked",failedChecks}`. Run full node/rust/android checks, record tool versions, sha, snapshots and non-live limitations. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/rag-final-dod-gate.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 42 final-live-e2e-and-gated-release-audit"`. Link RED/GREEN commands and SHA in checkpoint.

## Lane Acceptance

- Every task has test evidence, actual SHA and one reviewer gate. Source-only tests do not constitute production acceptance.
- A clean offline end-to-end smoke passes for this lane; a live Drive or Android credential dependency remains separately `BLOCKED` until independently verified.
- No mismatch with the current P05 Spec Kit, no widened project scope, and zero duplicate authority paths.
- Record residual blockers and exact next safe action in the execution checkpoint; hand off to next lane only after accepted contracts.

## Self-review and Execution Handoff

Plan checked for task count, one independent RED/GREEN per task, cross-lane contracts, explicit authority and the five Review Focus cases. **Do not execute until written design/spec is approved and operator chooses native or subagent-driven implementation.**

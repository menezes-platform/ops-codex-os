# Drive Episodic Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a consent-gated, Drive-authoritative (after ADR approval) private episodic event stream with audit receipts and complete portable export/import without Engram.

**Architecture:** Use Context Gateway for user-facing contracts and Context Store for validated normalized corpus. Reuse the existing P05 content-addressed corpus adapter; a separate private lane never grants project-corpus access. No active SQLite database is placed in the Drive sync directory.

**Tech Stack:** Node.js >=22 <25 (CommonJS, node:test), Drive authenticated adapter, SHA-256; existing `modules/context-store`.

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

- **Credential-like screen text hidden inside a normal event:** Task 13 blocks persistence and never echoes raw content. (Review Focus test).
- **Same idempotency key with a different payload:** Task 16 rejects conflict, leaves prior bytes intact. (Review Focus test).
- **Drive acknowledges but stored bytes differ:** Task 15 readback rejects and does not publish. (Review Focus test).
- **Changes cursor skips or duplicates entries:** Task 17 reconciles without missing or duplicating. (Review Focus test).
- **Restoring an archive with wrong checksums:** Task 18 aborts import without partial authority transfer. (Review Focus test).

## File Ownership and Cross-Lane Interfaces

- Agent Platform `modules/context-gateway/src/*`: consent, policy, trust/identity — no source-of-truth DB.
- Agent Platform `modules/context-store/src/*`: schemas, immutable Drive corpus writer, versioned exports.
- Reuse `modules/context-store/src/drive-corpus-store.js`, `corpus-manifest.js` patterns; do not reuse project-scoped APIs for personal scope.
- Produces `MemoryEventV1` and `MemoryWriteReceiptV1` for Lane B, and a versioned archive stream for Lane D.

---

### Task 11: Episodic authority migration gate

**Files:**
- Create: `modules/context-gateway/src/episodic-authority-gate.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/architecture-episodic-authority.test.js`.

**Interfaces:** `decideEpisodicAuthority({ownerApproval, rollbackReceipt}) -> "blocked" | "ready"`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/architecture-episodic-authority.test.js` with named scenario `task_11_contract`; assert **without both explicit approval and verified backup returns blocked; other authorities unchanged**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/architecture-episodic-authority.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/episodic-authority-gate.js`, implement `decideEpisodicAuthority({ownerApproval, rollbackReceipt}) -> "blocked" | "ready"`. Document proposed supersession of engram episodic domain; approval and rollback are preconditions, not inferred. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/architecture-episodic-authority.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "docs(rag-final): task 11 episodic-authority-migration-gate"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 12: MemoryEventV1 schema and normalization

**Files:**
- Create: `modules/context-store/src/personal-event-schema.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-event-schema.test.js`.

**Interfaces:** `normalizeMemoryEvent(raw) -> MemoryEventV1`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-event-schema.test.js` with named scenario `task_12_contract`; assert **rejects extra fields, wrong `personal/current`, malformed RFC3339, missing SHA256 and content length > 16 KiB**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-event-schema.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/personal-event-schema.js`, implement `normalizeMemoryEvent(raw) -> MemoryEventV1`. Strict object parsing; trusted identity supplies scope, not llm data. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-event-schema.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 12 memoryeventv1-schema-and-normalization"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 13: Capture policy, consent and secret filter

**Files:**
- Create: `modules/context-gateway/src/personal-capture-policy.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-capture-policy.test.js`.

**Interfaces:** `assessCapture({sourceType, consentReceipt, content}) -> {allowed, reason} | sanitized`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-capture-policy.test.js` with named scenario `task_13_contract`; assert **password-like token, disabled source, revoked receipt, and sensitive app are denied without logging content**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-capture-policy.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/personal-capture-policy.js`, implement `assessCapture({sourceType, consentReceipt, content}) -> {allowed, reason} | sanitized`. Default-deny allowlist, local redaction before any outbound write. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-capture-policy.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 13 capture-policy-consent-and-secret-filter"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 14: Private corpus partition and access identity

**Files:**
- Create: `modules/context-store/src/personal-scope.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-scope.test.js`.

**Interfaces:** `resolvePersonalScope({verifiedOwner, source}) -> "personal/current"`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-scope.test.js` with named scenario `task_14_contract`; assert **unverified owner, `project/...` and model-selected owner ID cannot resolve personal scope**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-scope.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/personal-scope.js`, implement `resolvePersonalScope({verifiedOwner, source}) -> "personal/current"`. Explicitly isolated personal namespace; no widening the project validator. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-scope.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 14 private-corpus-partition-and-access-identity"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 15: Authenticated Drive immutable event transport

**Files:**
- Create: `modules/context-store/src/drive-personal-store.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/drive-personal-store.test.js`.

**Interfaces:** `createDrivePersonalStore({transport}).putEvent({event,idempotency_key}) -> MemoryWriteReceiptV1`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/drive-personal-store.test.js` with named scenario `task_15_contract`; assert **stored bytes are read back and digest verified; mismatched acknowledgement prevents publication**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/drive-personal-store.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/drive-personal-store.js`, implement `createDrivePersonalStore({transport}).putEvent({event,idempotency_key}) -> MemoryWriteReceiptV1`. Reuse p05 blob patterns; actual drive adapter only after approved credential/capability gate. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/drive-personal-store.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 15 authenticated-drive-immutable-event-transport"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 16: Idempotent event append and tombstones

**Files:**
- Create: `modules/context-store/src/personal-event-ledger.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-event-ledger.test.js`.

**Interfaces:** `createPersonalEventLedger({store}).appendOrTombstone(command) -> receipt`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-event-ledger.test.js` with named scenario `task_16_contract`; assert **duplicate same payload replays; conflicting bytes fail; tombstone hides event without resurrecting**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-event-ledger.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/personal-event-ledger.js`, implement `createPersonalEventLedger({store}).appendOrTombstone(command) -> receipt`. Immutable records, owner-approved revoke, no destructive silent overwrite. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-event-ledger.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 16 idempotent-event-append-and-tombstones"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 17: Incremental Drive changes cursor

**Files:**
- Create: `modules/context-store/src/personal-drive-sync.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-drive-sync.test.js`.

**Interfaces:** `syncPersonalChanges({cursorStore,drive,ledger}) -> {cursor,applied}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-drive-sync.test.js` with named scenario `task_17_contract`; assert **out-of-order, repeated and expired cursors converge or trigger verified full reconciliation**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-drive-sync.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/personal-drive-sync.js`, implement `syncPersonalChanges({cursorStore,drive,ledger}) -> {cursor,applied}`. Checkpoint cursor only after manifest and object readback; no content in logs. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-drive-sync.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 17 incremental-drive-changes-cursor"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 18: Portable archive, import and disaster restore

**Files:**
- Create: `modules/context-store/src/personal-archive.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-archive.test.js`.

**Interfaces:** `exportPersonalArchive({ledger}) -> stream; importPersonalArchive({stream,dryRun}) -> receipt`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-archive.test.js` with named scenario `task_18_contract`; assert **roundtrip retained events + tombstones + provenance; corrupt hash rejects before ingest**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-archive.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/personal-archive.js`, implement `exportPersonalArchive({ledger}) -> stream; importPersonalArchive({stream,dryRun}) -> receipt`. Ndjson records + versioned manifest; no proprietary lock-in or engram requirement. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-archive.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 18 portable-archive-import-and-disaster-restore"`. Link RED/GREEN commands and SHA in checkpoint.

## Lane Acceptance

- Every task has test evidence, actual SHA and one reviewer gate. Source-only tests do not constitute production acceptance.
- A clean offline end-to-end smoke passes for this lane; a live Drive or Android credential dependency remains separately `BLOCKED` until independently verified.
- No mismatch with the current P05 Spec Kit, no widened project scope, and zero duplicate authority paths.
- Record residual blockers and exact next safe action in the execution checkpoint; hand off to next lane only after accepted contracts.

## Self-review and Execution Handoff

Plan checked for task count, one independent RED/GREEN per task, cross-lane contracts, explicit authority and the five Review Focus cases. **Do not execute until written design/spec is approved and operator chooses native or subagent-driven implementation.**

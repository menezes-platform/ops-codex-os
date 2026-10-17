# Personal Memory Derivation and Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn consented Drive episodes into temporally grounded, conflict-aware, rebuildable retrieval evidence without promoting speculation or overwriting personal Git Memory.

**Architecture:** Treat event input as untrusted and derive candidate facts only. Separate index `personal/current` from existing Rust ProjectScope. Reuse P04/P05 indexing machinery through a typed personal scope adapter; Drive remains durable corpus, indexes local and disposable.

**Tech Stack:** Existing Node.js context modules and Rust >=1.89 resident-node / SQLite FTS5 / FAISS / pinned offline embeddings from canonical P05.

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

- **Model hallucination presented as long-term preference:** Task 21 leaves candidates unpromoted without explicit review. (Review Focus test).
- **Older assertion conflicts with a recent corrected fact:** Task 22 returns both with temporal precedence rather than silently overwriting. (Review Focus test).
- **Personal events accessed from a project-only query:** Task 23 denies lane crossing. (Review Focus test).
- **Embedding unavailable or corrupt:** Task 24 falls back to scoped BM25 with degraded status. (Review Focus test).
- **Tombstoned record still appears after reindex:** Task 26 asserts deletion across rollback/rebuild. (Review Focus test).

## File Ownership and Cross-Lane Interfaces

- Agent Platform `modules/context-gateway/src/*`: classification, candidate review and temporal policy.
- Resident Node `src/*.rs`: personal scope, materializer, index, read and publication. Reuse verified P04/P05 producer-owned interfaces.
- Consumes Lane A validated event corpus and immutable versioned manifest. Produces `MemoryEvidenceV1` with provenance, generation and tombstone state for Lane C.

---

### Task 19: Evidence classification and durable/source distinction

**Files:**
- Create: `modules/context-gateway/src/personal-event-classifier.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-event-classifier.test.js`.

**Interfaces:** `classifyMemoryEvent(event) -> {class:"episode"|"candidate"|"excluded",reason}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-event-classifier.test.js` with named scenario `task_19_contract`; assert **speculative claims and transient chatter never classify as canonical fact**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-event-classifier.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/personal-event-classifier.js`, implement `classifyMemoryEvent(event) -> {class:"episode"|"candidate"|"excluded",reason}`. Deterministic first-stage rules; optional model enrichment cannot promote. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-event-classifier.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 19 evidence-classification-and-durable-source-di"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 20: Provenance graph and event identity

**Files:**
- Create: `modules/context-store/src/personal-provenance.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-provenance.test.js`.

**Interfaces:** `buildEvidenceRef(event, manifest) -> MemoryEvidenceV1`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-provenance.test.js` with named scenario `task_20_contract`; assert **bad source revision, missing consent receipt or forged SHA fail**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-provenance.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-store/src/personal-provenance.js`, implement `buildEvidenceRef(event, manifest) -> MemoryEvidenceV1`. Preserve source type, file revision, date and integrity chain. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-provenance.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 20 provenance-graph-and-event-identity"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 21: User-reviewed durable fact promotion candidate

**Files:**
- Create: `modules/context-gateway/src/personal-promotion.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal-promotion.test.js`.

**Interfaces:** `preparePromotionCandidate(evidence) -> {draft,requiresReview:true}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal-promotion.test.js` with named scenario `task_21_contract`; assert **does not write private Git Memory or other authority automatically**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/personal-promotion.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/personal-promotion.js`, implement `preparePromotionCandidate(evidence) -> {draft,requiresReview:true}`. Promotion is an explicit suggestion; separate approved git change required. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/personal-promotion.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 21 user-reviewed-durable-fact-promotion-candidat"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 22: Temporal contradiction resolver

**Files:**
- Create: `modules/context-gateway/src/temporal-conflicts.js` (**menezes-platform/ops-codex-os**, proposed file; if already present on target branch, modify instead).
- Test: `tests/temporal-conflicts.test.js`.

**Interfaces:** `resolveConflicts(evidenceList) -> {current,counterevidence,uncertainty}`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/temporal-conflicts.test.js` with named scenario `task_22_contract`; assert **newer user correction supersedes older episodic report without erasing history**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `node --test tests/temporal-conflicts.test.js`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `modules/context-gateway/src/temporal-conflicts.js`, implement `resolveConflicts(evidenceList) -> {current,counterevidence,uncertainty}`. Precedence considers source authority then observation time then verified correction links. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `node --test tests/temporal-conflicts.test.js` (expected PASS), then `npm test && npm run validate:spec-kit` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 22 temporal-contradiction-resolver"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 23: Typed personal scope adapter in Execution Plane

**Files:**
- Create: `src/personal_scope.rs` (**menezesx2k26-byte/resident-node**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal_scope.rs`.

**Interfaces:** `PersonalScope::new(verified_owner: OwnerContext) -> Result<PersonalScope, Error>`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal_scope.rs` with named scenario `task_23_contract`; assert **ProjectScope cannot be cast to personal and personal path cannot load foreign project index**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `cargo test --test personal_scope`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `src/personal_scope.rs`, implement `PersonalScope::new(verified_owner: OwnerContext) -> Result<PersonalScope, Error>`. Rust domain type separate from `projectscope`; backed by authenticated runtime owner. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `cargo test --test personal_scope` (expected PASS), then `cargo test` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 23 typed-personal-scope-adapter-in-execution-pla"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 24: Materialize a personal hybrid index

**Files:**
- Create: `src/personal_index.rs` (**menezesx2k26-byte/resident-node**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal_index.rs`.

**Interfaces:** `build_personal_index(snapshot: PersonalCorpusSnapshot, profiles: IndexProfiles) -> Result<IndexReceipt, Error>`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal_index.rs` with named scenario `task_24_contract`; assert **BM25 + FAISS fixture returns real indexed event; invalid embedding degrades explicitly**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `cargo test --test personal_index`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `src/personal_index.rs`, implement `build_personal_index(snapshot: PersonalCorpusSnapshot, profiles: IndexProfiles) -> Result<IndexReceipt, Error>`. Reuse p04/p05 routines, pin models and no automatic model download. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `cargo test --test personal_index` (expected PASS), then `cargo test` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 24 materialize-a-personal-hybrid-index"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 25: Time-aware personal retrieval

**Files:**
- Create: `src/personal_retrieval.rs` (**menezesx2k26-byte/resident-node**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal_retrieval.rs`.

**Interfaces:** `retrieve_personal(query: PersonalQuery, generation: GenerationRef) -> Result<PersonalHits, Error>`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal_retrieval.rs` with named scenario `task_25_contract`; assert **filters after/before and tombstone/current state exclude disallowed evidence**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `cargo test --test personal_retrieval`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `src/personal_retrieval.rs`, implement `retrieve_personal(query: PersonalQuery, generation: GenerationRef) -> Result<PersonalHits, Error>`. Bounded topk, source authority, observed_at and generation attached. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `cargo test --test personal_retrieval` (expected PASS), then `cargo test` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 25 time-aware-personal-retrieval"`. Link RED/GREEN commands and SHA in checkpoint.

### Task 26: Rebuild, rollback and delete correctness

**Files:**
- Create: `src/personal_generation.rs` (**menezesx2k26-byte/resident-node**, proposed file; if already present on target branch, modify instead).
- Test: `tests/personal_generation.rs`.

**Interfaces:** `reconcile_personal_generation(input: PersonalCorpusSnapshot, expected: GenerationRef) -> Result<GenerationReceipt, Error>`. Inputs are validated platform-owned records from the approved design; do not expose provider SDK types.

- [ ] **Step 1 — RED:** Add `tests/personal_generation.rs` with named scenario `task_26_contract`; assert **tombstone removed from current; bad new generation preserves previous; clean rebuild equivalent**. Include a negative boundary case and avoid recording raw private fixture contents.
- [ ] **Step 2 — Verify failure:** Run `cargo test --test personal_generation`. Expected: **FAIL** because the new behavior/contract is absent (not because the test runner is missing). If tooling is unavailable, mark `BLOCKED` and keep reproducible evidence instead of claiming RED.
- [ ] **Step 3 — Implement:** In `src/personal_generation.rs`, implement `reconcile_personal_generation(input: PersonalCorpusSnapshot, expected: GenerationRef) -> Result<GenerationReceipt, Error>`. Reuse current/previous cas / idempotency from p05; no local index as authority. Reuse earlier lane contracts; do not introduce a competing authority.
- [ ] **Step 4 — GREEN + regression:** Rerun `cargo test --test personal_generation` (expected PASS), then `cargo test` (expected PASS). On unavailable SDKs/service, split offline deterministic checks from explicitly blocked live tests.
- [ ] **Step 5 — Commit:** Stage only this task's implementation, tests and narrowly required docs; `git commit -m "feat(rag-final): task 26 rebuild-rollback-and-delete-correctness"`. Link RED/GREEN commands and SHA in checkpoint.

## Lane Acceptance

- Every task has test evidence, actual SHA and one reviewer gate. Source-only tests do not constitute production acceptance.
- A clean offline end-to-end smoke passes for this lane; a live Drive or Android credential dependency remains separately `BLOCKED` until independently verified.
- No mismatch with the current P05 Spec Kit, no widened project scope, and zero duplicate authority paths.
- Record residual blockers and exact next safe action in the execution checkpoint; hand off to next lane only after accepted contracts.

## Self-review and Execution Handoff

Plan checked for task count, one independent RED/GREEN per task, cross-lane contracts, explicit authority and the five Review Focus cases. **Do not execute until written design/spec is approved and operator chooses native or subagent-driven implementation.**

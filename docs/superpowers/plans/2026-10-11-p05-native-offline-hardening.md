# P05 Native Offline Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the P05 hybrid RAG as far as demonstrably possible through offline source, test, benchmark, and rollback-readiness work without connecting to Hostinger, altering production, or claiming P05 exit.

**Architecture:** Keep Agent Platform Context Gateway/Store as the Node.js API and manifest owner, and resident-node as the Rust Execution Plane using SQLite FTS5 BM25 + genuine CPU FAISS + pinned offline embeddings. Materialize Drive-origin corpora through an injected, project-scoped transport and publish immutable generations through a verified, primary-owned atomic current/previous CAS, not through Drive file overwrites.

**Tech Stack:** Node.js >=22 <25, CommonJS + node:test; Rust/Cargo and existing resident-node crate; SQLite FTS5; native FAISS CPU; pinned ONNX MiniLM 384-dimensional profile only after artifact qualification; SHA-256 and content-addressed manifests.

**Spec:** docs/superpowers/specs/2026-10-02-platform-consolidation-design.md; frozen docs/architecture/spec-kit/{07-migration-phases,08-architecture-gates,09-rollout-rollback,10-acceptance-criteria,12-executor-contract}.md.

**Parent plan:** docs/superpowers/plans/2026-10-11-p05-hybrid-rag.md (draft PR #36). This is a complementary offline EXECUTION HARDENING plan, not a replacement for the ten canonical P05 tasks. The Task numbers below are offline work packages (O1–O10), mapped to the canonical P05 tasks. Canonical P05 Task 10 remains runtime acceptance and cutover.

## Global Constraints

- **Frozen Spec Kit wins.** Do not modify the Spec Kit or fabricate gate evidence to make tests pass. P03 and P04 formal exits are not proven, so allow reviewable source preparation only; no production or P05 PASSED.
- **Account isolation:** PersistFlow Sandbox is on the Conthabil Hostinger account. MCP Remote is on the Menezesx2k25 account. They are separate systems; an MCP run lookup never proves PersistFlow health.
- **No credentials, production mutations, deployment, merge, paid agents, new paid CI or external Hostinger actions** without separate explicit authorization. No RAGFlow/Hindsight promotion.
- **Native execution chosen already.** Use superpowers:executing-plans; write a durable ledger, execute one work package at a time, and do not repeatedly request authorization for reversible source-only changes. Do not claim background execution after this session.
- **Source truth:** before writing, refetch PR #32 (Agent Platform P05), PR #37 (Native Node preparation) and resident-node PR #1 (P04 Rust); use their actual HEAD SHAs. No assuming draft code is on main. Keep repo commits and PRs isolated. Never silently overwrite another branch.
- **Reuse first:** PR #32 has corpus manifest, planning and generation policy; PR #37 has Gateway transport guards and an evaluator that replays supplied traces; P04 Rust PR #1 has chunking, SQLite FTS5 BM25, indexing_runtime.rs traits. Do not implement a second fake FAISS or a second Context Store/Execution Plane client.
- **Toolchain diagnosis is its own gate.** This chat's container has Node v22.16.0 but no Cargo. Check for an existing authorized Rust runner; do not equate a failed Cargo command with a code failure. If no executable Rust toolchain can be obtained without new cost/security actions, commit tests/source as clearly UNVERIFIED or proceed with independent runnable Node work. Never print a fictional RED/GREEN Cargo result.
- **Two lane statuses:** each work package records SOURCE_PREPARED, TESTED_OFFLINE, or RUNTIME_QUALIFIED, with actual commands and SHA. A green mocked test is not runtime qualification.
- **Data boundaries:** per-project scope is authenticated upstream, multi-project retrieval is explicit allowlist only; immutable SHA-256 manifests, safe relative paths, no source secrets in logs, no unlocked publication, no cross-project lexical fallback.
- **Preserve branch safety:** use an isolated worktree if available; do not merge, delete, rebase another author's branch or mutate live indexes. Every source change uses a failing test first and a local commit on a dedicated branch.

## File Structure and Responsibilities

**Resident Node (menezesx2k26-byte/resident-node):** src/indexing_runtime.rs and src/lib.rs remain trait/composition owners; src/drive_corpus.rs reads validated corpus bytes; src/local_embeddings.rs pins offline model/profile; src/faiss_index.rs owns native vector artifact; src/generation_store.rs owns CAS and durable receipts; src/retrieval.rs owns scoped hybrid RRF; src/index_update.rs owns rebuild/delta orchestration. One focused tests/*.rs file per feature, named below. Existing src/bm25.rs remains authoritative BM25.

**Agent Platform (menezes-platform/ops-codex-os):** modules/context-store/src/corpus-manifest.js remains manifest source of truth; clients/execution-plane/v1/client.js remains transport; modules/context-gateway/src/index.js remains scope boundary; scripts/evaluate-p05-retrieval.js remains trace analysis, not a retriever. Extend tests/p05-*.test.js and tests/fixtures/p05-retrieval/ only with source-pinned evidence. Do not silently repurpose the existing handcrafted synthetic fixture as live evidence.

## Review Focus — failure inputs the code must withstand

1. **Changed payload with repeated idempotency key**: generation_store test same_key_changed_payload_rejected confirms no second publication or pointer mutation.
2. **Foreign-scope/traversal or malicious corpus refs**: drive_corpus test rejects_foreign_or_traversal_corpus_before_read confirms transport is never called.
3. **Crash after writing immutable candidate but before current/previous CAS**: generation_store test crash_before_cas_preserves_current confirms old current survives replay and clean recovery.
4. **FAISS dimension/profile artifact disagrees with matching BM25**: hybrid_retrieval test rejects_mixed_profile_or_dimension confirms fail-closed, zero cross-project fallback.
5. **Old contradictory source ranks above current Git source**: benchmark test prefers_current_revision_with_contradictions fails the temporal gate and records source refs rather than claiming fresh evidence.

---

### Task 1 (O1): Evidence, source pinning and executable baseline — canonical P05 Task 1

**Files:** Add docs/architecture/execution-checkpoints/YYYY-MM-DD-P05-native-offline-baseline.md; reuse existing scripts/validate-p05-entry.js; NO frozen Spec Kit edits.

**Interfaces:** Consumes three exact PR HEADs, status of authoritative gates, and current Node/Rust toolchains. Produces immutable pinned refs, evidence status and runnable commands.

- [ ] Step 1 — RED: test that an incomplete P03/P04 evidence object cannot mark P05 as passed; additionally detect missing refs and wrong GitHub account mapping before marking a baseline verified.
- [ ] Step 2 — Verify RED: node --test tests/p05-entry-gate.test.js for new assertion, expected failure on omitted evidence guard. If tests already cover the behavior, do not invent a failing result; record reuse.
- [ ] Step 3 — Fetch current PR SHAs, verify Node baseline, attempt cargo --version, find only authorized existing Rust runners, record exact errors and worktree/lockfile source identity.
- [ ] Step 4 — Verify GREEN: node --test tests/p05-entry-gate.test.js, npm test, npm run validate:spec-kit and cargo test --all-features when actually runnable; record individual PASS, FAIL or ENV_BLOCKED without collapsing into one success flag.
- [ ] Step 5 — Commit checkpoint and new tests: git commit -m "test(p05): pin offline Native entry and environment evidence".

### Task 2 (O2): Isolated Drive corpus adapter — canonical P05 Task 2

**Files:** Resident Node create src/drive_corpus.rs and tests/drive_corpus.rs; modify src/lib.rs.

**Interfaces:** Implements CorpusMaterializer::materialize(&ProjectScope, &str) -> Result<CorpusSnapshot, IndexingError> through DriveCorpusMaterializer::new(config: DriveCorpusConfig, transport: Arc<dyn CorpusObjectTransport>) -> Result<Self, IndexingError>. Transport accepts exact scope, revision and content digest, never arbitrary filesystem paths.

- [ ] Step 1 — RED tests materializes_only_requested_project_and_revision, rejects_foreign_or_traversal_corpus_before_read, rejects_digest_mismatch_without_partial_snapshot and rejects_secret_markers_and_unapproved_source_kind. Assert zero transport calls after validation failure.
- [ ] Step 2 — Verify RED: cargo test --test drive_corpus; expected unresolved adapter if toolchain exists. Without Cargo, mark ENV_BLOCKED rather than saying the test failed correctly.
- [ ] Step 3 — Implement strict project-scoped content-addressed materialization with SHA-256 validation, manifest revision comparison and no Drive-sync-root active SQLite.
- [ ] Step 4 — Verify GREEN: cargo test --test drive_corpus && cargo test --test indexing_runtime, with in-memory transport and no private content in logs. No actual Drive credentials necessary.
- [ ] Step 5 — Commit: git add src/drive_corpus.rs src/lib.rs tests/drive_corpus.rs && git commit -m "feat(p05): materialize scoped immutable corpus".

### Task 3 (O3): Pinned offline embeddings — canonical P05 Task 3

**Files:** Resident Node create src/local_embeddings.rs and tests/local_embeddings.rs; modify src/lib.rs, Cargo.toml and Cargo.lock only as required.

**Interfaces:** Implements LocalEmbedder::embed(&self, profile: &str, chunks: &[IndexChunk]) -> Result<Vec<Vec<f32>>, IndexingError>; creates PinnedLocalEmbedder::new(model_dir: &Path, expected_sha256: &str, profile: &str) -> Result<Self, IndexingError> and embed_query(&self, profile: &str, query: &str) -> Result<Vec<f32>, IndexingError>.

- [ ] Step 1 — RED tests rejects_unknown_profile_or_model_hash, produces_384_finite_document_vectors, same_text_yields_repeatable_query_vector, refuses_implicit_network_model_download.
- [ ] Step 2 — Verify RED: cargo test --test local_embeddings; expected missing adapter/query inference, not a false model-download exception.
- [ ] Step 3 — Use an explicit versioned local-minilm-l6-v2@v1 ONNX adapter; pin REAL, observed model/tokenizer SHA-256 digests only after obtaining authorized files; forbid serving-time downloads and reject nonfinite/wrong-dimension results.
- [ ] Step 4 — Verify GREEN: cargo test --test local_embeddings with injected in-memory session; separately mark actual model inference UNQUALIFIED if pinned artifacts are missing. Do not claim 384D real inference from stubs.
- [ ] Step 5 — Commit: git add src/local_embeddings.rs tests/local_embeddings.rs src/lib.rs Cargo.toml Cargo.lock && git commit -m "feat(p05): pin offline embedding profile".

### Task 4 (O4): Real native FAISS backend — canonical P05 Task 5

**Files:** Resident Node create src/faiss_index.rs and tests/faiss_index.rs; extend the existing FaissIndexBackend trait in src/indexing_runtime.rs only as needed.

**Interfaces:** Reuse build_index(...) and validate_index(FaissIndexValidation); add search_index(&self, artifact: &IndexArtifactRef, scope: &ProjectScope, profile: &str, vector: &[f32], limit: usize) -> Result<Vec<VectorHit>, IndexingError>. VectorHit returns chunk ID, score, revision and provenance, not authorization.

- [ ] Step 1 — RED tests writes_immutable_project_scoped_flat_index, rejects_foreign_scope_or_profile, rejects_mixed_profile_or_dimension, returns_nearest_neighbors_in_score_order, cannot_read_symlink_or_unapproved_directory.
- [ ] Step 2 — Verify RED: cargo test --test faiss_index; record native-linker error as an environment failure, not proof a regression test caught behavior.
- [ ] Step 3 — Implement CPU FAISS Flat index, dimension/profile/sha checks and immutable project-scoped artifact. If native library unavailable, keep backend nonfunctional and document it; do NOT silently substitute cosine JSON arrays and call them FAISS.
- [ ] Step 4 — Verify GREEN: cargo test --test faiss_index && cargo test --test indexing_runtime. Record supported OS/architecture. Windows and Linux native binaries need separate qualification.
- [ ] Step 5 — Commit: git add src/faiss_index.rs src/indexing_runtime.rs src/lib.rs tests/faiss_index.rs Cargo.toml Cargo.lock && git commit -m "feat(p05): add real FAISS artifact backend".

### Task 5 (O5): Durable two-slot CAS and recovery — canonical P05 Task 4

**Files:** Resident Node create src/generation_store.rs and tests/generation_store.rs; integrate existing IndexGenerationPublisher in src/indexing_runtime.rs.

**Interfaces:** DurableGenerationStore::apply(plan: GenerationPlan) -> Result<GenerationReceipt, IndexingError>; plan consumes scope, operation, idempotency_key, expected_current_generation, expected_previous_generation, candidate current/previous and immutable manifest digest. Uses a single writer and a durable SQLite transaction, NEVER Drive overwrite as CAS.

- [ ] Step 1 — RED tests publishes_with_exact_two_slot_compare_and_swap, same_key_changed_payload_rejected, crash_before_cas_preserves_current, restart_replays_receipt_without_second_publish and rollback_swaps_only_verified_pair.
- [ ] Step 2 — Verify RED: cargo test --test generation_store; record absence of adapter or transaction guard as observed reason.
- [ ] Step 3 — Implement replay-safe atomic transaction: verify immutable artifact first; bind both slot generations and plan hash to idempotency key; commit pair + receipt together; keep old current valid through crash and rollback.
- [ ] Step 4 — Verify GREEN: cargo test --test generation_store and restart/fault-injection tests, plus Node generation-policy tests from PR #32. No single-process mutex or Drive upload is acceptable proof of atomicity.
- [ ] Step 5 — Commit: git add src/generation_store.rs src/indexing_runtime.rs tests/generation_store.rs && git commit -m "feat(p05): durable two-slot index CAS".

### Task 6 (O6): Hybrid BM25 + FAISS retrieval — canonical P05 Task 6

**Files:** Resident Node create src/retrieval.rs and tests/hybrid_retrieval.rs; reuse src/bm25.rs and FAISS backend.

**Interfaces:** HybridRetriever::recall(&self, scope: &ProjectScope, query: &str, filters: &RetrievalFilters, limit: usize) -> Result<Vec<RetrievedEvidence>, IndexingError>; public filters only source_types, revision, after, before. Use reciprocal rank fusion RRF(k=60), limit in 1..=100, deterministic tie-break by evidence ID.

- [ ] Step 1 — RED tests fusion_is_deterministic_for_equal_scores, retrieval_enforces_scope_and_filters_before_results, no_hits_returns_empty_not_fabricated_evidence, rejects_mixed_profile_or_dimension, faiss_failure_falls_back_to_scoped_bm25_only_when_allowed.
- [ ] Step 2 — Verify RED: cargo test --test hybrid_retrieval; expected missing retriever behavior.
- [ ] Step 3 — Resolve VERIFIED current generation, run same-scope BM25 + query-embedding + FAISS, merge by RRF; allow explicit lexical_fallback only on the verified same scope/revision. Preserve source revision and path.
- [ ] Step 4 — Verify GREEN: cargo test --test hybrid_retrieval && cargo test --test bm25_index && cargo test --test faiss_index. Assert zero cross-project or stale-as-current hits.
- [ ] Step 5 — Commit: git add src/retrieval.rs src/lib.rs tests/hybrid_retrieval.rs && git commit -m "feat(p05): scoped hybrid RRF retriever".

### Task 7 (O7): Incremental rebuild and deletion — canonical P05 Task 7

**Files:** Resident Node create src/index_update.rs and tests/index_update.rs; reuse JS corpus planning from PR #32 and Rust indexing runtime.

**Interfaces:** IndexUpdateCoordinator::apply(&self, request: &IndexingRequest, delta: &CorpusDelta) -> Result<IndexingReceipt, IndexingError>. CorpusDelta accepts rebuild/incremental/metadata_only/noop and exact immutable manifest/profile IDs.

- [ ] Step 1 — RED tests changed_doc_reindexes_without_reusing_removed_chunk, unchanged_docs_keep_deterministic_identity, profile_change_forces_full_rebuild, delete_document_removes_hits_in_next_generation, noop_does_not_publish_generation, can_rebuild_after_deleting_derived_indexes.
- [ ] Step 2 — Verify RED: cargo test --test index_update.
- [ ] Step 3 — Implement immutable candidate building, safe unchanged-chunk reuse and forced rebuild on any profile change. No publication on noop, never delete last verified current/previous before candidate verification.
- [ ] Step 4 — Verify GREEN: cargo test --test index_update && cargo test --test indexing_runtime; replay failure must leave previous generation intact.
- [ ] Step 5 — Commit: git add src/index_update.rs src/indexing_runtime.rs tests/index_update.rs && git commit -m "feat(p05): incremental and full rebuild".

### Task 8 (O8): Gateway integration and wire compatibility — canonical P05 Task 8

**Files:** Agent Platform modify clients/execution-plane/v1/client.js and modules/context-gateway/src/index.js only where actual contract drift is proven; add tests/context-gateway-p05-integration.test.js. Reuse existing PR #37 tests.

**Interfaces:** createExecutionPlaneClient({baseUrl, fetchImpl, capabilityProvider}), retrieve({scope,query,filters}), indexProject({scope,revision,idempotency_key}); createContextGateway({executionPlaneClient,resolveProjectScope,allowlistedMultiProjectScopes}). Do not add duplicate transport or model-controlled endpoint.

- [ ] Step 1 — RED tests recall_uses_trusted_workspace_scope_only, rejects_cross_project_and_unknown_revision_results, rejects_unversioned_or_malformed_receipts, does_not_leak_api_key_or_raw_provider_types, fails_closed_when_execution_plane_unavailable, explicit_multi_project_is_allowlisted_only.
- [ ] Step 2 — Verify RED: node --test tests/context-gateway-p05-integration.test.js; expected one actual unimplemented composition assertion, not a missing unrelated dependency.
- [ ] Step 3 — Adapt only mismatching producer/client v1 fields, bound request size/timeouts and sanitize response provenance. If Rust wire producer is not executable, use explicit contract fixtures, label integration SOURCE_ONLY.
- [ ] Step 4 — Verify GREEN: node --test tests/context-gateway-p05-integration.test.js && npm test && npm run validate:spec-kit, with exact output and source SHA.
- [ ] Step 5 — Commit: git add clients/execution-plane/v1/client.js modules/context-gateway/src/index.js tests/context-gateway-p05-integration.test.js && git commit -m "test(p05): prove scoped gateway composition".

### Task 9 (O9): Measured, pinned benchmark — canonical P05 Task 9

**Files:** Agent Platform extend scripts/evaluate-p05-retrieval.js, tests/p05-retrieval-benchmark.test.js and tests/fixtures/p05-retrieval; Resident Node create tests/retrieval_adversarial.rs for real Rust producer evidence.

**Interfaces:** compareReplayReports(baseline,candidate) requires same pinned corpus/questions/profiles; evaluateReplay(fixture,trace) reports hit_rate, P@5, R@5, MRR, temporal_accuracy, contradiction_ordering, latency p50/p95, source revision, context size and leakage count. Existing handcrafted lane synthetic_fixture is NOT an observed BM25 or FAISS benchmark.

- [ ] Step 1 — RED tests prefers_current_revision_with_contradictions, foreign_project_docs_never_hit, empty_corpus_never_claims_positive_recall, benchmark_replays_pinned_question_set, benchmark_distinguishes_offline_and_live_lanes; Rust RED test retrieval_adversarial on actual backend.
- [ ] Step 2 — Verify RED: node --test tests/p05-retrieval-benchmark.test.js and cargo test --test retrieval_adversarial (only claim observed results when executed).
- [ ] Step 3 — Capture real BM25-only vs hybrid ranked hits against the SAME pinned public 39-chunk/10-query pilot + second project; use instrumented runtime latency rather than fake numbers. If real producer unavailable, retain pure evaluation tests and declare measured_quality UNAVAILABLE.
- [ ] Step 4 — Verify GREEN: node tests + cargo tests + explicit CLI replay; release requires ZERO cross-project leakage, no stale source presented as current, and no quality regression from measured BM25 baseline.
- [ ] Step 5 — Commit separately to both repositories, including exact corpus commit and redacted evidence; never relabel the synthetic fixture as observed.

### Task 10 (O10): No-Hostinger offline handoff gate — NOT canonical P05 runtime Task 10

**Files:** Agent Platform add docs/architecture/execution-checkpoints/YYYY-MM-DD-P05-offline-handoff.md and a concise next-safe-action README; Resident Node add matching source/testing evidence note.

**Interfaces:** Consumes O1–O9 independently tested results, commit SHAs, known build matrix and rollback simulation evidence; produces report with a per-task status, commands, exact outputs, gated missing items and minimum requirements to reconnect Conthabil deployment.

- [ ] Step 1 — RED: source/test contract rejects a fabricated P05 PASSED when Cargo, actual model, FAISS or authenticated runtime evidence is absent.
- [ ] Step 2 — Verify RED: node --test tests/p05-entry-gate.test.js with the new failing fixture; no false completion from mocks.
- [ ] Step 3 — Capture all observed Node/Rust compile/test/benchmark evidence, open PRs, non-secret hashes and list missing infrastructure details. Classify each task SOURCE_PREPARED, TESTED_OFFLINE, or RUNTIME_QUALIFIED.
- [ ] Step 4 — Verify GREEN: run every available full suite, diff --check, code review, exact HEAD readbacks and architecture scan. Any environment-dependent assertion remains UNVERIFIED.
- [ ] Step 5 — Commit handoff, leave code PRs draft, do not merge or cut over. Only canonical P05 Task 10 may later perform authorized live acceptance.

## Recovery and Continuation Contract

The executing agent must keep a durable per-plan ledger in the plan-owned Superpowers workspace when a real worktree exists, plus concise versioned project checkpoint after each meaningful tested commit. On context resets, read ledger and git log, verify remote heads, and resume the first incomplete task; never redo commits based on recalled progress. Every reported test result names its exact command, runtime, exit code and source revision. If Rust tests are blocked, progress on independent Node tasks or new reviewable test fixtures instead of simply ending. If no honest executable work remains, stop with the exact missing capability and the minimum safe action, not a claim of completion.

## Self-review and execution handoff

Checked against frozen P05 requirements: Drive corpus, versioned manifests, local BM25 + FAISS, pinned embeddings, incremental rebuild, atomic current/previous rollback, source provenance, zero leakage, deterministic benchmark and reversible cutover. The last item is intentionally outside this offline plan. Source/digest identities are never guessed. Inter-task dependency chain: O2 + O3 + O4 + O5 -> O6 -> O7 -> O8 -> O9 -> O10; O8 Node contract tests can advance independently of the Rust implementation. Five Review Focus conditions map to the owning task's RED test. The reference 39-chunk/10-query pilot is a baseline, not evidence of deployed hybrid effectiveness.

**Review request:** This document hardens the previously approved Native method. The original P05 plan and its approval remain valid; review this supplemental offline scope before continuing implementation under it.

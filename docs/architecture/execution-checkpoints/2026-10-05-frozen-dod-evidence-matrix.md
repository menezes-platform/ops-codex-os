# Frozen DoD evidence matrix — 2026-10-05

- `checkpoint_id`: `DOD-EVIDENCE-MATRIX-2026-10-05T03:15:09Z`
- `recorded_at`: `2026-10-05T03:15:09Z`
- `github_check_status_observed_at`: `2026-10-05T03:12:57Z`
- `source_of_truth`: frozen [`11-definition-of-done.md`](../spec-kit/11-definition-of-done.md) at Agent Platform `main` `f4e31b4897f9fc4bf6c9bc8cf743c8cf712693b8`
- `frozen_spec`: `unchanged`
- `overall_DoD`: `NOT_MET`
- `P12`: `PRE_AUDIT_ONLY`
- `scope`: evidence triage and offline preparation; no production mutation, deletion, archive, cutover, or gate override

## Status semantics

- `NOT_MET`: available evidence affirmatively shows the target has not been achieved or the required operation has not occurred.
- `PARTIAL`: some source, CI, or runtime evidence exists, but it proves only a subset of the criterion.
- `UNRESOLVED`: the available evidence cannot establish the criterion, or known candidate paths prevent a zero-count claim.
- `TARGET_ONLY`: the frozen architecture specifies the desired end state, but no implementation or runtime proof was observed.

No row is `PASS`. A passing unit/CI result or a healthy endpoint is not a substitute for the end-to-end, production, migration, deletion, or rollback evidence demanded by the criterion.

## Repository and module end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| `ops-codex-os` completes transition to Agent Platform identity/responsibility | `PARTIAL` | Frozen architecture is maintained here and draft PRs #30/#31 prepare policy/checkpoints. Merge, operational ownership, and end-state audit are absent. |
| `resident-node` completes transition to Execution Plane identity/responsibility | `PARTIAL` | Draft PR #1 prepares a source-level worker fence and its CI is green on three OSes; `main` and runtime responsibility have not completed the transition. |
| `ops-dev-orquestra` is archived | `NOT_MET` | P08 inventory records active `main` and open PRs. No preservation receipt or archive evidence exists. |
| `ops-persistflow-sandbox` is archived | `NOT_MET` | P08 inventory records active `main` and a large open draft PR. No zero-dependency proof or archive evidence exists. |
| `ops-gabriel-ops` remains active only as observability + command console | `UNRESOLVED` | P07 source audit identifies state writers and host-command/business workflows; installed runtime callers and complete accepted command boundary are not established. |
| Private `Memory` remains active only as canonical personal context | `UNRESOLVED` | Repository/ref inventory exists, but no complete authority/consumer audit proves this restricted role. |
| Global architecture authority lives under Agent Platform `docs/architecture/` | `PARTIAL` | Frozen target docs exist in this repository; no final cross-repository authority registry or adoption proof exists. |

## Authority end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| Every durable domain has exactly one declared authoritative writer | `UNRESOLVED` | P03/P07/P08 checkpoints identify multiple candidate state paths; no complete domain-to-writer registry with runtime validation exists. |
| Duplicate authority paths = 0 | `UNRESOLVED` | Global caller/writer census and duplicate-authority verification are incomplete. |
| Gabriel Ops authoritative state writers = 0 | `UNRESOLVED` | P07 audit PR #82 is draft/source-level; identified campaign/business writers, local queue candidate, scheduled private-source projection task, and live configurations have not been exhaustively reconciled. No writer was removed. |
| Agent Platform operational authority stores = 0 | `UNRESOLVED` | No full production storage/caller scan proves the zero count. Resident Node `main` contains SQLite/WAL state, and its authority classification/cutover is unresolved. |
| Retrieval indexes own no truth | `PARTIAL` | `memory-cognition` returns derived candidates and its RAGFlow adapter has no canonical-write capability; this does not audit all deployed indexes or producers. |
| Semantic/exact model cache owns no truth | `PARTIAL` | Orquestra source describes exact `serve`, semantic `shadow`, and promotion disabled; no live host/config/data-path validation establishes zero authority. |
| Engram does not override Git/Memory/PersistFlow/runtime evidence | `TARGET_ONLY` | No precedence audit or adversarial verification evidence was recorded. |

## Interface end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| All production callers use approved producer-owned interfaces | `UNRESOLVED` | P08 caller inventory is explicitly incomplete; the global production caller census is missing. |
| Agent Platform has no direct PersistFlow SQLite/WAL/filesystem access | `UNRESOLVED` | No complete source + deployed-process/config scan proves zero access paths. |
| Platform-owned model calls bypassing Provider Gateway = 0 | `NOT_MET` | Frozen Agent Platform `main` at `f4e31b4897f9fc4bf6c9bc8cf743c8cf712693b8` still contains the direct TypeSafe fleet-scoring path (`persistd/src/fleet/typesafe-router.js`), composed when `PERSISTFLOW_FLEET_ROUTER_ENABLED=1`. Draft PR #30 removes that direct caller from its branch and falls back unless an injected Provider Gateway exists, but it is not merged or deployed and has no production Gateway composition. Gabriel Ops also has configured direct routes; ownership and live use remain unresolved. |
| Framework/vendor-specific types in public platform interfaces = 0 | `UNRESOLVED` | No exhaustive public-interface scan or gate result was recorded. |
| Project scope is deterministic | `PARTIAL` | `memory-cognition` canonicalizes explicit repository scope and rejects unallowlisted projects in tests; this is not the final Context Gateway contract or production proof. |
| Normal retrieval never widens scope implicitly | `PARTIAL` | Scope-bound provider tests and RAGFlow dataset/repository filtering exist; one-index-only enforcement in the target runtime is unverified. |

## Retrieval end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| Context Store is Drive-backed with normalized corpus + provenance/manifests | `PARTIAL` | P03 migration branch contains a Context Store interface and current/previous manifest schema; draft [P05 prep PR #32](https://github.com/menezes-platform/ops-codex-os/pull/32) adds source-level generation planning. No Drive driver or deployed corpus proof exists. Four targeted Drive metadata searches returned no results; this narrow search does not prove global absence. |
| Project indexes are physically isolated | `PARTIAL` | Scope and foreign-dataset rejection tests exist in the optional RAGFlow adapter; no physically isolated target index topology is implemented or verified. |
| BM25 + FAISS hybrid retrieval is active behind Context Gateway | `PARTIAL` | A local Git/docs BM25 pilot exists; no FAISS path, target Context Gateway, or active production hybrid runtime was found. |
| One global local embedding profile is versioned | `TARGET_ONLY` | No profile artifact or versioned runtime configuration was verified. |
| Structural chunking profile is versioned | `TARGET_ONLY` | No profile artifact or versioned runtime configuration was verified. |
| Incremental update works | `TARGET_ONLY` | No integration test or production receipt was recorded. |
| Periodic/full rebuild works | `TARGET_ONLY` | No scheduled rebuild or full-rebuild evidence was recorded. |
| Current/previous generation publication and rollback work | `PARTIAL` | Draft PR #32 adds tested pure promotion/rollback plans, stale-current checks, and a driver boundary; durable Drive persistence, atomic compare-and-swap, integration tests, and rollback receipts remain absent. |
| Cross-project retrieval leakage = 0 | `PARTIAL` | Existing source tests discard foreign scope/dataset results; no full corpus, physical-index, or deployed leakage audit exists. |
| RAGFlow runtime is not required by the initial target | `PARTIAL` | The cognitive package hard-disables serving and treats RAGFlow as optional shadow; deployed dependency inventory is still incomplete. |

## Execution and security end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| One authoritative primary owns SQLite/WAL execution state | `UNRESOLVED` | Hostinger reports file authority and is healthy; Resident Node `main` also has SQLite/WAL state. Sole-primary mapping and global writer census are missing. |
| Manual failover procedure is verified | `TARGET_ONLY` | No witnessed failover exercise, receipt, or recovery report exists. |
| Authority epoch advances on primary recovery/failover | `PARTIAL` | Resident Node `main` does not prove recovery advancement. Current draft PR #1 adds an OS sidecar acquisition lock and transactionally advances `security_epoch` before restart reconciliation; current head `5b4b29de90ead0086b57309ecc2b5d4cbb506b8f` passed CI run #45 on Linux, Windows, and macOS. This is source-level local-process fencing only; authenticated worker identity, shared/network filesystem semantics, global single-primary, and production failover remain unproven. |
| Stale-epoch worker authoritative commits are rejected | `PARTIAL` | Draft PR #1 adds source-level rejection tests; no authenticated production worker/runtime evidence exists. |
| Expired-lease worker authoritative commits are rejected | `PARTIAL` | Draft PR #1 adds source-level rejection tests; sandbox draft lacks equivalent epoch/expiry result predicates, and no production proof exists. |
| Secrets are held by Secrets Broker and excluded from repos/logs/corpus/indexes/ordinary snapshots | `UNRESOLVED` | No end-to-end broker custody/exclusion audit exists. The owner applied the Hostinger secret JSON; the agent did not read or record secret values. |
| Remote workers are subordinate executors, never authorities | `PARTIAL` | Target and sandbox design describe subordinate workers; live deployment, authentication, write-path and authority census are not proven. |

## Legacy deletion end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| Eligible deprecated shims remaining = 0 | `UNRESOLVED` | No complete shim inventory or eligibility audit exists. |
| Duplicate control planes scheduled for deletion = 0 | `NOT_MET` | Legacy repositories and candidate control-plane paths remain active or unresolved; the zero scheduled-deletion end state is not established. |
| Live dependencies on archived legacy repos = 0 | `UNRESOLVED` | No archive has been certified with a complete caller/deployment dependency scan. |
| Stale global architecture docs are superseded | `UNRESOLVED` | Frozen Agent Platform docs exist, but no repository-wide stale-document supersession audit is recorded. |
| Obsolete architecture branches are cleaned under preservation policy | `NOT_MET` | Branch inventory, dependency review, and preservation receipts are not complete; no branch cleanup was performed. |
| Dead deployments/config paths are removed | `UNRESOLVED` | No exhaustive deployment/resource/config inventory proves the zero count or safe removal. |
| Preservation tags/refs exist where required | `UNRESOLVED` | No per-repository preservation manifest or verified ref receipts exist. |

## Verification end state

| Frozen criterion | Status | Evidence and remaining proof |
| --- | --- | --- |
| Forbidden dependency edges = 0 | `UNRESOLVED` | No final architecture graph/checker result covers all repositories and production dependencies. |
| Repository tests pass | `PARTIAL` | Resident Node PR #1 head `5b4b29de90ead0086b57309ecc2b5d4cbb506b8f` has successful format, Clippy, and tests on Linux/Windows/macOS (run #45); ops-gabriel-ops PR #82 head `cbf039bb020a5628a4b3e44fe9f007729618f4a5` has successful `verify`, `guardrail`, and CodeRabbit checks. `memory-cognition` retrieval suite passed 30/30. P05 PR #32 passed 28/28 targeted tests locally; P06 PR #30 passed 37 targeted tests locally with provider calls mocked. Current P05 and P06 heads returned no GitHub statuses or PR-triggered workflow runs. Current P08 PR #31 head `5113f2e48cbd84a09f5f8b5f3353baab246cfb7e` also returned no statuses or PR-triggered runs at `2026-10-05T03:12:57Z`; this is not a pass. Earlier CodeQL billing-block results refer to a prior P08 head only. A direct full Agent Platform Node-suite run here was incomplete: 14/18 top-level tests passed and 4 could not start/pass because `@modelcontextprotocol/server` is absent and the server did not start. |
| Architecture gates pass | `NOT_MET` | P03, P04, P05, P06, P07 and P08 exit evidence is incomplete; P09–P11 have not started destructive actions. |
| Integration/E2E tests pass | `UNRESOLVED` | No full consolidated production-path E2E result exists. |
| Production smoke passes | `PARTIAL` | P03 probes showed Hostinger `/healthz` 200, metadata 200, and unauthenticated MCP 401; hPanel also marked its latest deployment `Concluído` and `Atual` at displayed time `2026-10-04 23:44:46` (timezone unlabeled). These are bounded health/deployment observations, not the DoD smoke suite. |
| Migration receipts exist for stateful moves | `NOT_MET` | No authorized stateful migration or corresponding receipt has been performed. |
| Rollback artifacts are verified | `PARTIAL` | The Oct 3 fenced capture/restore is mechanically valid for its recorded bytes; it predates current Hostinger config and is not a current cutover snapshot. |
| Final architecture graph matches `02-target-architecture.md` | `TARGET_ONLY` | Target doc exists; no final graph or conformance result exists. |
| Authority registry matches `03-authority-matrix.md` | `TARGET_ONLY` | Target matrix exists; no verified final runtime registry exists. |
| Final state satisfies all P12 acceptance criteria | `NOT_MET` | P12 is pre-audit only until P03–P11 exit receipts, deletion/archival evidence, final E2E, smoke and rollback proof are complete. |

## Current gate disposition

| Gate | Disposition | Safe next work |
| --- | --- | --- |
| P03 / HG-001 | `BLOCKED / NOT_PASSED` | Preserve healthy-service evidence; obtain VM service/origin/caller mapping, global caller census, sole-primary proof, and a fresh verified rollback snapshot before any cutover. |
| P04 | `FORMAL_ENTRY_NOT_SATISFIED / DEPLOYMENT_AND_IDENTITY_GAPS` | Draft PR #1 closes the local restart-epoch increment and local process-lock gap, with cross-platform CI. Formal P04 entry still depends on P03 seams; global single-primary, authenticated worker identity/transport, deployed-filesystem behavior, external-effect recovery, migration receipt, and current rollback remain open. |
| P05 | `PREPARATION_ONLY / ENTRY_NOT_SATISFIED` | P04 indexing runtime is absent from Resident Node `main`. Draft Context Gateway/Store seams exist on the P03 migration branch; [PR #32](https://github.com/menezes-platform/ops-codex-os/pull/32) advances source-level generation policy only. The Drive driver and execution-plane interface/runtime remain pending. |
| P06 | `PREPARATION_ONLY / FROZEN_MAIN_BYPASS_PRESENT` | Draft PR #30 removes the PersistFlow direct TypeSafe caller from its branch and has 37 targeted tests, but frozen `main` still contains the bypass; no production Gateway composition or broker-backed adapter exists. Direct Gabriel Ops and Orquestra/OmniRoute candidates remain, and production activity/configuration is unresolved. |
| P07 | `PREPARATION_ONLY` | Complete the read-only writer/caller inventory and distinguish business-domain state from platform authority; no source-system mutation. |
| P08 | `ENTRY_NOT_SATISFIED` | Continue read-only caller and worker inventory; no migration or archive claim. |
| P09–P11 | `DESTRUCTIVE_GATES_CLOSED` | Continue preservation and dependency evidence only; no deletion/archive/cleanup until zero-caller/deployment/state receipts and rollback proof exist. |
| P12 / DoD | `PRE_AUDIT_ONLY / NOT_MET` | Refresh this matrix as phase receipts arrive; run final audits only after all prerequisite gates are passed. |

Evidence references: [`P03 Hostinger recovery`](2026-10-05-P03-hostinger-recovery.md), [`P03 Hostinger deployment-list read`](2026-10-05-P03-hostinger-deployment-read.md), [`P05 retrieval preparation`](2026-10-05-P05-retrieval-preparation.md), [`P05 generation policy PR #32`](https://github.com/menezes-platform/ops-codex-os/pull/32), [`P06 Provider Gateway PR #30`](https://github.com/menezes-platform/ops-codex-os/pull/30), [`P07 source writer inventory`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/pull/82), [`P08 caller/worker inventory`](2026-10-05-P08-caller-worker-inventory.md), frozen Spec Kit `11-definition-of-done.md`, `02-target-architecture.md`, `03-authority-matrix.md`, current draft PR/check metadata recorded in P08, and read-only timestamped probes noted there. This checkpoint records evidence boundaries; it does not reclassify or amend the frozen Spec Kit.

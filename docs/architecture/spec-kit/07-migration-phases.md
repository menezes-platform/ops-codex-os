# 07 — Migration Phases

Every phase ends in a valid, testable, reversible state. No phase depends on a later phase merely to restore correctness.

<!-- phase: P00 -->
## P00 — Architecture Freeze
**Purpose:** stop architecture growth while consolidation begins.
**Entry:** approved Spec Kit exists.
**Allowed:** inventory, tests, compatibility preparation.
**Forbidden:** new control planes, authorities, permanent databases, retrieval providers, paid infra without explicit approval.
**Evidence:** freeze notice, open-work inventory.
**Rollback artifact:** none required beyond current refs.
**Exit:** freeze rules are documented and active.
**Next:** P01.

<!-- phase: P01 -->
## P01 — Inventory and Dependency Graph
**Purpose:** replace assumptions with current evidence.
**Entry:** P00 passed.
**Allowed:** read-only probes, caller/deploy/state/secret-path inventory.
**Forbidden:** architecture migration mutations.
**Evidence:** repo refs, live deployment list, callers, state stores, workers, secret paths, evidence status.
**Rollback artifact:** evidence snapshot only.
**Exit:** all migration premises are OBSERVED or explicitly unresolved with blocking scope.
**Next:** P02.

<!-- phase: P02 -->
## P02 — Contracts and Architecture Tests
**Purpose:** create enforceable target seams before moving implementation.
**Entry:** P01 evidence accepted.
**Allowed:** producer-owned schemas, clients, architecture tests, forbidden-edge checks.
**Forbidden:** bypassing legacy callers before compatibility path exists.
**Evidence:** contract tests, invariant tests, idempotency tests, project-scope tests.
**Rollback artifact:** pre-contract refs.
**Exit:** target seams exist and compatibility strategy is registered.
**Next:** P03.

<!-- phase: P03 -->
## P03 — Agent Platform Consolidation
**Purpose:** restructure ops-codex-os into target Agent Platform modules.
**Entry:** P02 passed.
**Allowed:** Agent OS, Context Gateway, Context Store ownership, Provider Gateway seams.
**Forbidden:** moving execution authority into Agent Platform.
**Evidence:** module tests, forbidden-import checks, caller inventory updates.
**Rollback artifact:** branch/ref checkpoint.
**Exit:** Agent Platform target modules exist behind stable interfaces.
**Next:** P04.

<!-- phase: P04 -->
## P04 — Execution Plane Consolidation
**Purpose:** consolidate PersistFlow, Resident Runtime, indexing runtime, secrets broker and worker adapters in resident-node.
**Entry:** P03 seams available.
**Allowed:** state migration tooling, SQLite/WAL authority consolidation, worker fencing.
**Forbidden:** multi-primary authority, automatic leader election, direct Agent Platform storage access.
**Evidence:** migration receipts, fencing tests, execution integration tests, rollback snapshot.
**Rollback artifact:** consistent pre-migration SQLite/WAL/state snapshot.
**Exit:** one authoritative primary owns execution state.
**Next:** P05.

<!-- phase: P05 -->
## P05 — Context Store and Retrieval
**Purpose:** establish Drive-backed project-isolated corpus and BM25+FAISS retrieval.
**Entry:** P04 indexing runtime available.
**Allowed:** corpus projection, local embeddings, structural chunking, current/previous snapshots.
**Forbidden:** RAGFlow runtime serving, cross-project implicit retrieval.
**Evidence:** rebuild tests, leakage tests, snapshot rollback, manifest versioning.
**Rollback artifact:** previous index generation and corpus manifest.
**Exit:** initial retrieval target is active behind Context Gateway.
**Next:** P06.

<!-- phase: P06 -->
## P06 — Provider Gateway Migration
**Purpose:** centralize platform-owned model access and eligible semantic/exact cache.
**Entry:** P03 Provider Gateway seam exists.
**Allowed:** provider adapters, routing/fallback/budget policy, cache migration.
**Forbidden:** direct provider calls outside gateway, persistent conversation authority in gateway.
**Evidence:** caller scan, freshness bypass tests, provider-routing tests.
**Rollback artifact:** previous provider configuration.
**Exit:** platform-owned bypass caller count is zero.
**Next:** P07.

<!-- phase: P07 -->
## P07 — Gabriel Ops Simplification
**Purpose:** reduce Gabriel Ops to observability + command console.
**Entry:** target command/read interfaces available.
**Allowed:** projection adapters, command clients, dashboard simplification.
**Forbidden:** direct authoritative state writes.
**Evidence:** authority-writer scan, projection tests, command-path tests.
**Rollback artifact:** prior deploy/ref.
**Exit:** Gabriel Ops authority-like writers = 0.
**Next:** P08.

<!-- phase: P08 -->
## P08 — Caller and Worker Migration
**Purpose:** move all production callers/workers to approved interfaces.
**Entry:** P03-P07 target paths available.
**Allowed:** client migration, worker capability/lease adoption.
**Forbidden:** new direct storage/provider/secret paths.
**Evidence:** caller count, worker inventory, stale-epoch/lease rejection tests.
**Rollback artifact:** previous client config and worker enrollment map.
**Exit:** all live callers use approved interfaces.
**Next:** P09.

<!-- phase: P09 -->
## P09 — Duplicate-Authority Deletion
**Purpose:** remove obsolete writers, bypasses and eligible shims.
**Entry:** P08 caller migration complete.
**Allowed:** deletion of registered legacy paths whose removal gates pass.
**Forbidden:** deleting a path with nonzero callers or unverified rollback.
**Evidence:** writer count, caller count, shim registry, security tests.
**Rollback artifact:** preservation refs/snapshots where stateful.
**Exit:** duplicate authority paths = 0; eligible shims = 0.
**Next:** P10.

<!-- phase: P10 -->
## P10 — Legacy Repository Archive
**Purpose:** archive ops-dev-orquestra and ops-persistflow-sandbox.
**Entry:** P09 passed; archive gates satisfied.
**Allowed:** preservation tags, archive action, dead deploy removal.
**Forbidden:** archive with live caller/deploy/state dependency.
**Evidence:** caller=0, deploy dependency=0, preservation tag, archive status.
**Rollback artifact:** preservation tag and repo refs.
**Exit:** both legacy repos archived as specified.
**Next:** P11.

<!-- phase: P11 -->
## P11 — Branch, Docs and Deployment Cleanup
**Purpose:** remove architecture debris and complete final naming/document ownership.
**Entry:** P10 passed.
**Allowed:** rename repos, delete obsolete branches after preservation gate, migrate docs, remove dead deploy config.
**Forbidden:** deleting branches with live PR/deploy/caller dependency.
**Evidence:** branch audit, docs authority audit, deploy inventory, rename redirects.
**Rollback artifact:** tags/refs and pre-rename references.
**Exit:** branch list/docs/deploys represent live architecture only.
**Next:** P12.

<!-- phase: P12 -->
## P12 — Final Audit
**Purpose:** prove target architecture and Definition of Done.
**Entry:** P11 passed.
**Allowed:** fixes required to satisfy approved gates; no redesign.
**Forbidden:** weakening Spec Kit to make audit pass.
**Evidence:** full tests, E2E, smoke, architecture graph, zero-condition scans, rollback proof.
**Rollback artifact:** final pre-audit checkpoint.
**Exit:** all Definition-of-Done criteria satisfied.
**Next:** complete.

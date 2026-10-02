# 06 — Deletion and Consolidation Map

The disposition vocabulary is fixed: **KEEP, MOVE, MERGE, DELETE, ARCHIVE**.

## Repository dispositions

<!-- legacy: ops-codex-os disposition: MOVE -->
### ops-codex-os — MOVE

- Destination: `agent-platform`.
- Owner: Agent Platform migration.
- Precondition: target module seams exist and production callers use them.
- Removal/rename gate: compatibility callers migrated; architecture tests green; rollback evidence recorded.
- Latest phase: P11.
- End state: repository history continues under the final Agent Platform identity; old naming survives only through redirects/history.

<!-- legacy: resident-node disposition: MOVE -->
### resident-node — MOVE

- Destination: `execution-plane`.
- Owner: Execution Plane migration.
- Precondition: PersistFlow, indexing runtime, secrets broker and worker adapters consolidated.
- Removal/rename gate: execution tests/fencing green; callers migrated; rollback verified.
- Latest phase: P11.

<!-- legacy: ops-persistflow-sandbox disposition: ARCHIVE -->
### ops-persistflow-sandbox — ARCHIVE

- Destination of useful code: Execution Plane / worker adapters and sandbox execution modules.
- Owner: Execution Plane migration.
- Archive gate:
  - production callers = 0;
  - live deployment dependencies = 0;
  - state migration receipt verified;
  - equivalent or stronger tests green;
  - preservation tag created.
- Latest phase: P10.

<!-- legacy: ops-dev-orquestra disposition: ARCHIVE -->
### ops-dev-orquestra — ARCHIVE

- Destination of useful code:
  - semantic/exact cache -> Provider Gateway;
  - browser/computer execution -> Execution Plane;
  - useful provider integration -> Provider Gateway;
  - useful worker bridges -> Worker Adapters.
- Duplicate orchestration/control-plane/state-authority logic is deleted, not migrated.
- Owner: Agent Platform + Execution Plane migration.
- Archive gate:
  - useful capabilities migrated;
  - production callers = 0;
  - live deployments = 0;
  - duplicate authority logic deleted;
  - preservation tag created.
- Latest phase: P10.

<!-- legacy: ops-gabriel-ops disposition: KEEP -->
### ops-gabriel-ops — KEEP

- Owner: Gabriel Ops.
- Required transformation: remove direct/competing authority state and route mutations through official clients.
- Exit gate: authority-like writers = 0; projection/command tests green.
- Latest phase for simplification: P07.

<!-- legacy: Memory disposition: KEEP -->
### Memory — KEEP

- Owner: private personal-context system.
- Required transformation: move global platform architecture/project technical architecture out of Memory.
- Exit gate: global architecture lives in Agent Platform; Memory retains personal canonical context only.
- Latest phase: P11.

## Capability dispositions

<!-- legacy: persistflow-in-agent-os disposition: MOVE -->
### PersistFlow implementation inside Agent OS — MOVE

- Destination: Execution Plane / PersistFlow core.
- Gate: all production run callers use Execution Plane client; migrated state verified.
- Latest phase: P09.

<!-- legacy: object-store-placement disposition: MOVE -->
### Object/corpus storage colocated with PersistFlow code — MOVE

- Destination ownership: Agent Platform / Context Store.
- Physical indexing/materialization work remains Execution Plane / Indexing Runtime.
- Gate: corpus manifests/provenance and Drive snapshot behavior validated under new seam.
- Latest phase: P05.

<!-- legacy: memory-cognition-provider disposition: MERGE -->
### Memory cognition provider seam — MERGE

- Destination: Context Gateway.
- Keep useful normalization/provenance behavior; remove provider-specific architecture leakage.
- Gate: Context Gateway tests cover all allowed source adapters.
- Latest phase: P05.

<!-- legacy: ragflow-shadow-runtime disposition: DELETE -->
### RAGFlow initial runtime path — DELETE

- No production runtime is introduced in the initial target.
- Existing shadow adapter code may remain as inactive experimental evidence only if it does not define public contracts or serving behavior.
- Gate: initial BM25+FAISS target has no RAGFlow runtime dependency.
- Latest phase: P05.

<!-- legacy: dev-orquestra-semantic-cache disposition: MOVE -->
### Dev-Orquestra semantic/exact cache — MOVE

- Destination: Provider Gateway if current tests and policy still justify it.
- Cache remains derived/disposable.
- Gate: provider-gateway policy/freshness tests green; old caller count = 0.
- Latest phase: P06.

<!-- legacy: duplicate-control-planes disposition: DELETE -->
### Duplicate owner/protocol/orchestration/control-plane paths — DELETE

- Destination: none unless a capability maps explicitly to an approved target module.
- Gate: target official command path exists; callers = 0; equivalent security/behavior tests green.
- Latest phase: P09.

<!-- legacy: direct-provider-calls disposition: DELETE -->
### Direct platform-owned provider calls — DELETE

- Destination: Provider Gateway.
- Gate: platform-owned caller count bypassing gateway = 0.
- Latest phase: P09.

<!-- legacy: scattered-secret-paths disposition: DELETE -->
### Scattered canonical secret paths — DELETE

- Destination: Secrets Broker.
- Gate: broker operational; clients use scoped capabilities; repo/runtime scans prove canonical duplicate paths = 0.
- Latest phase: P09.

<!-- legacy: obsolete-architecture-branches disposition: DELETE -->
### Obsolete architecture branches — DELETE

- Preservation: extract still-useful decision/evidence; create tag where valuable.
- Gate: no live PR/deploy/caller depends on branch.
- Latest phase: P11.

## Shim contract

Every temporary compatibility shim must record:

- `id`;
- owner;
- purpose;
- allowed callers;
- introduced phase;
- objective removal condition;
- latest removal phase.

An eligible shim remaining after its removal condition passes is a Definition-of-Done failure.

# 11 — Definition of Done

The consolidation is done only when the new architecture works **and** obsolete architecture is removed or archived as specified.

## Repository and module end state

- `ops-codex-os` has completed transition to the Agent Platform identity/responsibility.
- `resident-node` has completed transition to the Execution Plane identity/responsibility.
- `ops-dev-orquestra` is archived.
- `ops-persistflow-sandbox` is archived.
- `ops-gabriel-ops` remains active only as observability + command console.
- private `Memory` remains active only as canonical personal context.
- global architecture authority lives under Agent Platform `docs/architecture/`.

## Authority end state

- every durable domain has exactly one declared authoritative writer;
- duplicate authority paths = **0**;
- Gabriel Ops authoritative state writers = **0**;
- Agent Platform operational authority stores = **0**;
- retrieval indexes own no truth;
- semantic/exact model cache owns no truth;
- Engram does not override Git/Memory/PersistFlow/runtime evidence.

## Interface end state

- all production callers use approved producer-owned interfaces;
- Agent Platform has no direct PersistFlow SQLite/WAL/filesystem access;
- platform-owned model calls bypassing Provider Gateway = **0**;
- framework/vendor-specific types in public platform interfaces = **0**;
- project scope is deterministic;
- normal retrieval never widens scope implicitly.

## Retrieval end state

- Context Store is Drive-backed with normalized corpus + provenance/manifests;
- project indexes are physically isolated;
- BM25 + FAISS hybrid retrieval is active behind Context Gateway;
- one global local embedding profile is versioned;
- structural chunking profile is versioned;
- incremental update works;
- periodic/full rebuild works;
- current/previous generation publication and rollback work;
- cross-project retrieval leakage = **0**;
- RAGFlow runtime is not required by the initial target.

## Execution/security end state

- one authoritative primary owns SQLite/WAL execution state;
- manual failover procedure is verified;
- authority epoch advances on primary recovery/failover;
- stale-epoch worker authoritative commits are rejected;
- expired-lease worker authoritative commits are rejected;
- secrets are held by Secrets Broker and excluded from repos/logs/corpus/indexes/ordinary snapshots;
- remote workers are subordinate executors, never authorities.

## Legacy deletion end state

- eligible deprecated shims remaining = **0**;
- duplicate control planes scheduled for deletion = **0**;
- live dependencies on archived legacy repos = **0**;
- stale global architecture docs are superseded;
- obsolete architecture branches are cleaned under preservation policy;
- dead deployments/config paths are removed;
- preservation tags/refs exist where required.

## Verification end state

- forbidden dependency edges = **0**;
- repository tests pass;
- architecture gates pass;
- integration/E2E tests pass;
- production smoke passes;
- migration receipts exist for stateful moves;
- rollback artifacts are verified;
- final architecture graph matches `02-target-architecture.md`;
- authority registry matches `03-authority-matrix.md`;
- final state satisfies all P12 acceptance criteria.

A completion claim missing deletion/archival evidence is not a valid completion claim.

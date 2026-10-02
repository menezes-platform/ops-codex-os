# 10 — Phase Acceptance Criteria

A phase exits only with verifiable evidence. “Looks good”, “seems migrated”, or an agent completion claim is not evidence.

## P00 — Architecture Freeze
- freeze rules committed;
- active architecture-changing work inventory recorded;
- no unauthorized new state authority/provider/database introduced after freeze.

## P01 — Inventory and Dependency Graph
- repository refs recorded;
- live deployment inventory recorded;
- current callers and workers enumerated;
- authoritative state stores and secret paths enumerated;
- each operational claim labeled OBSERVED, DOCUMENTED_ONLY, or UNRESOLVED;
- unresolved items that affect mutation are promoted to blocking evidence tasks.

## P02 — Contracts and Architecture Tests
- producer-owned contract schemas exist;
- compatibility strategy registered;
- forbidden-edge tests exist;
- idempotency tests exist for mutating commands;
- project-scope isolation tests exist;
- contract/client compatibility tests pass.

## P03 — Agent Platform Consolidation
- Agent OS, Context Gateway, Context Store ownership and Provider Gateway seams exist;
- Agent Platform operational authority stores = 0;
- forbidden PersistFlow-storage access = 0;
- module tests and architecture tests pass.

## P04 — Execution Plane Consolidation
- one primary owns PersistFlow SQLite/WAL authority;
- Resident Runtime local-state ownership is explicit;
- indexing runtime and secrets broker exist behind interfaces;
- stale epoch and expired lease tests pass;
- migration receipt and rollback snapshot verified.

## P05 — Context Store and Retrieval
- Drive-backed per-project corpus layout exists;
- normal project recall touches one project index only;
- BM25 + FAISS hybrid path works;
- local embedding/chunking/index profile recorded in manifest;
- incremental update works;
- full rebuild works;
- current/previous rollback works;
- cross-project leakage = 0;
- RAGFlow runtime dependency = 0.

## P06 — Provider Gateway Migration
- platform-owned model calls bypassing Provider Gateway = 0;
- routing/fallback/budget policy tests pass;
- freshness-required calls bypass derived semantic cache;
- provider secrets are obtained through approved secret/capability path;
- gateway owns no conversation or project authority.

## P07 — Gabriel Ops Simplification
- authoritative writers in Gabriel Ops = 0;
- dashboards read projections;
- commands use official clients;
- unavailable providers remain visibly unavailable rather than synthetic;
- smoke/build/tests pass.

## P08 — Caller and Worker Migration
- production legacy caller count = 0 for paths scheduled for P09 deletion;
- every live worker has lease/epoch/capability fencing;
- stale worker result rejection is proven;
- no new direct storage/provider/secret bypass paths exist.

## P09 — Duplicate-Authority Deletion
- duplicate authority paths = 0;
- eligible shims remaining = 0;
- direct provider bypasses = 0;
- scattered canonical secret paths scheduled for removal = 0;
- each deletion has preservation/backup evidence as required.

## P10 — Legacy Repository Archive
- `ops-dev-orquestra` callers = 0 and live deploy dependencies = 0;
- `ops-persistflow-sandbox` callers = 0 and live deploy dependencies = 0;
- useful capability migration verified;
- preservation tags created;
- both repositories archived.

## P11 — Branch, Docs and Deployment Cleanup
- obsolete architecture branches have no live PR/deploy/caller dependencies before deletion;
- required preservation tags/refs exist;
- global architecture authority lives in Agent Platform;
- Memory no longer serves as global platform architecture home;
- repo renames/redirects verified;
- dead deployment/config inventory closed.

## P12 — Final Audit
- full unit/integration suites green;
- end-to-end execution path green;
- production smoke green;
- forbidden dependency edges = 0;
- duplicate authority paths = 0;
- cross-project retrieval leakage = 0;
- eligible deprecated shims = 0;
- live dependencies on archived legacy repos = 0;
- worker fencing tests green;
- rollback paths verified;
- generated/current architecture graph matches target Spec Kit;
- every criterion in `11-definition-of-done.md` has evidence.

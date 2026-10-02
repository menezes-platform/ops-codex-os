# 01 — Current Architecture Evidence

**Snapshot date:** 2026-10-02

This file records the pre-migration platform as evidence, not as a design endorsement.

Status meanings:

- **OBSERVED** — verified from current repository metadata/source or a live connector/runtime observation.
- **DOCUMENTED_ONLY** — asserted by current documentation but not independently runtime-probed in this inventory.
- **UNRESOLVED** — evidence is incomplete, conflicting, or intentionally not promoted to a current-state claim.

Current-state authority markers use a `current/` prefix so they cannot collide with the target authority registry in `03-authority-matrix.md`.

## Repository inventory

| Repository | Status | Evidence | Observed/documented responsibility |
| --- | --- | --- | --- |
| `menezes-platform/ops-codex-os` | OBSERVED | GitHub metadata: public, default branch `main`; current branch contains this consolidation design | Global agent rules/skills plus PersistFlow implementation and memory/retrieval integration code currently coexist here. |
| `menezesx2k26-byte/resident-node` | OBSERVED | GitHub metadata + `README.md@main` | Rust local-first durable job runtime with SQLite/WAL, security epoch, capability registry, audit, recovery and local execution authority concepts. |
| `menezes-platform/ops-persistflow-sandbox` | OBSERVED | GitHub metadata + `README.md@main` | Repository describes itself as a disposable execution plane and explicitly says canonical PersistFlow authority remains in Codex OS. |
| `menezes-platform/ops-dev-orquestra` | OBSERVED | GitHub metadata + `README.md@main` | Multi-agent development coordination repository with worktrees, gates, browser/QA/eval work and multiple orchestration/integration lanes. |
| `menezesx2k26-byte/ops-gabriel-ops` | OBSERVED | GitHub metadata + `README.md@main` | Cloudflare/Node operational dashboard; current docs state PersistFlow remains run/generation/task authority and providers degrade independently. |
| `menezesx2k26-byte/Memory` | OBSERVED | GitHub metadata shows private repo; `MEMORY.md@main` | Private account-level memory with selective loading and a mandatory durable-personal-context ingestion gate. |

## Current branch complexity

| Repository | Status | Evidence | Current architectural branch signal |
| --- | --- | --- | --- |
| `resident-node` | OBSERVED | GitHub branch listing | Branches include `feat/capability-mesh`, `feat/job-engine`, `feat/os-broker`, `feat/owner-plane`, `feat/protocol-plane`, `feat/security-policy`, `feat/storage-lifecycle`, `integration/final-inline` and others, demonstrating several competing/adjacent plane designs still visible. |
| `ops-persistflow-sandbox` | OBSERVED | GitHub branch listing | `feat/sandbox-v1`, `feat/sandbox-dod-final`, `spec/interactive-browser-human-gate`, and `main` remain visible. |
| `ops-dev-orquestra` | OBSERVED | GitHub branch listing | Numerous branches cover semantic cache, computer control, MCP bridges, browser runtime, queues, local intelligence, orchestration phases and integrations. |
| `ops-gabriel-ops` | DOCUMENTED_ONLY | Current repo history/known branches not exhaustively re-listed in this inventory | Historical work includes dashboard, fleet, runtime-control and integration branches; exact live relevance must be re-inventoried in P01. |

## Current authority observations

<!-- domain: current/run-continuity writer: current/persistflow-in-ops-codex-os -->
<!-- domain: current/local-runtime-state writer: current/resident-node -->
<!-- domain: current/personal-context writer: current/memory -->
<!-- domain: current/project-source writer: current/git -->

| Domain | Status | Evidence | Current interpretation |
| --- | --- | --- | --- |
| Run/generation/task continuity | OBSERVED | `ops-codex-os/README.md` and current PersistFlow source/tests | PersistFlow in Codex OS is the current canonical run authority described by the repository. |
| Local durable jobs/security epoch | OBSERVED | `resident-node/README.md@main` | Resident Node owns durable local jobs, SQLite/WAL metadata, capability/security epoch and local recovery concepts. |
| Personal account context | OBSERVED | `Memory/MEMORY.md@main` + private repo metadata | Memory is the current private account-level canonical memory. |
| Project code/docs | OBSERVED | Git repository structure and Memory authority model | Current repository/Git state outranks derived memory for project-specific truth. |
| Gabriel Ops snapshots | DOCUMENTED_ONLY | `ops-gabriel-ops/README.md@main` | Dashboard uses Cloudflare Worker/KV/Durable Objects for sanitized projections; live production behavior was not independently probed here. |
| Semantic response cache | DOCUMENTED_ONLY | `ops-dev-orquestra/docs/SEMANTIC_CACHE.md` from prior audited source | Redis/RedisVL exact serving + semantic shadow is described as derived response cache, not memory or authority. |
| Gabriel Object Store / Drive | DOCUMENTED_ONLY | Current design docs/source references in Codex OS | Content-addressed blob/corpus behavior exists, but final ownership and exact live backing paths require P01 runtime inventory. |

## Connected and non-repository dependencies

| Dependency | Status | Evidence | Current role |
| --- | --- | --- | --- |
| Engram | DOCUMENTED_ONLY | Existing architecture docs and connected-service contract | Episodic conversation storage/search; not canonical project or account truth. Live data/isolation is not re-probed by this inventory. |
| Google Drive | DOCUMENTED_ONLY | Existing object-store/context designs | Durable blob/corpus backing and manifests. Exact current folder/layout and live write path must be verified in P01. |
| Tailscale | DOCUMENTED_ONLY | Resident/Gabriel Ops architecture history | Private connectivity/defense-in-depth. It is not identity or authority by itself. |
| Railway | DOCUMENTED_ONLY | Existing worker/deployment architecture | Remote/ephemeral worker role. Current service list and live workload mapping require P01 verification. |
| Hostinger | DOCUMENTED_ONLY | PersistFlow/Sandbox docs | Hosts web/runtime surfaces in current architecture history; current authoritative role must be re-probed. |
| CloudShell | DOCUMENTED_ONLY | Existing worker architecture | Auxiliary remote execution environment; not an authority. |
| RAGFlow | OBSERVED | `docs/architecture/adr/0008-ragflow-shadow-retrieval.md` on current Codex OS source | Shadow adapter exists; serving was hard-disabled in the accepted ADR and is outside the initial consolidated runtime target. |

## Known current inconsistencies

| Finding | Status | Evidence | Migration consequence |
| --- | --- | --- | --- |
| PersistFlow implementation and Agent OS responsibilities coexist in the same repository | OBSERVED | `ops-codex-os` source/README | Extract execution authority into future Execution Plane. |
| Object/corpus storage behavior is physically near PersistFlow code while conceptually serving retrieval/context | OBSERVED | Codex OS architecture/source history | Move ownership to Context Store while physical indexing remains Execution Plane work. |
| Multiple repositories expose orchestration/control-plane concepts | OBSERVED | Resident branch list + Dev-Orquestra README/branches + Gabriel Ops history | P01 must enumerate live callers before P09 deletion. |
| Memory contains platform/project technical direction in addition to personal context | OBSERVED | `MEMORY.md` routes `memory/PROJECTS.md` and existing architecture specs | Global architecture migrates to Agent Platform; Memory narrows to personal context. |
| Exact live deployment topology is not completely proven by repository docs | UNRESOLVED | No single fresh runtime probe covers every Hostinger/Railway/Cloudflare/local node | P01 must treat deployment inventory as a first-class evidence task before migration. |

## P01 evidence rule

No migration plan may convert a `DOCUMENTED_ONLY` or `UNRESOLVED` operational claim into a mutation premise without fresh evidence. P01 is responsible for resolving live deployments, callers, state stores, secret paths and worker relationships.

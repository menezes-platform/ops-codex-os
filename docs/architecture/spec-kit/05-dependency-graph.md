# 05 — Dependency Graph

The graph is defined in terms of module interfaces, not transport or framework types.

## Allowed edges

- Agent OS -> Context Gateway interface.
- Agent OS -> Provider Gateway interface.
- Context Gateway -> Git adapter.
- Context Gateway -> Memory adapter.
- Context Gateway -> Engram adapter.
- Context Gateway -> retrieval interface.
- Context Gateway -> Execution Plane client for indexing/retrieval execution.
- Provider Gateway -> Secrets Broker capability interface.
- Provider Gateway -> provider adapters.
- Agent Platform -> Execution Plane versioned client.
- Execution Plane / Indexing Runtime -> Context Store materialization interface.
- Execution Plane / Worker Adapters -> subordinate remote workers.
- Gabriel Ops -> read-only projections.
- Gabriel Ops -> official command clients.
- Remote worker -> Execution Plane task/capability interface.

## Forbidden edges and invariants

### INV-001 — Agent Platform cannot access PersistFlow storage internals
<!-- invariant: INV-001 -->

Agent Platform must not import, mount, query, or mutate PersistFlow SQLite/WAL implementation directly.

### INV-002 — Memory cannot depend on execution packages
<!-- invariant: INV-002 -->

Memory is personal-context authority, not runtime infrastructure.

### INV-003 — Gabriel Ops cannot own run state
<!-- invariant: INV-003 -->

Gabriel Ops may project run state and issue commands through interfaces, but cannot directly write authoritative run/generation/checkpoint/task state.

### INV-004 — Resident Runtime cannot independently advance PersistFlow generations
<!-- invariant: INV-004 -->

Generation advancement occurs only through PersistFlow core.

### INV-005 — Context Gateway cannot silently promote derived context into Memory
<!-- invariant: INV-005 -->

Personal canonical writes require the Memory ingestion/promotion contract, not retrieval confidence.

### INV-006 — Retrieval indexes are never authoritative
<!-- invariant: INV-006 -->

BM25, FAISS, future RAGFlow indexes and semantic caches are rebuildable derived state.

### INV-007 — Corpus projection cannot overwrite authoritative Git source
<!-- invariant: INV-007 -->

Context Store stores projections/manifests and provenance; project truth remains in Git.

### INV-008 — Semantic cache cannot answer freshness-required live state
<!-- invariant: INV-008 -->

Current Git/CI/deploy/worker/run/quota state bypasses derived response cache whenever fresh evidence is required.

### INV-009 — Normal retrieval cannot cross project index boundaries
<!-- invariant: INV-009 -->

A normal `project/<owner>/<repo>` recall touches exactly one physically isolated project index.

### INV-010 — Project scope cannot be invented by the model
<!-- invariant: INV-010 -->

Scope comes from deterministic workspace/repository identity. Multi-project scope is explicit and allowlisted.

### INV-011 — Stale authority epoch cannot commit worker results
<!-- invariant: INV-011 -->

A worker whose `authority_epoch` is stale cannot produce an authoritative mutation.

### INV-012 — Expired lease cannot commit worker results
<!-- invariant: INV-012 -->

Lease expiry fences the worker even if network credentials remain technically valid.

### INV-013 — Agent Platform cannot persist provider secrets
<!-- invariant: INV-013 -->

Long-lived secret custody belongs to Secrets Broker.

### INV-014 — Platform-owned model calls cannot bypass Provider Gateway
<!-- invariant: INV-014 -->

Provider/model routing, fallback and budget policy have one seam.

### INV-015 — Derived indexes must be rebuildable
<!-- invariant: INV-015 -->

A project index can be deleted and rebuilt from allowed corpus/source inputs and versioned profiles.

### INV-016 — Every durable domain has exactly one declared writer
<!-- invariant: INV-016 -->

The target authority matrix cannot contain competing writers for a domain.

### INV-017 — Every active migration shim has a finite removal gate
<!-- invariant: INV-017 -->

No indefinite compatibility layer is allowed.

### INV-018 — Framework-specific types cannot escape platform interfaces
<!-- invariant: INV-018 -->

LangChain, FAISS, provider SDK, MCP transport and future vendor types remain implementation details.

## Seam ownership

| Producer | Owns interface for |
| --- | --- |
| Context Gateway | recall, ingest, explain, reindex request semantics |
| Provider Gateway | model inference/routing request semantics |
| PersistFlow core | run/generation/checkpoint/claim/task continuity |
| Resident Runtime | local job/capability execution semantics |
| Indexing Runtime | index/retrieve physical execution commands exposed by Execution Plane |
| Secrets Broker | secret/capability issuance |
| Gabriel Ops | UI-local projection/view contracts only |

Consumers may generate clients from producer-owned schemas. No third repository owns these contracts.

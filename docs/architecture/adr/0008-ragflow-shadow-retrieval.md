# ADR 0008: RAGFlow as a Project-Scoped Shadow Retriever

- **Status:** Accepted for shadow implementation; live runtime and serving deferred
- **Date:** 2026-10-01
- **Owners:** Agent OS / Memory architecture
- **Pilot:** `project/menezesx2k26-byte/edu-trigonometria-pretemporada`

## Context

ADR 0007 introduced `MemoryCognitionProvider` and a measured local Git/docs BM25 baseline. That slice proved the provider boundary, provenance model, project scope and fallback behavior, but semantic/hybrid retrieval remains unmeasured in serving. Hindsight is still an optional cognitive-memory shadow and is not a replacement for Git, Memory, PersistFlow, Resident Node or Gabriel Object Store.

RAGFlow provides a separate capability: an end-to-end retrieval engine with keyword/vector hybrid search, reranking, metadata filters and optional knowledge-graph retrieval. It is useful as a retrieval experiment, but adopting it as a new system of record would duplicate existing authority boundaries.

## Decision

Add `RAGFlowAdapter` behind `MemoryCognitionProvider` as a **retrieval-only shadow provider**.

The adapter:

- accepts only exact `project/<owner>/<repo>` scopes;
- maps each allowed scope to host-configured RAGFlow dataset IDs;
- never accepts a model-selected dataset ID;
- sends hybrid retrieval with keyword matching and a configured vector weight;
- optionally uses a host-configured reranker;
- injects a `repo=<owner>/<repo>` metadata condition;
- discards chunks from unallowlisted datasets or mismatched repository metadata;
- preserves chunk/document/dataset IDs, source ref/path/section and retrieval scores as provenance;
- retries only transient failures, at most twice;
- exposes sanitized counters/latencies only;
- implements recall only: no derive, promotion or canonical write.

`RAGFLOW_SHADOW_ENABLED` defaults off. `RAGFLOW_SERVING_ENABLED` is hard-disabled by code in this release.

## Authority boundaries

RAGFlow is a rebuildable projection, not an authority.

| Data | Authority |
| --- | --- |
| Current code and project documentation | Git / project repository |
| Canonical account context | private Memory repository |
| Execution/checkpoint state | PersistFlow |
| Local runtime/security state | Resident Node |
| Durable blobs/exports | Gabriel Object Store / Drive |
| Episodic conversation recall | Engram |
| Derived cognitive memory experiment | Hindsight shadow |
| Hybrid retrieval index | RAGFlow shadow |

A RAGFlow result never directly writes any row/file/object in the authorities above.

## Deterministic projection

`scripts/prepare-ragflow-pilot.js` converts the already secret-scanned pilot corpus into a deterministic JSON projection. Each chunk carries:

- stable SHA-256-derived `projection_id`;
- scope and repository;
- Git ref;
- path and section;
- observed timestamp;
- stale/current status;
- original evidence ID;
- `canonical_write: false`.

The projection performs no network write. Provisioning a RAGFlow dataset remains an explicit infrastructure step.

## Benchmark

`scripts/evaluate-pilot.js` now supports three independent lanes over the same fixed question set:

- **A:** local Git/docs BM25 baseline;
- **B:** RAGFlow hybrid retrieval and optional reranker;
- **C:** Hindsight shadow.

The report keeps each provider's metrics separate. RAGFlow evaluation requires explicit `RAGFLOW_API_URL`, `RAGFLOW_API_KEY`, `RAGFLOW_DATASET_ID`, `COGNITION_ENABLED=true` and `RAGFLOW_SHADOW_ENABLED=true`.

No result from B or C becomes agent-facing in this release.

## Infrastructure decision

No RAGFlow runtime is provisioned by this change. The inspected Railway account contains the existing `gabriel-ops` project and PersistFlow sandbox workers, but no reusable RAGFlow stack. A standard RAGFlow deployment introduces additional search/database/object-storage/cache/task-executor services and therefore is not silently added to existing production infrastructure.

A future runtime must be isolated, cost-reviewed and reversible before the B benchmark is run against live infrastructure.

## Failure and rollback

Provider failure cannot break baseline recall. The coordinator tracks each shadow provider independently; three consecutive failures open that provider's 30-second circuit while baseline retrieval continues.

Rollback is leaving `RAGFLOW_SHADOW_ENABLED=false` or removing the adapter configuration. The RAGFlow index, when one exists, is disposable and rebuildable from authoritative project evidence.

## Promotion gate

Serving remains prohibited until a follow-up ADR records:

1. live project-isolation tests with adversarial cross-dataset/cross-repo queries;
2. deletion/rebuild behavior;
3. retrieval quality against the fixed BM25 baseline;
4. reranker effect;
5. stale/current contradiction behavior;
6. latency, context size and infrastructure cost;
7. fallback behavior during RAGFlow/search/database failures.

Only then may the hard serving gate be reconsidered.

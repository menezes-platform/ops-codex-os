# 03 — Authority Matrix

Exactly one authoritative writer exists for each durable state domain below.

| Domain ID | Authority | What it owns | Derived representations |
| --- | --- | --- | --- |
| `project-source` | Git | versioned code/source | Context Store projection, retrieval index |
| `project-docs` | Git | versioned project specs/ADRs/docs | Context Store projection, retrieval index |
| `personal-context` | Memory | canonical personal context | selective retrieval projection |
| `episodic-conversation` | Engram | episodic conversation record/search store | recall candidates |
| `run-continuity` | PersistFlow | run/generation/checkpoint/claim/task continuity | dashboards, telemetry |
| `local-runtime-state` | Resident Runtime | local jobs/capabilities/security/runtime state | dashboards, telemetry |
| `retrieval-corpus` | Context Store | normalized durable retrieval projection and manifests | BM25/FAISS indexes |
| `secret-custody` | Secrets Broker | encrypted secrets and capability issuance | short-lived capabilities |
| `model-routing-policy` | Provider Gateway | provider/model routing policy, fallback and budget policy | metrics, disposable cache |
| `retrieval-indexes` | none | no independent authority | fully rebuildable BM25/FAISS generations |

<!-- domain: project-source writer: git -->
<!-- domain: project-docs writer: git -->
<!-- domain: personal-context writer: memory -->
<!-- domain: episodic-conversation writer: engram -->
<!-- domain: run-continuity writer: persistflow -->
<!-- domain: local-runtime-state writer: resident-runtime -->
<!-- domain: retrieval-corpus writer: context-store -->
<!-- domain: secret-custody writer: secrets-broker -->
<!-- domain: model-routing-policy writer: provider-gateway -->

## Conflict precedence

- Current Git/current repository evidence beats stale project projection.
- Memory beats derived personal-context candidates.
- PersistFlow beats dashboards, logs, inferred execution state and worker-local copies.
- Resident Runtime beats worker-reported claims about local authoritative state.
- Original source provenance beats retrieval-index content.
- Derived cache/index hits never override fresh live/current-state evidence.

## No-authority derived stores

The following may persist data but never independently settle truth:

- BM25;
- FAISS;
- semantic response cache;
- Gabriel Ops projections;
- RAGFlow if later adopted;
- Hindsight if later adopted;
- generated summaries;
- worker-local execution caches.

# Memory Cognition Provider

Small provider-neutral layer for project-scoped agent context. The implementation sits in the reusable agent OS because it is an agent integration, not an execution authority or a new memory system of record.

## Responsibilities

| Component | Responsibility in this slice |
| --- | --- |
| Git/docs baseline | Current source evidence, indexed locally for the pilot; current ref/path/line provenance |
| EngramAdapter | Normalize Engram hybrid search and transcript provenance when the host injects its existing `engram_search` MCP call |
| HindsightAdapter | Optional private-bank retain/recall behind the provider contract; deterministic bank mapping from an allowlisted project scope |
| RAGFlowAdapter | Optional hybrid lexical/vector retrieval shadow; exact project scope maps only to explicitly configured dataset IDs, with cross-dataset/repo filtering |
| Candidate gate | Emit project-scoped schema v2 proposals with explicit evidence; the private Memory validator returns review status only |
| PersistFlow / Resident Node / Object Store | Unchanged owners of run state, local execution state and durable blobs |

Engram searches semantic plus keyword recall and can accept a project title/tag filter. The adapter checks the exact project-title prefix on returned items and reports `securityBoundary: false`; filtering is not isolation. `derive` is unsupported for Engram, so the adapter does not pretend that transcript recall is structured extraction.

Hindsight uses its documented HTTP operations behind this abstraction: `POST /v1/default/banks/{bank_id}/memories/retain` and `POST /v1/default/banks/{bank_id}/memories/recall`. Recall results are normalized with evidence IDs, metadata, entity names and separate event/recorded times. Hindsight's hybrid search may combine semantic, BM25, graph and temporal strategies; no such capability is assumed for Engram. See the [Hindsight Recall API](https://hindsight.vectorize.io/developer/api/recall) and [Retain API](https://hindsight.vectorize.io/developer/api/retain).

RAGFlow uses `POST /api/v1/retrieval` only as a derived retrieval index. The adapter always sends keyword retrieval plus vector weighting, can use a configured reranker, injects a mandatory `repo=<owner>/<repo>` metadata filter, and rejects chunks whose dataset or repository metadata crosses the configured project scope. Dataset IDs are host configuration, never model-selected. RAGFlow has no `derive` or canonical-write capability in this package.

## Scope, flags, and failures

Scope is an exact `project/<owner>/<repo>` string from trusted host configuration. Hindsight maps it deterministically to `project--<owner>--<repo>` and rejects unlisted scopes, including `account/gabriel`. No agent/model-controlled bank IDs are accepted. Host-level MCP registration receives only the three generic handlers from `createMcpHandlers(provider)`.

The host injects the connected Engram MCP operation into the adapter; no Engram transport internals reach agent-facing calls:

```js
const baseline = new EngramAdapter({
  search: (args) => host.callTool('engram_search', args),
});
const provider = createProvider({
  flags: parseFeatureFlags(),
  baseline,
  hindsight: configuredPrivateHindsightAdapterOrUndefined,
  ragflow: configuredProjectRAGFlowAdapterOrUndefined,
});
const handlers = createMcpHandlers(provider);
// Register MCP_TOOL_DEFINITIONS with these generic handlers in the agent host.
```

`createMcpHandlers` and `MCP_TOOL_DEFINITIONS` are the integration surface in this slice; agent host MCP configuration is not changed by this library.

All flags default off:

```text
COGNITION_ENABLED=false
HINDSIGHT_SHADOW_ENABLED=false
HINDSIGHT_SERVING_ENABLED=false  # hard-disabled in this release
RAGFLOW_SHADOW_ENABLED=false
RAGFLOW_SERVING_ENABLED=false    # hard-disabled in this release
```

With any shadow enabled, baseline recall still supplies the agent result. Hindsight and RAGFlow outputs are evaluated independently and never replace baseline context. Timeout, malformed response, 429, database errors and network failures yield no shadow context. Retries are capped at two attempts with bounded jitter; three consecutive failures for one shadow provider open that provider's 30-second circuit. Logs and metrics contain counts/latencies only, never query, API key or result text.

The provider rejects common API keys, bearer values, passwords, cookies, JWTs, connection strings and private-key headers before retain. This is defense in depth, not a replacement for repository secret scanning or Hindsight Memory Defense. A provider result cannot write Memory, Git, project docs, PersistFlow, Resident Node or Object Store.

## Candidate path

Hindsight `ingest` stores only the explicit public-project corpus in the configured project bank. `derive` returns schema v2 candidates containing scope, source URL, repo/ref/path/section, event time, provider, `derived_from`, confidence basis, freshness and contradiction state. Confidence is `null` when not calibrated. New candidates have `contradiction_status: "not_checked"`, `promotion_status: "ready_for_review"`, and `canonical_write: false`.

The Memory repository remains account-scoped by default. Project validation requires its explicit trusted scope:

```sh
python scripts/validate_memory_candidate.py \
  --scope project/menezesx2k26-byte/edu-trigonometria-pretemporada candidate.json
```

The validator does not persist or promote candidates. Project candidates belong in that project's review workflow.

## Public pilot and measured baseline

Pilot: `menezesx2k26-byte/edu-trigonometria-pretemporada`, pinned at `d95a196a07036e21e09e1e08cfdff9baaa2200ea`. Its README says reference PDFs remain private; those files, private chats, account memory and Drive are excluded. A scan of its 28 tracked files found zero configured secret-pattern hits. A real Engram query scoped to the project returned zero items; its filter was not treated as a security control.

Prepare a local deterministic baseline:

```sh
npm test
node scripts/evaluate-pilot.js --repo /path/to/edu-trigonometria-pretemporada
```

The fixed 10-question set covers factual, architecture, historical, temporal, exact-keyword, semantic-paraphrase, contradictory/stale, coding convention and no-answer retrieval. It measures a local Git docs/history BM25 index. The separate live Engram project probe returned zero items and is not included in those 10-query scores. The current 39-passage BM25 report is recorded in `pilot/benchmark-report.json`. It reports retrieval hit/precision/recall/MRR, contradiction ordering, temporal retrieval, context bytes and an explicitly estimated context-token count, p50/p95 latency, local indexing time and serialized index bytes. The index byte count is serialized representation size, not process RSS. Since it has no answer generator, actual LLM tokens, answer abstention and unsupported-answer rate are explicitly not measured.

Prepare the same pinned corpus as a deterministic RAGFlow projection without sending anything over the network:

```sh
npm run prepare:ragflow -- --repo /path/to/edu-trigonometria-pretemporada --output /tmp/ragflow-pilot.json
```

Every projected chunk carries a stable projection ID plus `repo`, `ref`, `path`, `section`, observed time, stale status and original evidence ID. The projection is explicitly `canonical_write: false`.

When a private RAGFlow dataset already exists, the evaluator can run the B lane without changing serving:

```sh
COGNITION_ENABLED=true \
RAGFLOW_SHADOW_ENABLED=true \
RAGFLOW_API_URL=http://127.0.0.1:9380 \
RAGFLOW_API_KEY='<configured-secret>' \
RAGFLOW_DATASET_ID='<project-dataset-id>' \
node scripts/evaluate-pilot.js --repo /path/to/edu-trigonometria-pretemporada
```

`RAGFLOW_RERANK_ID` and `RAGFLOW_VECTOR_WEIGHT` are optional host configuration. The report records `ragflow_shadow` separately from the BM25 baseline and Hindsight lane. This package does not provision RAGFlow, Elasticsearch/Infinity, MySQL, object storage, Redis/Valkey or task workers.
Hindsight was not installed, deployed or configured in the inspected environment; no corpus has been sent to it. Do not label fixture tests as a real Hindsight benchmark or isolation test. Once a private endpoint is available, ingest requires a deliberate command and rejects public endpoints:

```sh
HINDSIGHT_API_URL=http://127.0.0.1:8888 \
  node scripts/ingest-pilot.js --repo /path/to/edu-trigonometria-pretemporada --confirm-public-corpus
COGNITION_ENABLED=true HINDSIGHT_SHADOW_ENABLED=true HINDSIGHT_API_URL=http://127.0.0.1:8888 \
  node scripts/evaluate-pilot.js --repo /path/to/edu-trigonometria-pretemporada
```

No bank, runtime or LLM credential is provisioned by this package. A real Hindsight comparison remains blocked until an isolated private runtime, separate bank, deletion/revocation and cross-project isolation are tested.

## Rollback

Leave the flags off or remove the `createMcpHandlers` registration. Git/docs and existing Engram usage stay in place. Hindsight-derived rows and RAGFlow indexes are disposable, rebuildable shadow data; no canonical or operational writes need reversal.

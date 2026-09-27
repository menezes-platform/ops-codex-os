# ADR 0007: Provider-Neutral Cognitive Memory for Coding Agents

- **Status:** Accepted for implementation; Hindsight serving and runtime pilot deferred
- **Date:** 2026-09-27
- **Owners:** Agent OS / Memory architecture
- **Pilot:** `project/menezesx2k26-byte/edu-trigonometria-pretemporada`

## Problem

Agents need selective project recall across sessions without loading full Git history, chat transcripts or every project document. Existing sources already have distinct authority: Git/project docs for software, PersistFlow for execution, Resident Node for local jobs/security, the private Memory repository for canonical account context, Engram for episodic search, and Gabriel Object Store for durable blobs. Adding Hindsight as a system of record would duplicate those responsibilities and weaken conflict resolution.

## Current state

- Engram is a connected hybrid semantic/keyword transcript search. Its project argument matches conversation-title prefixes and tags; it is a relevance selector, not a tenant/security boundary. The real pilot-scoped query returned zero records.
- `Memory` PR #3 (`eb23f7ef3478edf4f44a4a43bbacf75e0ce66336`) added a private, non-promoting account candidate schema and validator. The default scope is intentionally `account/gabriel`.
- Current Git/project docs outrank derived output. A project-specific candidate requires a trusted exact scope and must remain in that project's review workflow.
- PersistFlow, Resident Node, Object Store and project-local docs already own separate execution, local runtime, blob and project-source responsibilities.
- No Hindsight service, URL, bank or credentials were found in the examined repos or Railway inventory. Docker and Hindsight packages are absent in this workspace.

## Alternatives

1. **Adopt the full Hindsight stack as memory authority.** This would add a separate bank/database, retrieval/write paths and trust model; it would overlap Engram, project docs and canonical Memory. Rejected.
2. **Use Hindsight selectively behind our interface.** Keep Engram as episodic baseline; add an opt-in Hindsight adapter for a single public project in shadow mode; preserve current sources and promotion gate. Chosen.
3. **Implement every cognitive capability ourselves.** Would duplicate extraction, hybrid retrieval and consolidation logic without an operational advantage. Rejected for this slice.
4. **Keep the current system unchanged.** Safe but does not establish the provider abstraction or provide measurable pilot tooling. Rejected as the final direction; used as fallback whenever providers are off/unavailable.

## Decision and provider contract

Add `MemoryCognitionProvider` in `skills/memory-cognition` with neutral `recall`, `derive` and `explain` operations. Normalized results always carry exact scope, provider, derived status, retrieval method, temporal fields and evidence provenance. MCP hosts register generic `memory_recall`, `memory_derive` and `memory_explain` handlers. Provider-specific types do not escape to agents.

EngramAdapter maps the existing `engram_search` fields. It preserves conversation/message/source IDs, title, tags, score/rank and timestamp if present. It only returns exact project-title-prefix results and states explicitly that this is not security isolation. It does not derive structured facts because Engram exposes no such capability.

HindsightAdapter uses documented retain/recall operations. Its bank key is generated only from an exact configured `project/<owner>/<repo>` allowlist and maps to `project--<owner>--<repo>`. Account scope and model-chosen banks are rejected. Recall is normalized with Hindsight item/document IDs, metadata, entities, event/recorded timestamps, provider and strategy. Derived observations remain cache-like and revocable by evidence reference.

The Hindsight integration is optional shadow-only. Flags default false. Serving is hard-disabled in the code until the pilot has real evidence for retrieval gain, isolation, provenance, contradiction handling, acceptable costs/latency and fallback stability. In shadow mode, the evaluator sees both result sets while the agent receives the baseline result only. The package does not create banks or deploy services; a separately provisioned private runtime and deterministic pilot bank are prerequisites.

## Project candidate path

Hindsight `derive`/retain may produce project candidate schema v2 objects. Required fields include provider, exact scope, source provenance, observed time, `derived_from`, confidence basis, freshness and contradiction state. Uncalibrated confidence is `null`. The pilot candidate marks `contradiction_status: "not_checked"` and `canonical_write: false`; the Memory validator returns sanitized `ready_for_review` status only when invoked with the exact trusted project scope.

The account validator remains account-only by default and schema v1 remains compatible. Schema v2 is additive. Project candidates are never written to the private account repository, canonical project docs or Git by a provider. Current source/runtime checks, contradiction review and a human-reviewed Git change remain the promotion gate.

## Pilot, corpus and isolation model

The selected low-risk corpus is the public Astro/React education project `edu-trigonometria-pretemporada`, pinned at `d95a196a07036e21e09e1e08cfdff9baaa2200ea`. The manifest lists five current files plus historical README and Wrangler config from release `64c6d83`, along with bounded Git commit history. Its README explicitly excludes private reference PDFs. A scan of the repository's 28 tracked files found no configured secret-pattern hits. The corpus excludes personal chats, Memory, Drive, credentials, private PDFs and other projects.

The bank allowlist prevents arbitrary scope selection, and result metadata from a different repo is discarded. This code-level check is defense-in-depth only. It does **not** prove Hindsight's real database isolation. Until a live separate bank is tested with adversarial cross-project reads and delete/revoke checks, Hindsight remains unconnected and shadow scope remains limited to this public project.

## Failure and promotion policy

- Hindsight offline, timeout, malformed JSON, 429, 5xx or database failure: keep baseline results; bounded maximum two attempts with jitter; open a short circuit after repeated failures; no retry storm.
- Empty/partial/duplicate ingest: report sanitized counts; stable document IDs make replay idempotent; no candidate is promoted.
- Candidate conflict or stale source: mark review/stale/conflicted and re-check current Git. Git wins.
- Secret-like content: reject before retain; never log the matched content.
- Memory Defense, if later enabled, is defense in depth, not the only scanner or authority gate.
- Mental models/knowledge pages are deferred until the Hindsight runtime is stable and freshness/revalidation is proven.

## Responsibility overlap map

| Hindsight capability | Existing component | Gap | Decision |
| --- | --- | --- | --- |
| Episodic recall | Engram transcripts + Git history | Engram has no hard project isolation; repo history is verbose | Keep Engram baseline; Hindsight recall only shadow |
| Structured facts/entities/relations | Project source/docs; no shared derived graph | Cross-file derived linkage with evidence | Keep Hindsight shadow; candidates only |
| Temporal recall | Git commit history and project docs | Unified search across versions | Keep Hindsight shadow; current Git still wins |
| Observations/consolidation/proof | Memory candidate schema + reviewer gate | Cross-evidence derived proposal | Augment schema v2; never promote automatically |
| Mental models/knowledge pages | Project-local docs/ADRs | Cached summary with freshness metadata | Defer until real pilot and invalidation proof |
| Agent session learning | Engram + Git/project sessions where available | Reuse verified past project context | Keep behind the provider contract; scope by repo |
| Run/checkpoint/fleet truth | PersistFlow | None | Do not adopt; execution authority stays there |
| Durable files/exports | Gabriel Object Store / Drive | None | Do not adopt as a vector DB or transactional store |
| Canonical account facts | Memory repo | Candidate gate already exists | Keep existing; Hindsight cannot write it |
| Local durable jobs/security/audit | Resident Node | None | Do not adopt |
| Semantic response cache | Dev-Orquestra Redis/RedisVL shadow cache | Different purpose | Keep distinct; do not repurpose as agent memory |

## Recommendation matrix

| Hindsight capability | Recommendation | Evidence from this slice |
| --- | --- | --- |
| Entity/fact extraction | **KEEP SHADOW** | Adapter/candidate contract and redaction tested; no live output measured |
| Evidence-backed observations | **KEEP SHADOW** | Provenance and `not_checked` review semantics implemented; runtime offline |
| Semantic + BM25 + graph + temporal recall | **KEEP SHADOW** | Hindsight adapter uses documented recall endpoint; no real results/quality comparison yet |
| Reranking | **KEEP SHADOW** | Returned order is preserved; no latency/quality data yet |
| Incremental retain/agent learning | **DEFER** | Explicit project-only ingestion tool exists but was not run; LLM cost/service absent |
| Mental models/knowledge pages | **DEFER** | No stable runtime or freshness/refresh evidence |
| Memory Defense | **DEFER** | No live bank configuration; local redaction remains required |
| Hindsight replacing Engram/Memory/Git/PersistFlow | **DO NOT ADOPT** | Direct conflict with existing authority boundaries |
| Hindsight as agent-serving recall | **DEFER** | Acceptance criteria cannot be measured until actual isolated shadow runs |

No capability is recommended for serving now.

## Benchmark result and limits

The fixed 10-query benchmark measures only the local BM25 index built from current and historical Git/docs content in the pilot repository. Separately, the real Engram adapter was queried once with the exact project filter and returned zero records; Engram did not contribute to the 10-query metric series. The current report records 39 passages, 13,637 source-text bytes and a 28,241-byte serialized BM25 index representation (not process RSS). BM25 measured hit rate `0.875`, precision@5 `0.225`, recall@5 `0.8125`, MRR `0.6146`, temporal retrieval `1.0`, and one current-over-stale contradiction ordering success. Recall p50/p95 were `0.21/1.25 ms` in the latest run. Context size averaged 642 tokens estimated as UTF-8 bytes divided by four; actual model token counts are unavailable. No LLM was called by the baseline, so LLM input/output tokens are N/A, calls are zero and cost is zero.

These are local lexical BM25 figures, not an Engram-vs-Hindsight quality comparison. Hindsight shadow metrics are **unavailable**, since no runtime, bank, credential or safe LLM endpoint was present. Answer abstention/unsupported-answer rates are also **not measured** because this is retrieval-only and has no answer generator. Hindsight tokens, cost and index size are unavailable; no values are fabricated. See `skills/memory-cognition/pilot/benchmark-report.json` for per-query evidence IDs and the complete sample.

## Rollback and migration

Rollback means leave flags off or remove MCP handler registration. Baseline Git/docs and existing Engram remain unchanged. Hindsight retains only rebuildable derived data for the pilot bank; deleting that bank removes the shadow corpus. No Memory canonical file, Git ref, PersistFlow state, Resident Node state, Drive object, project doc or production runtime is modified by provider recall/derive.

Migration path: (1) run isolated private Hindsight runtime and create only the deterministic pilot bank; (2) secret-scan and explicitly ingest the manifest; (3) run the fixed shadow suite and adversarial project-A/project-B isolation checks; (4) test stale/current Git conflict, deletion/revocation, crash/restart, latency, token/cost, and fallback; (5) compare against the fixed baseline; (6) only then revise this ADR to consider serving. No serving flag can be enabled by this release.

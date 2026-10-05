# P05 — retrieval preparation checkpoint

- `phase_id`: `P05`
- `checkpoint_id`: `P05-RETRIEVAL-PREP-2026-10-05T02:04:00Z`
- `recorded_at`: `2026-10-05T02:04:00Z`
- `status`: `SOURCE_PREPARATION_ONLY`
- `P05_formal_entry`: `NOT_SATISFIED`
- `DoD`: `NOT_MET`
- `frozen_spec`: `unchanged`
- `evidence_scope`: local tracked source and test inspection; no live retrieval, Drive, provider, or Hostinger calls

## Entry gate

The frozen migration plan requires P04's indexing runtime to be available before formal P05 entry. Resident Node `main` at `14b4cb2f94227d918c42564447f50f28e4763c88` contains the existing execution core, but no `indexing-runtime`, FAISS/BM25 runtime, or embedding module was found in its tracked file inventory. The P04 fencing change remains source-only in draft PR #1; it does not supply the indexing runtime or P04 migration/rollback receipts. Therefore this work records reusable retrieval preparation only and does not advance the formal P05 gate.

## Source evidence

| Surface | Classification | Observed evidence | Boundary |
| --- | --- | --- | --- |
| `ops-codex-os` `skills/memory-cognition` | `SOURCE_AND_TESTS_OBSERVED` | A local Git/docs BM25 pilot builds a small index from a pinned corpus; the report describes 39 passages. The provider contract carries explicit project scope, provenance and derived status. | This cognition pilot is not the target Drive-backed Context Store or execution-plane indexing runtime. |
| Project scope and shadow isolation | `SOURCE_AND_TESTS_OBSERVED` | `canonicalProjectScope` and the optional RAGFlow adapter map explicit projects to host-configured dataset allowlists; returned foreign dataset/repository rows are filtered. RAGFlow tests also verify an unallowlisted scope fails closed. | These are source-level filters and tests, not proof of physically separate production indexes or zero leakage across the complete target corpus. |
| RAGFlow serving | `SOURCE_AND_TESTS_OBSERVED` | The skill and README describe RAGFlow as optional shadow evaluation; serving is hard-coded false, and a regression test confirms setting `RAGFLOW_SERVING_ENABLED=true` cannot turn it on. | No deployed dependency inventory proves RAGFlow is absent from every live required path. |
| BM25 pilot regression suite | `TESTS_OBSERVED` | `node --test skills/memory-cognition/tests/*.test.js` passed **30/30** tests on this checkout, including scope allowlists, foreign-result rejection, derived-only behavior, and shadow-not-serving behavior. | These tests do not cover target FAISS, Drive corpus, incremental/full rebuild, generation promotion/rollback, or production integration. |
| Drive storage code | `DOCUMENTED/IMPLEMENTED_FOR_OTHER_DOMAIN` | `persistd/src/storage/` has Drive client/object storage modules for fleet storage. | Fleet object storage does not establish the Context Store corpus contract; do not infer that it can be safely reused as a project retrieval store. |
| Target retrieval modules | `NOT_FOUND_IN_SCANNED_REPO_REFS` | No target `context-store`, `retrieval`, `context-gateway`, or Resident Node `indexing-runtime` implementation appeared in the bounded tracked-source scan. | The scan is limited to these checked-out repository refs; it is not a global deployment or account inventory. |

Source anchors: `skills/memory-cognition/SKILL.md:16,19`; `skills/memory-cognition/README.md:12,20,51,82`; `skills/memory-cognition/src/index.js:23,153-220,319-350,627`; `skills/memory-cognition/tests/ragflow.test.js:14-181`; `skills/memory-cognition/scripts/evaluate-pilot.js:90,447-468`; frozen phase entry at `docs/architecture/spec-kit/07-migration-phases.md:60-72`.

## P05 and DoD gaps

- P04 indexing runtime and formal entry receipts are missing.
- A Drive-backed normalized project corpus with provenance and versioned manifests is not established.
- Physical isolation of each project's corpus and index is not proven.
- The target BM25 + FAISS execution path behind Context Gateway is absent; current local BM25 is a bounded pilot.
- A global local embedding profile and structural chunking profile are not selected/versioned in a target manifest.
- Incremental updates, periodic/full rebuild, candidate validation, current/previous publication and rollback have no target tests or receipts.
- The existing scope tests are useful regression inputs but do not prove full-corpus or production cross-project leakage = 0.
- RAGFlow serving is disabled in this source package, but complete live runtime/dependency evidence is still required before the DoD's RAGFlow dependency count can be closed.
- Retrieval quality/performance is measured only for the limited local BM25 sample; no target hybrid retrieval acceptance run exists.

## Safe disposition

Keep P05 `PREPARATION_ONLY` until the P04-owned indexing runtime and producer-owned interface exist. Preserve the tested local scope/provenance/shadow guards as candidate contracts. Continue independent P06/P07 source and policy preparation while P04/P05 entry gates remain explicit. No Drive data was read or written; no credential, deployment, provider, index, corpus, or canonical state was changed.

The frozen DoD matrix is in [`2026-10-05-frozen-dod-evidence-matrix.md`](2026-10-05-frozen-dod-evidence-matrix.md). This checkpoint does not modify the Spec Kit or claim any P05 exit criterion passed.

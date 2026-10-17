# ADR 0012 — Drive-first episodic authority, staged and reversible

**Date:** 2026-10-15
**Status:** Proposed source implementation, **NOT LIVE**; migration approval exists but technical acceptance gates **NOT PASSED**
**Owner decision:** User approved RAG final Drive-first approach and source implementation on 2026-10-15.
**Scope:** Personal episodic memory for controlled agents; not personal canonical Git Memory or project Git sources.

## Context
The architecture currently treats Engram as the episodic retrieval source, while Git is authority for project facts, private `menezesx2k26-byte/Memory` is canonical personal context, and PersistFlow is execution authority. The user does not want essential memories stranded in an external episodic service with potentially changing pricing. The user also wants agents to reliably consult stored history instead of trusting ad hoc ChatGPT tool invocation.

## Decision and owner constraints
1. Promote an independently backed, Drive-first episodic archive to source of truth **only after** authenticated owner-authorized export, immutable upload/readback, tested complete fresh restore, version/rollback receipts, and explicit runtime cutover approval. Until then **Engram remains the existing architectural episodic provider**, optionally mirrored by consent and explicit scope.
2. The repository owns Context Gateway and policy contracts; the Execution Plane owns index and physical runtime. Google Drive holds private durable episodic events, content-addressed manifests, and backups. Active SQLite/FAISS files stay in local non-synchronized storage, and are rebuildable.
3. Ingestion is opt-in per source with clear revocation, selected-text capture by default, sensitive-app exclusions, secret redaction, size limits and prompt-injection defenses; no blanket Android capture or bulk private chat ingestion.
4. The service treats episodic notes as **non-authoritative** for account or project facts. User-approved durable facts go to private Memory via separate explicit review; project facts always remain in Git; PersistFlow decisions are not overwritten.
5. A model cannot request another user's personal scope or bypass owner authentication; no project-to-personal fallback and no implicit multi-project recall. Response generation in controlled agents is preceded by retrieval when relevant and fails explicitly when unavailable. Native ChatGPT app behavior remains outside this enforceable boundary.
6. Engram may remain a read-only supplemental, non-essential candidate source, but must never be the only available source of retained important episodes. Tests must simulate Engram completely disconnected.
7. Indexes are derived; support tombstones, provenance, accurate UTC timestamps, revisions, rebuild, current/previous rollback, and export/import in an open format.
8. Cost envelope forbids any paid third-party service or hidden upgrade without authorization. Android capture/permissions require separate opt-in and physical-device tests.

## Required migration acceptance receipts (all independent)
- Owner consent grant (scope, sources, exclusions, revocation) observed.
- Drive authenticated write/read verification of original bytes, digest and private folder access.
- Complete export into portable verified archive, encrypted backup under owner control, restore to empty store, tombstone replay, roundtrip digest match; no plaintext secret or private contents in logs.
- Rebuild of indexed temporal corpus, BM25+FAISS, generation CAS current/previous and actual rollback test.
- Zero cross-scope leakage in adversarial tests and blocked model-provided scope injection.
- Engram disconnected end-to-end test still succeeds from authoritative Drive/Execution Plane.
- Full CI/rust/android tests, recovery after reboot, performance guardrails on constrained Windows host and Moto G75, original source readback, signed or pinned release evidence.
- Provider failures are visible as unavailable/miss/stale; no fabricated memory or claims of unseen Drive reads.
- Rollback plan preserves old provider settings/receipts until owner-approved migration finalization.

## Source-only evidence currently available
Initial tests and files in feature branch `feat/rag-final-drive-first-20261015` implement an authority guard, validated episodic event schema, local immutable storage adapter, offline backup/restore, scoped personal retrieval interface, memory-based answer enforcement and a structural final DoD gate. They **do not prove** Drive connector, Rust/FAISS live index, Android or production authority migration.

## Rejected alternatives
- Engram sole authority (commercial dependency and possible lock-in).
- Reading all Drive contents on every question (latency, cost, over-broad access).
- Treating a raw model response or conversation transcript as canonical personal fact (false authority).
- One full-time background model on 8 GB Windows host or Android (resource and privacy cost).

## Rollback and decision gate
Keep runtime authority unchanged unless every migration receipt is independently read back and owner explicitly approves cutover. If any proof is missing, remain in source-only shadow mode. Store the signed review and exact rollback method alongside the formal P05 execution checkpoint. No production switch, permissions, deployment, merge, or paid spend is authorized by source-level test success alone.
# RAG Final — Superpowers Writing Plans (Program Index)

**Date:** 2026-10-15
**Status:** **OWNER APPROVED FOR SOURCE IMPLEMENTATION; OPERATIONAL GATES REQUIRED**; no implementation, external deployment or Spec Kit mutation.
**Planning method:** `superpowers:writing-plans` (isolated, independently reviewable lanes; RED → GREEN → commit).
**Plan basis:** the earlier *42-task estimate* is split into **10 canonical P05 tasks already planned** + **32 newly proposed tasks**. This is **scope sizing, not 42 tasks verified pending**.

## Why this is not a fresh Pieces clone

Build on the existing `menezes-platform/ops-codex-os` Context Gateway/Store, Rust `menezesx2k26-byte/resident-node` indexing/authority and existing P05 plan. Drive is the proposed source for user-approved episodic events **only after a domain migration ADR**. Engram is optional. Private Git Memory and Git code/project state remain canonical in their domains.

## Canonical P05 — Tasks 1–10, reuse, do not reimplement

- Source: `docs/superpowers/plans/2026-10-11-p05-hybrid-rag.md` on draft PR #36.
- Task 1 prerequisites, 2 scoped Drive corpus, 3 local embedding, 4 CAS current/previous, 5 native FAISS, 6 BM25+FAISS hybrid, 7 incremental/rebuild/delete, 8 Gateway integration, 9 adversarial benchmarks, 10 runtime acceptance.
- Additional hardening plan: draft PR #38; source-only work and checkpoint in PR #37. P03/P04/P05 are **not proven PASSED**. Avoid double counting.

## New scoped plans and independent acceptance

| Lane | Tasks | Deliverable | Depends on |
|---|---:|---|---|
| A — Drive Episodic Ingest | 11–18 (8) | Opted-in durable events, receipts, offline portable archive | Owner-approved authority ADR, P05 corpus patterns |
| B — Memory Derivation / Retrieval | 19–26 (8) | Dated evidence, contradiction handling and local personal index | A + qualified P05 physical index |
| C — Recall Enforcement / Trust | 27–34 (8) | Scoped `MemoryRecallV1` with mandatory recall in controlled agents | B + current Context Gateway client |
| D — Pocket Agent / Recovery / DoD | 35–42 (8) | Optional Android event source, bounded resource usage, real restore and release proof | A–C + Android SDK/permissions; desktop memory usable before D |
| **Total** | **42 planned task slots** | **10 existing + 32 new** | No automatic production promotion |

### Files

- `../specs/2026-10-15-rag-final-drive-first-design.md`: proposed design (must be approved before any implementation).
- `2026-10-15-rag-final-a-drive-ingest.md`: tasks 11–18.
- `2026-10-15-rag-final-b-memory-index.md`: tasks 19–26.
- `2026-10-15-rag-final-c-recall-enforcement.md`: tasks 27–34.
- `2026-10-15-rag-final-d-pocket-dod.md`: tasks 35–42.

## Critical design choices for review

1. **Source authority:** Drive as new canonical opted-in episodic store (after ADR) versus projection-only; never silently revoke Engram's current architectural status.
2. **Privacy:** capture OFF by default; no unrestricted Android screen/background recording or private message ingestion; reviewed explicit consent.
3. **Recall contract:** controlled agent host can enforce must-retrieve; native ChatGPT connector auto-invocation **cannot be guaranteed**.
4. **Operator constraints:** current 8 GB workstation and Moto G75 call for measured CPU/battery/RAM budgets and offline fallback, not a permanent heavy always-on daemon.
5. **Deployment:** no implicit paid services, no automatic scope expansion, no one-shot big-bang merge; feature-by-feature releases with failure/rollback receipts.

## Two reviews before implementation

1. Review and approve/revise the **design draft and authority migration ADR**; if declined, downgrade Drive to a backup/projection only. Mark the Spec Kit changes separately for architectural approval.
2. Review the **four task plans** and choose implementation mode (`superpowers:subagent-driven-development` or `superpowers:executing-plans` native). Then prepare isolated worktrees and start Task 11 at a verified RED state. Canonical P05 work follows its own entry gate.

## Sources verified 2026-10-15

- [Constitution](https://github.com/menezes-platform/ops-codex-os/blob/main/docs/architecture/spec-kit/00-constitution.md)
- [Architecture design](https://github.com/menezes-platform/ops-codex-os/blob/main/docs/superpowers/specs/2026-10-02-platform-consolidation-design.md)
- [P05 plan PR #36](https://github.com/menezes-platform/ops-codex-os/pull/36)
- [P05 hardening PR #38](https://github.com/menezes-platform/ops-codex-os/pull/38)
- [P05 partial source PR #37](https://github.com/menezes-platform/ops-codex-os/pull/37)
- [P05 policy Drive staging](https://drive.google.com/drive/folders/1GyjkupC3vsMH-KewDo7RnkqxOZ40aMBj)
- [Resident Node](https://github.com/menezesx2k26-byte/resident-node)
- [Pocket Agent Android](https://github.com/menezesx2k26-byte/pocket-agent-android)

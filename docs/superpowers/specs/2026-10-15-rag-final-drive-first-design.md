# RAG Final Drive-First — Design Draft

> **STATUS: OWNER APPROVED FOR SOURCE IMPLEMENTATION (2026-10-15); MIGRATION/PRODUCTION GATES OPEN.** This document is an explicit proposal extending the approved P05 platform design. It does not change the current Spec Kit, reassign any production authority, or authorize implementation, cloud costs, merges, or deployment.

**Date:** 2026-10-15

## Intent and primary outcome

An owner-controlled memory system for Codex, chat-connected agents, and optional Pocket Agent, in which **Google Drive stores durable normalized episodic events and document projections**, Git keeps authority over project code/technical decisions, private `menezesx2k26-byte/Memory` keeps authority over personal long-term facts, PersistFlow owns run/checkpoint state, and any Engram lookup is optional. The system must recall the right evidence, with timestamps, provenance, privacy controls and explicit misses/failures, without trusting an LLM to decide unilaterally whether to use memory.

This final system is not a full Pieces clone, a replacement for the primary execution controller, a default Android screen recorder, or a claim that the consumer ChatGPT interface can be forced to use connected tools.

## Evidence and precedence

- Approved constitutional rule: exactly one authority per durable domain, producer-owned interfaces, deterministic project scopes, current evidence over prose.
- Existing P05 plan: `docs/superpowers/plans/2026-10-11-p05-hybrid-rag.md` in `ops-codex-os` draft PR #36, 10 canonical tasks.
- Current partial work: PR #37 on `execution/p05-native-entry-gate-20261011`, with source-only tests and corpus preparation; P03/P04/P05 phase exits remain unproven by inspected checkpoints.
- Host: `menezesx2k26-byte/resident-node` Rust Execution Plane; Node `modules/context-gateway`/`modules/context-store` in `menezes-platform/ops-codex-os`.
- Android repo: `menezesx2k26-byte/pocket-agent-android` currently has a short README on main; a real Android project layout has not yet been verified.
- Drive SGT staging: `RAG-Agent-OS-Policy-Staging` is staged, not indexed. Git is the authority for its policy text.

## Proposed, approval-dependent authority migration

The existing approved P05 design lists Engram as the episodic conversation source. **This draft proposes changing that domain for new opted-in episodic events** so that:

1. A new `personal/current` logically isolated corpus in an approved private folder of **SGT Menezes Google Drive** becomes the durable episodic-event authority *only after* an explicit migration ADR is accepted and a reversible pilot succeeds.
2. Old Engram entries remain optional read-only candidates. No bulk import, silent deletion, or implicit migration. Export/import happens through reviewable, consented operations.
3. Canonical durable personal preferences, identity/goals, and long-term facts remain in the private Git Memory repo. A derived RAG answer must never mutate them without a reviewed promotion.
4. Git remains canonical for code, project ADRs, specifications, build results and verified commits; PersistFlow for execution checkpoint/claim state; Drive mirrors normalized retrieval corpus and episodic events, not these authorities.
5. Drive outage never silently promotes a local cache or Engram to a new authority. Local pending writes are explicitly `PENDING`, signed/hashed, and reconciled later with the one-writer rule.

**Gate:** If the owner declines this authority change, keep episodic authority as already approved and operate Drive only as a consented backup/projection. Do not implement both competing authorities.

## Scope & interfaces

- Existing project reads: `project/<owner>/<repo>`; no untrusted cross-project widening.
- New owner-personal lane: `personal/current` resolved from authenticated runtime owner identity **not** from model text. Its interface must be separate from `ProjectScope`, which currently accepts only project format.
- Event input is a narrow allowlisted object `MemoryEventV1` with exact fields: `event_id`, `scope`, `kind`, `source_type`, `source_ref`, `source_revision`, `observed_at` (RFC3339 UTC), `content_sha256`, `content`, `consent_receipt_id`, `schema_version=1`; reject unknown fields. Content is bounded, private, user-consented and reviewed for secrets. Hashes allow integrity checks, not privacy guarantees.
- Event write receipt `MemoryWriteReceiptV1`: `scope`, `event_id`, `content_sha256`, `manifest_ref`, `status` (`stored|replayed|pending|rejected`), `observed_at`.
- Evidence output `MemoryEvidenceV1`: `evidence_id`, `scope`, `source_ref`, `source_revision`, `observed_at`, `current_state` (`current|superseded|deleted|uncertain`), `authority`, `content`, `retrieval_method`, `generation_id`.
- Lookup result `MemoryRecallV1`: `status` (`ok|miss|unavailable|denied|stale`), `evidence[]`, `generation_id`, `last_sync_at`, `reason_code`. **Never turn `miss` into a fabricated memory**.
- All ingest/export APIs are explicitly authenticated and bounded; secrets remain in approved local capability custody / `.env` for local development only, never in Drive corpus, logs, sample data or screen capture.

## Privacy, capture and data minimization

Default: **capture off**, source-by-source opt-in. Allowlist decisions and durable consent receipts per device and source class; deny passwords, token fields, authentication pages, banking/health apps, private-message bodies, hidden model reasoning, and sensitive apps by default. No automatic all-screen capture. Support source exclusion, pause, revoke, tombstone, local queue purge, export and restore. Filter secrets before persistence and prevent raw-content logging. No analytics, telemetry to third parties, account signup, ads, or paid model requirement. Android Shizuku only as optional capability; never assume root/universal accessibility; use documented permission flows.

## Four independently reviewable feature lanes

- **A — Ingest + Drive ownership (Tasks 11–18):** private opt-in event capture, Drive persistence, integrity, migration and import/export; works without ML.
- **B — Consolidate + index (Tasks 19–26):** evidence candidates, conflict/temporal derivation and project-isolated personal hybrid index; works without Engram.
- **C — Mandatory recall for controlled agents (Tasks 27–34):** enforce the retrieval decision in controlled runtimes, safely surface failures, provenance and trust boundaries; no claim about ChatGPT native automatic tool calls.
- **D — Pocket Agent + hardening (Tasks 35–42):** safe optional Android event source, offline queue, resource budgets, recovery, real E2E and release gate; Android is not required for the first useful Drive memory slice.

The already-approved **P05 tasks 1–10 are inherited**, not rewritten or counted as newly implemented.

## End-to-end target path

Authorized event -> consent/secret check -> idempotent immutable Drive append -> manifest/revision -> local materialization outside Drive sync -> personal index -> gateway scoped recall -> policy invocation in controlled agent -> citations/timeline -> feedback or user-approved consolidation. Pending, denied, stale and unavailable are visible states. The index is disposable; source material and source-specific authorities persist.

## Concrete DoD gates

1. Real Drive-backed events survive restart and redeployment; checksum-verified export -> import -> reindex produces equivalent answer evidence on a clean isolated environment.
2. Engram disabled/revoked (and zero external paid model tokens) still allows successful end-to-end recall of approved events.
3. Cross-project and cross-personal leakage tests produce zero returned foreign evidence; untrusted prompt text cannot choose scope or connector IDs.
4. Controlled agent retrieving a prior relevant decision executes retrieval before answering; missing/failed retrieval never gets presented as remembered fact. Native ChatGPT limitation documented.
5. Git/Memory/PersistFlow are never silently overwritten by derived summaries; contradictory events are dated and traced.
6. Capture off by default; pause/revoke/purge works and sensitive sources are blocked; no raw private payloads in logs or test artifacts.
7. Offline capture queue is bounded, encrypted with platform keystore as applicable, and resumes idempotently; no silent data loss or duplicate commits.
8. Performance budgets are measured and reported (no fabricated throughput): baseline current 8 GB RAM PC and Moto G75 need explicit operator-configured CPU/battery/RAM tests; no unapproved paid infrastructure.
9. P03/P04/P05 formal gates stay blocked until independently passed. New lanes are not production-promoted merely because their tests are green.
10. Full check: Node `npm test` and `npm run validate:spec-kit`; Rust `cargo test`; Android Gradle test/build once its scaffold exists; real Drive controlled smoke; rollback rehearsal; receipts, current/previous generations, and evidence-based audit.

## Deliberate exclusions

No product-quality IDE replica, invisible screen recording, surveillance, OCR of everything, automatic use of personal context in technical questions, automatic self-modifying canonical memory, direct model control of authority/scope, multi-primary ledger, new permanent cloud DB, paid embedding/model/API by default, RAGFlow serving, promise of consumer-ChatGPT guaranteed Drive connector invocation.

## Design review issues (must be owner-approved before implementation)

- Whether the episodic canonical authority can migrate from Engram to SGT Drive in a separately approved ADR, versus Drive being only a projection.
- Exact personal event retention and revocation policy; default proposed **capture off + explicit user deletion**, not indefinite retention of ambient screen content.
- Which Android app sources are allowlisted and what Android 16 permissions the first release may request.
- Whether any conversations are imported retrospectively; default proposed **no bulk import**.
- Budget and acceptance targets for performance, especially 8 GB Windows/WSL and Moto G75; measure before pinning a threshold.

## Source links

- Spec Kit constitution: https://github.com/menezes-platform/ops-codex-os/blob/main/docs/architecture/spec-kit/00-constitution.md
- P05 original plan: https://github.com/menezes-platform/ops-codex-os/pull/36
- P05 draft implementation: https://github.com/menezes-platform/ops-codex-os/pull/37
- P05 Native hardening: https://github.com/menezes-platform/ops-codex-os/pull/38
- Existing design: https://github.com/menezes-platform/ops-codex-os/blob/main/docs/superpowers/specs/2026-10-02-platform-consolidation-design.md
- Drive staged policy packet: https://drive.google.com/drive/folders/1GyjkupC3vsMH-KewDo7RnkqxOZ40aMBj

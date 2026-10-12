# Global Agent Policy — RAG Source Staging (2026-10-12)

**Status: STAGING_ONLY; NOT INDEXED; NOT P05 ACCEPTED.** This file is a locator and an ingestion handoff, not a new authority or proof of live retrieval.

## Why this exists

The user asked to preserve *all layers* of the global agent rules in the eventual hybrid RAG. The canonical public sources remain this repository's Git tree. The present Drive staging package supplies (a) 15 concise rule-level retrieval entries, (b) a pinned inventory of 34 Git documents, and (c) a README with the publish gate. A summary cannot replace the original rules. Ingestion must fetch authoritative file bodies from Git at the declared revision or its reviewed successor.

## Verified staging in SGT Menezes Drive

- Folder: https://drive.google.com/drive/folders/1GyjkupC3vsMH-KewDo7RnkqxOZ40aMBj
- Rules document: https://drive.google.com/file/d/1Y8KebjS0mRP7tcaPvuxgs2JVUiffLU5p/view
- Source manifest: https://drive.google.com/file/d/1LfWzHEo5gcZB33YDpy3HCRYs8dpx213J/view
- README: https://drive.google.com/file/d/1ck8sn038QPeWNh74gNZehxc-U6O0wRK2/view
- Upload and Drive metadata/parentage readback were checked on 2026-10-12. This is **not** an indexing receipt.

## Canonical source set

- Git repo: `menezes-platform/ops-codex-os`.
- Snapshot commit: `3a5078c97cc7ee7e2fffaf80bc9b0d1b23f7be48` (PR #39 merge).
- 1 global `AGENTS.md`, README, 18 `skills/*/SKILL.md`, 13 Spec Kit files, and architecture index README (**34** unique source paths).
- Source manifest provides each pinned Git URL and its declared layer.
- **15 thematic rules** are a user-facing retrieval aid and must be marked a derived projection.

## Scope and authority boundaries

- Proposed project scope: `project/menezes-platform/ops-codex-os`. Do not implicitly broaden recall to other projects.
- Git alone owns global/project rule and source text. Context Store is the Drive-backed corpus projection; BM25 and FAISS are rebuildable derived indexes.
- Private personal `menezesx2k26-byte/Memory` must **not** be ingested into the public/project pilot; its authority is personal context, not Agent OS policy. Engram episodic memory and PersistFlow run-continuity also stay in their separate authority domains. No secrets, chat transcripts or unrestricted Drive corpus.
- The approved P05 pilot constraints in the Superpowers plan still apply; this package is not authorization to widen a pilot dataset or bypass P03/P04 phase gates.

## Exact acceptance gate for future promotion

1. Read the current approved P05 plan, spec kit, and P03/P04/P05 entry evidence. If gates remain blocked, keep this staging-only.
2. Reconcile the manifest snapshot with latest Git and record revision, diff/deletions and explicit project scope.
3. Materialize only approved files through the official Context Store/Execution Plane interface; structural-chunk by `path + heading` with source ref, commit, scope and provenance. Never silently promote the summary as independent authority.
4. Verify content and dedup receipts, versioned local embedding profile, BM25+FAISS, separate project index, adversarial zero-leakage tests, and `current/previous` publication/rollback.
5. Run real Context Gateway queries covering all 15 policies (especially first functional slice) and record cited source IDs, revision, run receipt, test outputs and production/local scope.
6. Update status to INDEXED only **after** the above verified evidence. Store that receipt in the owning project/phase checkpoint. This doc deliberately does not claim a deployed or searchable P05.

No new infrastructure, index deployment, paid model calls or account-wide recall is authorized by this documentation action.

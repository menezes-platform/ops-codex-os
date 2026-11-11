# Retrieval evidence gate — 2026-11-11

Status: SOURCE_CHANGE + LOCAL_TDD_GREEN, NOT_MERGED, NOT_DEPLOYED, NOT_INDEXED.

## Incident and proven source mismatch
A tool-substitution conversation asserted approximate substitutes for a ChatGPT-operated desktop/browser/terminal/multi-worker automation stack despite lacking proof of parity. The user's constraints included preserving the ChatGPT subscription rather than shifting every workflow to a separate Codex/API quota. The failure was retrieval-to-claim promotion, not evidence that any alternative does or does not exist.

The canonical Agent OS repository was observed under menezesx2k26-byte/ops-codex-os. Previous paths using menezes-platform/ops-codex-os redirect; agents must resolve the current repository identity before negative status claims. PR #57, draft, independently covers stale cross-agent/branch status answers. This stacked change does not edit PR #57 or the existing private personal RAG snapshot.

## Narrow change
- Global AGENTS requires explicit retrieval of required capabilities and provenance before full-replacement claims.
- Reusable evidence-grounded-tool-equivalence skill defines how to compare partial vs full functionality, unknown evidence, subscription/API costs, runtime proof and links.
- Dependency-free scripts/capability-evidence-gate.js mechanically rejects incomplete, stale and contradictory positive claims.
- Six deterministic Node tests reproduce an erroneous "complete replacement" recommendation and cover current-proof, explicit negative, expired source, contradictions and complete proof.

## Evidence
- RED locally (Node v22.16.0): MODULE_NOT_FOUND before implementation. This is only a red-before-green local run, not evidence that the old repository had a wired runtime.
- GREEN locally (Node v22.16.0): node --test tests/capability-evidence-gate.test.js => 6 PASS, 0 FAIL, 0 SKIP, using the standalone files before GitHub upload.
- GitHub source write/readback and any CI status must be recorded separately; the local test is not a full checkout or production end-to-end proof.
- This change adds no paid provider, secret, production credentials, browser connection or user data.

## Non-claims and remaining gates
- Does NOT activate, rebuild, sync or publish personal RAG FTS5/BM25, FAISS, RAGFlow or GraphRAG.
- Does NOT change ChatGPT's native memory/retrieval internals or prove that AGENTS is consumed by ChatGPT in all conversations.
- Does NOT assert live equivalence or availability of any third-party desktop tool.
- For real RAG closure, separately require authenticated source readback, revision/hash manifest, isolated scopes, incremental index-generation build, current/previous rollback, source-vs-index freshness receipt and evaluated queries with citations. A Drive mirror run, Git commit or memory append alone is never such a receipt.

## Integration boundary
Stacked on branch fix/context-status-reconciliation-20261029, which is the draft PR #57 head; do not merge this child into main independently without reconciling parent and CI. Avoid edits to concurrent PR #46, #60, #61.

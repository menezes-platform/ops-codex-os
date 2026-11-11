# RAG — personal-only controlled-host isolation and read paths (2026-11-11)

**Status:** SOURCE IMPLEMENTED / FOCUSED WINDOWS TESTS GREEN / NOT MERGED / NOT DEPLOYED / NO PERSONAL INDEX PUBLICATION.

## Goal and scope
Continue the existing RAG, preserving the integration head in PR #46 and the scoped recall fix in PR #63. Close a confirmed controlled-Gateway coupling: personal recall was blocked unless a Git project resolver and index writer existed, even for a trusted personal owner. A separate personal provider also accidentally fell back to project retrieval.

## Changes
- The Context Gateway accepts a host-injected `personalRetrievalClient` with `retrieve()`, independently of any project `executionPlaneClient`.
- The personal-only host can answer a history query when `resolvePersonalOwner` provides a verified owner, without an active Git checkout or write privilege.
- Personal and project lanes do not fall through into each other's clients. An explicitly malformed personal provider fails at construction rather than silently using a project client.
- Read-only project retrieval works without an index writer; reindex fails closed with `PROJECT_INDEX_WRITER_REQUIRED`.
- Personal-only hosts reject project reads, project reindex, and multi-project retrieval with an explicit error.
- The existing injected client remains a compatibility fallback only when no dedicated personal provider was configured. This does NOT make the HTTP project-only client a personal transport.

## Reproduction and verification
- RED 1: `tests/context-gateway-personal-only-host.test.js`: **5/5 failing** against the original PR #63 Gateway; source demanded a project executor and reindex writer.
- GREEN 1: **5/5 passing** after decoupling.
- RED 2: `tests/context-gateway-separate-personal-provider.test.js`: **4/4 failing** without a dedicated personal retrieval injection.
- GREEN 2: **4/4 passing** after client split, with previous 10 tests still green.
- RED 3: a personal-only multi-project call raised raw `TypeError` instead of an explicit denial. Added a guard.
- FINAL FOCUSED REAL WINDOWS run: Node test runner over **8 test files / 50 tests**: **50 PASS / 0 FAIL / 0 SKIP**, on approved temporary workspace on DESKTOP-L6CITUI. Tests included the original Context Gateway personal/project/transport suite, HTTP client guards, owner isolation, temporal filters, scope/follow-up regression and new personal-only transport cases. The temporary test workspace was removed.
- Source files were independently fetched from GitHub branch immediately before the run. No deployment, live query to personal index, Cargo full-suite, or complete Node repository suite was performed. The tests use controlled, synthetic provider responses.

## Runtime and security gate still open
- `menezesx2k26-byte/resident-node` branch `integration/rag-final-20261017` already contains typed Rust personal materialization/tests, but `PersonalLedger::open()` intentionally returns `EncryptionRequired` for real personal data; only synthetic tests can open plaintext SQLite. Do not bypass this guard.
- A genuine authenticated owner capability, encrypted owner-key custody, approved backend OAuth to Drive, private scope-isolated retrieval transport, durable incremental ingestion/verified live cursor, native BM25/FAISS published generation and rollback/restore receipts remain unproven.
- These source changes do not affect consumer ChatGPT's native memory engine or force the ChatGPT UI to call the Context Gateway.
- Git/Memory/Engram/PersistFlow authority boundaries remain unchanged; no paid APIs, personal records, credentials, permissions, production updates, or authority cutover.

## Related live source and continuity checks
- PR #60 (`feat/operacao-50-50-runtime-20261102`) already implements a separate PersistFlow owner-approval verifier and revocation logic. It is draft; its author explicitly has **not** accepted positive authentication from the client. This is a reusable identity-design reference, **not** proof of a RAG personal owner capability or encrypted ledger key.
- A direct `PersistFlow.persist_run_inspect` call for `rag-context-recall-20261111` returned an internal tool error. No persisted run/checkpoint was verified in PersistFlow; this Git/PR checkpoint is the durable continuation record for this step.
- PR #64 was checked as draft, mergeable against PR #63, with no workflow runs or commit status checks on its head at inspection time. Do not mistake the 50 focused Windows tests for CI or deployment.

## Next safe action
Verify owner-capability design against the producer-owned runtime and grant boundaries. Implement/qualify private encryption and backend owner scope *before* accepting personal ingestion or attempting native serving. Only then attach an authenticated personal retrieval client to this Gateway, prove real source revision/hash and current-vs-previous index generation, and measure fresh retrieval queries with citations. Reconcile branch/PR ancestry and cost/CI gates before any merge or deploy.

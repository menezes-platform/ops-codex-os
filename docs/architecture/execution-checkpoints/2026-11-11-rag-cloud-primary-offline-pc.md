# Cloud-first RAG availability — checkpoint 2026-11-11

**Status: SOURCE FIX + LINUX TESTS GREEN; NOT DEPLOYED; NOT FULL DOD.**

## User requirement and architectural correction

The developer Windows PC (DESKTOP-L6CITUI) can be powered off without interrupting personal/project RAG service, scheduled ingestion, native index serving or restoration. The previous Spec Kit 02 described a PC-hosted initial primary. Owner corrected that requirement on 2026-11-11. ADR 0013 and Spec Kit 02, 08, 10, 11 now require a cloud-hosted primary and an explicit **PC-OFF acceptance test**. This does not change single-primary ownership or authorization for production cutover.

## Work performed

- Added a standalone HTTPS-only personal retrieval client in clients/execution-plane/v1/cloud-personal-retrieval-client.js. It has no local-file/Windows dependency and plugs into the already approved Context Gateway personalRetrievalClient slot (PR #64).
- Enforces fixed personal/current scope, short host-issued bearer, no local host in configured URL, HTTPS without redirects, bounded response size, SHA-256 evidence, matching revision/generation, owner-tagged hits, current source sync timestamp and a pinned generation before claiming a successful result or a verified miss.
- Missing/outdated sync receipts produce stale, unavailable cloud responses produce unavailable, and 401/403 produce denied. There is **no automatic Windows fallback**.
- Did not replace FAISS/BM25 or migrate the durable source. External cloud infrastructure was investigated: Hostinger's existing Node app can potentially host the HTTP/control plane and supports bounded Node cron jobs, but shared Hostinger Node hosting has no indefinitely running background workers. Cloudflare cron is available for lightweight periodic triggers, **not a proven native index host**.

## Reproducible evidence

- RED: node --test on Linux before implementation failed because the cloud client module did not exist.
- GREEN: 9/9 tests passed on isolated Linux Node v22.16.0, zero failures, zero skipped. Tested scope denial, HTTPS-only, bearer header secrecy, stale freshness, missing generation, forged digest, cross-owner/tagging, redirects, auth/unavailability and no model input injection.
- Cross-environment provenance: local tested file Git blob hashes matched exact GitHub readback:
  - client: 4f8a595f1b030b70092e87c3ca960706c7f150c4
  - test: 99f9a39db4443b3571c771e8d11ccc52a139e467
- The green tests exercise synthetic HTTPS responses, **not** real hosted OAuth or BM25+FAISS serving. The prior PR #64 Gateway tests remain 50/50 Windows-focused green, but this branch's complete repository test suite and CI have NOT been run.

## Explicit production gates

1. Verify existing Hostinger/Cloudflare account capacity and availability without increasing spending; choose actual cloud host for native Rust/FAISS/ONNX only after binary/CPU/memory/persistent-storage qualification. Hostinger web Node health does not prove native retrieval runs there.
2. Wire real signed owner capability and least-privilege Google Drive backend OAuth. PersonalLedger::open() in resident-node intentionally fails with EncryptionRequired; owner-held encrypted key custody is a strict blocker.
3. Authoritative source ingestion under one fenced writer, verified hash/cursor, scheduled bounded Cloud Cron, and last_sync_at backed by a durable server-side receipt, not arbitrary response text.
4. Qualify cloud native BM25/FAISS index, current/previous publication and rollback, encrypted backup and fresh remote restore, cross-scope zero leakage.
5. Execute **PC-OFF** drill while querying the protected cloud endpoint and while ingesting a real consented change; failure must report stale/unavailable without routing to desktop.
6. Full Linux cross-repo suites, security review, zero-cost verification, deployment/rollback and owner-approved authority cutover before declaring production.

## Isolation / dependencies

Stacked on PR #64, which is stacked on PR #63 and the RAG integration PR #46. No merge, deploy, new secret, personal data, Cloudflare worker, Hostinger cron or environment change performed. Engram, Memory, Git, PersistFlow authorities remain unchanged. The developer PC is optional for later diagnostics but production should not call it.

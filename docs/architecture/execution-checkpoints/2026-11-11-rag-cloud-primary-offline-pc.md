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

## Reuse-based integration checkpoint — 2026-11-11

**No new platform, cloud service, paid credits or production data write.** The owner chose to execute the smallest existing-infrastructure round trip before expanding the architecture. This checkpoint reconciles live connector state with older documents; it does not reclassify a source-only PR as production.

### Verified existing cloud paths
- ChatGPT Automations task `6af0fd508790819182966447afd16812`, title `Espelho RAG Sgtmenezes`: `is_enabled=true`; last completed run `f895f136-f28c-8324-9bf0-f33458574a35`, scheduled `2026-11-12T00:54:04Z` and finished `2026-11-12T00:57:01Z`. Last result: 29 destination files, 6 source groups, 21 direct name/size matches, 8 historical-name matches, **NOOP**. Binary identity of all 29 and an altered-file propagation were **not** demonstrated in that round. This automation is cloud-based and does not require DESKTOP-L6CITUI, but **only mirrors archives**.
- GitHub project issue `menezesx2k26-byte/ops-infra-workbench#15` already contains an independent Linux Drive-recovery receipt: original municipal RAG archive, original `operacao-50-50/bundle/06_RAG_OFFLINE_NAO_PUBLICADO/retrieval.py`, SQLite FTS5 integrity, 320 sources / 341 chunks, real queries with source references, same-input NOOP, synthetic one-source incremental edit, exact rollback and namespace denial. The RAG was not published and these sources belong to the municipal project scope, **not** the personal memory lane. Preserve this existing verified proof instead of making a second indexer.
- Live GitHub readback: PR #65 is a stacked DRAFT over #64, itself stacked on #63→#46. An existing HTTPS client and TLS smoke test run in isolated Linux with **11/11 PASS** (9 client checks + 2 TLS checks), no desktop service needed. This demonstrates a runnable portable client/fixture, **not** a live hosted private data endpoint.

### New seam test / evidence status
- Added `tests/cloud-context-gateway-roundtrip.test.js` to **the existing PR #65** (blob SHA `1e5b97070ecee633ad212341536335e8d02373e3`). Six cases specify host-classified personal recall → HTTPS adapter → owner scope → digest/revision/generation → cited answer + receipt; stale/foreign-owner/denied/injected data must fail closed; irrelevant requests must avoid personal access.
- This **new six-case suite is SOURCE-ADDED, NOT YET GREEN**. GitHub returned zero workflow runs for PR #65 HEAD `9e456dd6d38502bf3300b171b462977dc694d06d`. A remote desktop test attempt reached an OS command-length limit and then a local computer executor alternated between DESKTOP-L6CITUI and MARTHA. Temporary files were removed from both. Do not call that attempt a test pass or a reliable serving lane. Independent Linux client/TLS tests remain 11/11 green.
- PersistFlow read for the existing RAG run returned an internal error; the run/checkpoint state was **not proven** through PersistFlow. This Git checkpoint is a source record only.

### DoD, next boundaries
1. Use the already-active Automations cloud mirror and original municipal offline code; do not create another indexer or scheduler. A mirror NOOP does not imply an updated RAG index.
2. Qualification of a **real private cloud** execution plane with persistent encrypted corpus and owner capability, real backend Drive OAuth, and current/previous BM25+FAISS recovery remains BLOCKED; no validated R$0 compute budget hard-stop was observed.
3. Exercise the entire six-case Gateway suite on a *consistent cloud/Linux checkout* and CI under verified cost limits, then a source-backed protected endpoint and PC-off drill. No user secret, personal episode, or cross-project index may be pushed to public CI or mis-scoped endpoints.
4. Keep existing cloud Hostinger, Cloudflare and GitHub Actions as candidates without silently making any of them a second authority or assuming a free plan can execute native FAISS forever.

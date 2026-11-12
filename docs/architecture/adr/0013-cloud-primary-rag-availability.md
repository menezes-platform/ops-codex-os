# ADR 0013 — Cloud-primary RAG availability; Windows is never a serving dependency

**Date:** 2026-11-11  
**Status:** Owner-approved direction; SOURCE ONLY, NOT DEPLOYED or ACCEPTED.  
**Supersedes:** the physical location of the initial primary in Spec Kit 02 wherever it assumes the developer's Windows PC. P03/P04/P05 authority, encryption, privacy and rollback gates remain intact.

## Mandatory outcome

The personal and project RAG must continue to retrieve, ingest, check freshness and recover when DESKTOP-L6CITUI is turned off, asleep, disconnected or uninstalled. Windows may run optional development/build tasks but is never a production authority, scheduler, sole cache, index source, secret broker, DNS tunnel or failover requirement.

This requirement is a target, NOT evidence that a cloud endpoint already exists. Consumer ChatGPT's native tool behavior cannot be forced by these repository changes; only controlled clients can enforce retrieval.

## Existing assets and responsibilities

| Component | Candidate production responsibility | Non-negotiable constraints |
| --- | --- | --- |
| Existing Hostinger Node web application | Authenticated HTTP/API/control-plane host and/or bounded Cron runner | Check plan and deployment first. Shared Hostinger Node web/cloud hosting does not support indefinitely running background workers. Do not claim that Rust/FAISS can run on the current plan without a real qualification. |
| Existing Cloudflare account | Optional UTC schedule trigger or lightweight protected edge facade | Respect free-plan quotas. No heavy FAISS/SQLite indexing on a free Worker, no second canonical writer and no private corpus exposure. |
| Google Drive owner-approved private folder | Immutable encrypted episodic corpus, manifests and verified backups after acceptance | Backend OAuth, consent, single-writer, client-side encryption and restore receipt remain blocking. Connector OAuth cannot be borrowed silently. |
| Execution Plane / Resident Node | Cloud-hosted native BM25/FAISS and local offline embeddings, fenced primary and current/previous | Qualify actual Linux/cloud binaries, persistent non-deployment storage and recovery. Do not change retrieval backend merely to bypass qualification. |
| Context Gateway | Cloud HTTPS personal/project read interface and evidence receipts | Trusted host-issued owner capability, no model-provided scopes, no cross-lane fallback, no Windows dependency. |
| Memory / Engram / PersistFlow | Retain current canonical personal, episodic and run authorities | No cutover until independent evidence and approval. |

## Cloud-only request and indexing path

1. A hosted scheduler runs bounded source/revision checks and incremental ingestion. Hostinger Node Cron is a candidate (UTC schedule, at most 30 minutes per job, environment variables not inherited by default); Cloudflare Cron Triggers are an optional lightweight trigger. Neither requires Windows to be on.
2. Only an approved authenticated owner, a private source scope and a single writer can ingest changes. Validate immutable digests, revisions, idempotency and tombstones. Never advance a cursor before durable readback.
3. A QUALIFIED CLOUD native executor materializes verified corpus bytes, builds and validates BM25/FAISS, records the source revision, publishes current/previous with fencing, and proves rollback. Cloudflare Workers Free CPU budget is unsuitable as the unqualified indexing host.
4. Controlled clients request personal context over HTTPS using short-lived server-issued bearer. A separately injected personal client returns status, scope, generation, revision, citations, SHA-256 and a genuine last-sync receipt. Missing, stale or unavailable receipts must not become fabricated answers.
5. When cloud or source is unavailable, return unavailable/stale. There is **no Windows fallback**.
6. All important production records, owner-held encryption keys and recoverable backups live outside disposable deployment directories and outside the PC.

## Source slice

- clients/execution-plane/v1/cloud-personal-retrieval-client.js: HTTPS-only, rejects localhost, model-supplied scope, unknown request fields, malformed credentials, redirects, forged evidence/digests and conflicting generation/revisions. Requires bounded sync timestamp and pinned index generation before returning verified results. No local desktop/network dependency.
- The prior Context Gateway personalRetrievalClient injection is the integration seam. The trusted host must still supply owner authentication and a real private index backend.
- tests/cloud-personal-retrieval-client.test.js: nine pure Node tests, 9 PASS, 0 FAIL, 0 SKIP on isolated Linux Node v22.16.0. Exact Git blob hashes of local tested files match GitHub readback. This does not constitute cloud deployment.

## Acceptance gates

- **PC-off drill**: shut down Windows; hosted schedule still processes a consented change and protected retrieval returns correct current revision/citations, then produces stale/unavailable when ingestion stops.
- **Identity**: authenticated owner verified on actual server, revoked/foreign/model-selected identity denied, no public personal content.
- **Durability**: encrypted source and backup readback, independent fresh-cloud-host restore, single-writer receipts, current/previous generation publish and rollback.
- **Freshness**: source revision checked against indexed generation; durable verified UTC receipt, not just a timestamp sent by an arbitrary service. Alert on failed jobs.
- **Runtime**: confirm native Rust/FAISS/ONNX compatibility, pinned model, persistent storage, memory/CPU limits and zero incremental cost at existing cloud service. Hostinger Node app health alone is not index acceptance.
- **Authority**: no merges, deployments, customer data, Engram migration or secret grants solely from source tests.

## External provider documentation checked November 2026

- Hostinger Node Cron: https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/
- Hostinger Node limits: https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/
- Cloudflare Cron: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare limits: https://developers.cloudflare.com/workers/platform/limits/

**Release status:** SOURCE ONLY. Owner backend OAuth, encryption, hosted native indexing, live corpus, actual 24/7 availability, rollback and PC-off drill are not yet verified.

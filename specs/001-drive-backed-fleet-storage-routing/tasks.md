# Tasks: Drive-backed Fleet Storage and Routing

**Feature**: `001-drive-backed-fleet-storage-routing`  
**Branch**: `agent/drive-fleet-plan/20260924-1353`  
**Execution method**: Superpowers `executing-plans` with TDD and isolated git worktree.

## Phase 1 — Fleet foundations

- [ ] T001 Define fleet registry, heartbeat, and route-intent contracts in `persistd/src/fleet/contracts.js`; add `persistd/config/fleet.json`; prove with `persistd/fleet-contracts.test.js`.
- [ ] T002 Add path-bound HMAC node authentication and atomic heartbeat state in `persistd/src/fleet/auth.js` and `persistd/src/fleet/store.js`; prove freshness/staleness in `persistd/fleet-auth-store.test.js`.
- [ ] T003 Wire authenticated heartbeat ingestion and read-only fleet status through PersistFlow service/HTTP/MCP; prove with `persistd/persistflow-fleet-integration.test.js`.
- [ ] T004 Build cross-platform node telemetry agent plus Windows/Linux installers; prove with `persistd/fleet-node-agent.test.js`.

## Phase 2 — Drive durable object storage

- [ ] T005 Implement central Google OAuth refresh/access-token broker; workers receive only short-lived access tokens; prove with `persistd/drive-auth.test.js`.
- [ ] T006 Implement Drive v3 search, metadata writes, streaming downloads, changes API, and resumable 8 MiB chunk uploads; prove interruption/resume with `persistd/drive-client.test.js`.
- [ ] T007 Implement SHA-256 object store, manifest pairing, verified LRU cache, eviction reserves, Drive changes cursor, OAuth authorization helper, and root bootstrap; prove with `persistd/object-store-cache.test.js` and `persistd/catalog-sync.test.js`.

## Phase 3 — TypeSafe routing

- [ ] T008 Implement deterministic eligibility, resource/disk filters, TypeSafe System One semantic scoring, and deterministic fallback; prove with `persistd/typesafe-fleet-router.test.js`.
- [ ] T009 Persist route decisions as run checkpoint evidence; project latest route through remote bridge into Baton v2; prove with fleet integration, bridge-sync, and baton tests.
- [ ] T010 Connect cache locality to routing and expose safe read-only object/cache MCP tools; prove with `persistd/storage-mcp.test.js`.

## Phase 4 — Acceptance and operations

- [ ] T011 Add end-to-end fake-provider acceptance, secret-leak regression, runbook, rollback flag, full PersistFlow test suite, and repository diff checks.

## Global gates

- [ ] PersistFlow remains sole run/generation/lease authority.
- [ ] Git remains source of truth for code.
- [ ] Drive never becomes a lock/WAL/transaction store.
- [ ] TypeSafe never receives secrets and cannot override hard eligibility.
- [ ] Refresh token remains only on the PersistFlow authority host.
- [ ] Cache remains disposable; durable objects require verified Drive blob + manifest.
- [ ] Existing PersistFlow generation/claim/OAuth/Sandbox/chat-lifecycle tests remain green.
- [ ] Initial live enrollment is only `desktop-primary` and `ec2-primary` until other nodes independently heartbeat and pass storage smoke tests.

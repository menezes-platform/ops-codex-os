# Feature Specification: Drive-backed Fleet Storage and Routing

**Feature Branch**: `agent/drive-fleet-plan/20260924-1353`  
**Created**: 2026-09-24  
**Status**: Approved for implementation  
**Source Design**: `docs/superpowers/specs/2026-09-24-drive-backed-fleet-storage-routing-design.md`

# Drive-backed Fleet Storage and Routing Design

**Status:** Planning approved in conversation; implementation pending plan review  
**Date:** 2026-09-24  
**Repository:** `menezes-platform/ops-codex-os`  
**Primary runtime:** PersistFlow / `persistd`  
**Decision engine:** TypeSafe System One  
**Durable object store:** Google Drive API v3  
**Fleet:** Desktop, EC2, and registered remote machines

## Goal

Turn the user's unused Google Drive capacity into the durable cold/object-storage layer for the agent fleet, while keeping local disks small and making PersistFlow route work to the best eligible machine. TypeSafe is the semantic chooser and organizer; deterministic policy, runtime health, Git state, and PersistFlow generation/lease authority remain the hard boundaries.

## Architectural invariants

1. PersistFlow remains authoritative for runs, generations, checkpoints, and execution decisions.
2. Google Drive is never a lock manager, generation authority, or transactional run-state store.
3. Git remains authoritative for source code; Drive stores artifacts, datasets, models, media, snapshots, manifests, and other non-source payloads.
4. Local disks hold only the active working set plus an evictable cache.
5. TypeSafe may rank or organize eligible candidates but cannot make an ineligible machine executable.
6. Runtime health outranks registry metadata. Registered does not mean online; online does not mean eligible.
7. Route decisions are durable evidence attached to the PersistFlow run.
8. Secrets never enter TypeSafe payloads, Drive metadata, Git, logs, or dashboard responses.
9. The Google OAuth refresh credential is retained only on the PersistFlow authority host. Worker nodes receive short-lived access tokens through an authenticated broker.
10. Large uploads use Drive resumable upload semantics and content hashes are verified before an object is considered durable.
11. Duplicate uploads with identical SHA-256 are safe; canonicalization is deterministic and does not risk deleting the only good copy.
12. Gabriel Ops remains read-only. Fleet/storage observability is projected into it in a separate plan; it never becomes the execution control plane.

## Existing components to reuse

- `persistd/src/persistflow/service.js`: canonical service boundary and checkpoint flow.
- `persistd/src/persistflow/mcp-handler.js`: authenticated tool exposure.
- `persistd/src/persistflow/authority-store.js`: durable file-backed authority pattern.
- `persistd/src/persistflow/sandbox-provider.js`: existing authenticated provider/client pattern and explicit provider hints.
- `persistd/src/persistflow/baton-v2.js`: current machine/device handoff field.
- `persistd/src/policy.js`: existing deterministic autonomy gates.
- `persistd/src/remote-health.js`: current health-preflight pattern.
- `menezesx2k26-byte/ops-gabriel-ops/scripts/typesafe-guardrail.mjs`: proven TypeSafe request/typed-answer pattern.
- `menezesx2k26-byte/ops-gabriel-ops/scripts/fleet_ssh_control_plane.py`: existing machine identities/topology and EC2-centered mesh.
- `menezes-platform/ttk-live-dungeon/apps/media-worker/src/adapters/drive.ts`: existing Drive adapter boundary and durable-outbox design precedent.

## Topology

```text
                    ChatGPT / worker
                           |
                           v
                     PersistFlow MCP
                           |
                  +--------+--------+
                  |                 |
                  v                 v
              Fleet Router      Object Catalog
                  |                 |
           hard eligibility         |
                  |                 |
                  v                 v
             TypeSafe rank     Google Drive API
                  |                 |
          validated route            |
                  |          +------+------+
          +-------+------+   |             |
          v              v   v             v
       Desktop          EC2  cache       cache
       worker           worker local      local
          |              |
          +------ Git ----+
```

## Fleet registry

A versioned static registry defines identity and durable capabilities, never liveness. Initial node IDs preserve the existing Gabriel Ops naming where possible:

- `desktop-primary`
- `ec2-primary`
- `aws-vm`
- `persistflow`
- `tsim-vm`
- `tiktok-live-aws`

Each registry entry may define platform, architecture, transport hints, capability tags, concurrency limit, affinity tags, and whether the node is drained. No credentials belong in the registry.

Dynamic heartbeats supply hostname, observed timestamp, free/total disk, free/total memory, CPU pressure, active jobs, cache bytes, cached object hashes, runtime version, and a capability hash.

A heartbeat older than 90 seconds is stale and cannot satisfy an online requirement.

## Task intent contract

A route request contains:

```json
{
  "taskId": "task-123",
  "summary": "run renderer integration tests",
  "repo": "menezes-platform/ttk-live-dungeon",
  "ref": "0123456789abcdef",
  "requiredCapabilities": ["node", "git"],
  "preferredCapabilities": ["high-memory"],
  "estimatedScratchBytes": 21474836480,
  "artifactRefs": ["sha256:..."],
  "requiresInteractiveUi": false,
  "requiresGpu": false,
  "parallelSafe": false
}
```

All fields are bounded and normalized before any TypeSafe call.

## Hard eligibility

A node is eligible only when all are true:

- registered and not drained;
- heartbeat is fresh;
- every required capability exists;
- interactive-UI work is routed only to a node that declares the corresponding control surface;
- GPU work requires the GPU capability;
- projected free disk after scratch allocation remains above the node's safety reserve;
- active jobs remain below the node concurrency limit;
- any explicitly pinned node matches exactly.

The router sends only eligible candidates to TypeSafe.

## TypeSafe decision model

TypeSafe is used the same way the existing Gabriel Ops guardrail uses it: typed questions are answered by System One and ordinary application code maps those answers to a concrete decision.

For each eligible candidate, the router asks a bounded score question for overall suitability given task semantics, capability fit, resource headroom, artifact locality, interactive requirements, and coordination cost. When explicit independent subtasks are supplied, a separate bounded score asks whether splitting across candidates is beneficial.

The application selects the highest TypeSafe score. Ties are broken deterministically by:

1. most requested artifacts already cached;
2. greatest post-allocation free disk ratio;
3. fewest active jobs;
4. lexicographically smallest node ID.

If TypeSafe is unavailable:
- one eligible candidate: route deterministically to that candidate and record `decisionSource=single-candidate-fallback`;
- multiple eligible candidates: use the same deterministic tie-break ordering and record `decisionSource=deterministic-fallback` plus the TypeSafe error class;
- zero eligible candidates: block with `NO_ELIGIBLE_NODE`.

TypeSafe never receives secret material, OAuth tokens, file contents, or arbitrary logs.

## Drive object-store model

The Drive store is content-addressed by SHA-256.

Logical objects use metadata fields such as:

```text
gdb_schema=1
gdb_sha256=<64 hex chars>
gdb_namespace=<bounded namespace>
gdb_kind=<artifact|dataset|model|media|snapshot|log>
gdb_size=<decimal bytes>
```

The blob filename is the SHA-256 digest. Application-private `appProperties` are used for indexed lookup. The implementation stores only small indexable fields there; full metadata lives in a JSON manifest.

Objects are immutable. Updating a logical artifact creates a new object and a new manifest reference rather than mutating blob bytes in place.

Large objects use Drive resumable upload. Downloads stream directly to a temporary local file, verify SHA-256, then atomically rename into the cache.

## Drive authentication

The PersistFlow host owns:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GABRIEL_DRIVE_ROOT_ID`

The OAuth scope is `https://www.googleapis.com/auth/drive.file` for the dedicated object-store tree created by this app.

Worker nodes do not receive the refresh token. They authenticate to PersistFlow using their fleet credential and request a short-lived Google access token. The broker returns only access token, expiry, scope, and root ID. Tokens are never persisted by the node agent.

## Local cache policy

Default cache root:

- Windows: `%LOCALAPPDATA%\Gabriel\object-cache`
- Linux: `~/.cache/gabriel/object-cache`

Each cached object is stored as `objects/<sha256>` with one atomically updated JSON index.

Eviction rules:

- never evict pinned/in-use entries;
- evict least-recently-used unpinned entries first;
- begin eviction when free space falls below `max(50 GiB, 10% of filesystem capacity)` or cache bytes exceed `GABRIEL_CACHE_MAX_BYTES`;
- stop only after free space reaches `max(80 GiB, 15% of filesystem capacity)` and cache is below its configured maximum;
- if an incoming object's required scratch space still cannot fit after eviction, route execution elsewhere rather than exhausting the disk.

The cache is disposable. Deleting the entire cache must not lose authoritative data.

## Incremental Drive synchronization

The client persists the Drive `changes.getStartPageToken` cursor in local cache metadata. `changes.list` advances the catalog incrementally and updates the local file-ID/hash map. A full scan is a recovery path only.

## PersistFlow integration

New service operations:

- `fleetHeartbeat(nodeId, heartbeat)`
- `fleetStatus()`
- `routeTask(runId, input)`
- `issueDriveAccess(nodeId)`
- `objectCatalogLookup(ref)`

New MCP tools expose read/route operations but not raw OAuth credentials.

A route decision is appended to the run as checkpoint evidence:

```json
{
  "type": "fleet.route",
  "taskId": "task-123",
  "nodeId": "ec2-primary",
  "decisionSource": "typesafe",
  "eligibleNodeIds": ["desktop-primary", "ec2-primary"],
  "evaluatedAt": "2026-09-24T17:00:00.000Z"
}
```

Baton v2 projects the selected node ID so successor workers continue on the same executor unless a new route decision supersedes it.

## Failure semantics

- stale heartbeat: candidate excluded;
- TypeSafe timeout/5xx: deterministic fallback with evidence;
- Drive auth refresh failure: `DRIVE_AUTH_UNAVAILABLE`, no local file is deleted;
- interrupted upload: resume using stored resumable session URI while valid;
- upload completion with hash mismatch: quarantine remote object metadata and keep local source;
- download hash mismatch: delete temporary download and retry once from Drive; a second mismatch blocks;
- low disk: evict cache, then reroute if capacity remains insufficient;
- Drive outage: active work may continue only with already-cached inputs; new durable-output confirmation remains pending;
- duplicate identical objects: keep one canonical reference and schedule safe duplicate cleanup only after at least one verified copy remains.

## Non-goals

- Replacing PersistFlow run authority with Drive.
- Mounting Drive as a general-purpose filesystem.
- Storing Git worktrees, `node_modules`, package caches, or SQLite WAL files directly on Drive.
- Streaming latency-sensitive database traffic through Drive.
- Giving TypeSafe unrestricted execution authority.
- Making Gabriel Ops writable.
- Automatically deleting arbitrary user Drive content outside the dedicated app-owned root.
- Implementing the unfinished PersistFlow Sandbox in this change.

## Acceptance criteria

1. A registered node can send authenticated health and appear fresh/stale deterministically.
2. A route request never sends an ineligible node to TypeSafe.
3. TypeSafe can rank multiple eligible nodes and the selected route is persisted as run evidence.
4. TypeSafe outage still produces deterministic, attributable fallback routing.
5. A short-lived Drive access token can be issued to an authenticated registered node without disclosing the refresh token.
6. A file larger than 5 MB uploads with resumable semantics and can resume after an injected interruption.
7. Re-uploading identical bytes does not create a required second logical object.
8. A downloaded object is hash-verified before entering cache.
9. Cache eviction recovers configured free-space headroom without removing pinned files.
10. A task whose scratch requirements exceed local headroom is rejected from that node and can route elsewhere.
11. Drive change tokens update the local catalog without a full scan.
12. Existing PersistFlow generation/claim tests remain green.
13. Existing Sandbox provider behavior remains unchanged.
14. No secret values appear in TypeSafe payload fixtures, repository files, logs, or test snapshots.
15. The feature can be disabled with configuration and the existing PersistFlow behavior remains available.

## External API facts verified for this design

- Drive API v3 supports searchable private `appProperties` on files.
- Drive `changes.getStartPageToken` plus `changes.list` supports incremental change tracking.
- Drive supports resumable uploads and recommends them for files larger than 5 MB or interruption-prone transfers.


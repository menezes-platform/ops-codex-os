# Drive-backed Fleet Operations

## Authority model

PersistFlow remains authoritative for run generation, claims, checkpoints, leases, route evidence, and successor continuity. Git remains authoritative for source code.

Google Drive is a durable content-addressed object store for immutable artifacts, datasets, models, media, snapshots, and manifests. It is not a lock manager, WAL, queue, or transactional run database.

TypeSafe System One is a semantic scheduler only after deterministic eligibility filters have removed impossible nodes. It cannot make a drained, stale, capability-incompatible, over-concurrency, or low-disk node executable.

Local worker storage is disposable cache. A cache loss must not destroy any object already marked durable.

## Required secrets

On the PersistFlow authority host only:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GABRIEL_DRIVE_ROOT_ID`
- `TYPESAFE_API_KEY` when semantic scoring is enabled
- `PERSISTFLOW_FLEET_NODE_SECRETS_JSON`

Per worker:

- `PERSISTFLOW_BASE_URL`
- `PERSISTFLOW_FLEET_NODE_ID`
- `PERSISTFLOW_FLEET_NODE_SECRET`

Workers never receive the Google refresh token. They may request a short-lived Drive access token from the authority host through the path/body/method-bound fleet HMAC endpoint.

## First-time Google Drive setup

1. Create/configure a Google OAuth client that can use the `https://www.googleapis.com/auth/drive.file` scope.
2. Put `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` only in the authorization/PersistFlow host environment.
3. From `persistd/`, run `npm run drive:authorize`.
4. Open the printed Google authorization URL and approve the consent screen. This is an explicit human authentication boundary.
5. The helper writes the refresh token to the PersistFlow data directory as `google-drive-refresh-token` with restricted permissions and does not print the token.
6. Move/inject that refresh token into the production secret environment as `GOOGLE_DRIVE_REFRESH_TOKEN`.
7. Run `npm run drive:bootstrap`.
8. Record the returned dedicated `Gabriel Object Store` folder ID as `GABRIEL_DRIVE_ROOT_ID`.
9. Remove any temporary plaintext secret handling used during setup.

The bootstrap creates exactly one dedicated root. Object blobs and companion JSON manifests are direct children of that root and are distinguished by `gdb_record=object|manifest`.

## Fleet enrollment

Start with only nodes that have independently verified connectivity. The initial rollout is:

- `desktop-primary`
- `ec2-primary`

For each node:

1. Confirm the node exists in `persistd/config/fleet.json` with correct non-secret capabilities.
2. Generate/configure a unique node HMAC secret on the authority host and on that node only.
3. Configure `PERSISTFLOW_BASE_URL`, `PERSISTFLOW_FLEET_NODE_ID`, and `PERSISTFLOW_FLEET_NODE_SECRET`.
4. Install the versioned agent using `scripts/install-fleet-agent.ps1` on Windows or `scripts/install-fleet-agent.sh` on Linux.
5. Verify `persist_fleet_status` reports a fresh heartbeat.
6. Confirm disk, memory, active job count, cache bytes, and capability identity look plausible.
7. Keep additional registered nodes out of scheduling until each independently reports a fresh heartbeat and passes a storage smoke test.

Registered does not mean online. Online does not mean healthy. Healthy does not mean eligible.

## Storage smoke test

Before enabling routing:

1. Put one disposable file through `DriveObjectStore.put`.
2. Confirm the returned reference is `sha256:<64hex>` and `durable=true`.
3. Confirm a blob and companion manifest exist under the dedicated Drive root.
4. Fetch the object through a disposable local cache.
5. Confirm the cache verifies SHA-256 before atomic promotion into `objects/<sha256>`.
6. Confirm `persist_object_lookup` returns bounded metadata only.
7. Confirm `persist_cache_status` exposes heartbeat-derived size/count telemetry and no filesystem paths.

Do not mark output durable if blob or manifest confirmation is missing.

## Routing smoke test

With fleet routing still disabled for production work, use a bounded test run and verify:

1. stale/drained nodes are excluded;
2. required capabilities are enforced;
3. projected scratch space cannot cross the disk reserve;
4. active jobs cannot exceed node concurrency;
5. TypeSafe receives only eligible candidate metadata;
6. TypeSafe scores are bounded and validated;
7. a TypeSafe failure produces `deterministic-fallback`;
8. the selected route becomes a `fleet.route` checkpoint;
9. equal-generation remote reconciliation projects `latestRoute`;
10. Baton v2 carries both the concrete Commander `deviceId` and routed fleet `nodeId`.

## Enablement

The production router is off by default.

Enable only after the Drive and routing smoke tests pass:

```text
PERSISTFLOW_FLEET_ROUTER_ENABLED=1
```

A missing TypeSafe API key does not grant broader authority. With multiple eligible nodes it causes deterministic fallback; with a single eligible node the single-candidate fallback is used.

## Local cache policy

Default roots:

- Windows: `%LOCALAPPDATA%\Gabriel\object-cache`
- Linux: `~/.cache/gabriel/object-cache`

Eviction begins when projected free space falls below `max(50 GiB, 10%)` or cache bytes exceed `GABRIEL_CACHE_MAX_BYTES`. It stops only after projected free space reaches `max(80 GiB, 15%)` and cache is below its configured limit.

Pinned/in-use objects are never evicted. If eviction cannot create sufficient headroom, local execution fails with `INSUFFICIENT_LOCAL_CAPACITY` so routing can choose another node.

## Failure handling

- **Stale heartbeat:** node is excluded from eligibility.
- **TypeSafe timeout/5xx/malformed score:** deterministic fallback; decision source is recorded.
- **Drive refresh failure:** no local cache entry is deleted.
- **Interrupted large upload:** resumable upload probes Drive for the accepted offset and continues.
- **Upload checksum mismatch:** binary uploads are confirmed against Drive `md5Checksum`; mismatches are quarantined and the local source remains intact.
- **Download SHA mismatch:** temporary bytes are removed and retried once; a second mismatch marks the Drive object with `gdb_quarantine=hash_mismatch` and blocks promotion into cache.
- **Duplicate SHA objects:** one deterministic canonical file ID is returned; duplicate IDs are evidence for later safe cleanup, not deleted in the write path.
- **Drive outage:** already-cached inputs may still be used, but new output is not considered durable until Drive confirmation returns.
- **Generation changes while TypeSafe is scoring:** route persistence rechecks generation and fails closed with `STALE_GENERATION`.

## Rollback

Set:

```text
PERSISTFLOW_FLEET_ROUTER_ENABLED=0
```

and restart the PersistFlow web process.

This disables new fleet route selection while preserving existing PersistFlow run/claim/checkpoint behavior. Do not delete Drive objects, manifests, cache indexes, or route evidence as part of rollback. Existing durable Drive objects remain valid data; local caches remain disposable.

If worker agents themselves must be paused, stop/disable the local scheduled task or systemd-user service through the normal machine administration path. Do not rotate or destroy credentials solely to pause routing.

## Verification commands

From `persistd/`:

```bash
node --test drive-fleet-acceptance.test.js
node --test storage-mcp.test.js typesafe-fleet-router.test.js persistflow-fleet-integration.test.js
npm test
```

From repository root:

```bash
git diff --check
git status --short
```

The feature is ready for review only when focused acceptance, the complete suite, diff checks, and secret-leak regression are green.

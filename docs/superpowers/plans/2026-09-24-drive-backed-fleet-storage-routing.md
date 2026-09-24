# Drive-backed Fleet Storage and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PersistFlow route work across the registered machine fleet with TypeSafe-assisted semantic scheduling while using Google Drive as the durable content-addressed object store and keeping local disks limited to an evictable working-set cache.

**Architecture:** PersistFlow remains run/lease authority. A static fleet registry plus authenticated dynamic heartbeats produces hard-eligible candidates; TypeSafe scores only those candidates and ordinary code selects and validates the route. Google Drive stores immutable SHA-256-addressed payloads, while each worker maintains a hash-verified LRU cache and receives only short-lived Google access tokens from the PersistFlow host.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, Node `fetch`, `node:crypto`, `node:fs`, Google Drive API v3, Google OAuth 2.0 refresh-token flow, TypeSafe System One, existing PersistFlow MCP/HTTP runtime.

**Spec:** `docs/superpowers/specs/2026-09-24-drive-backed-fleet-storage-routing-design.md`

## Global Constraints

- PersistFlow remains authoritative for runs, generations, checkpoints, and execution decisions.
- Google Drive is never a lock manager, generation authority, or transactional run-state store.
- Git remains authoritative for source code.
- TypeSafe never receives secrets, OAuth tokens, file contents, or raw logs.
- The Google OAuth refresh credential remains only on the PersistFlow authority host.
- Large Drive uploads use resumable upload semantics.
- Local caches are disposable and may never be the only copy of an artifact marked durable.
- Gabriel Ops remains read-only and is not modified by this plan.
- Do not implement or depend on the unfinished PersistFlow Sandbox.
- Preserve all existing PersistFlow generation, claim, OAuth, Sandbox-provider, and chat-lifecycle behavior.

## Review Focus

1. **Forged or stale node heartbeat:** reject bad signatures/timestamps and never let stale nodes enter the eligible set; pinned by Task 2 auth/store tests.
2. **TypeSafe returns malformed answers or favors an ineligible node:** reject malformed semantic output and select only from the prefiltered eligible set; pinned by Task 8 router tests.
3. **Drive upload dies mid-file or returns a corrupt object:** resume by byte range when possible and verify SHA-256 before durability; pinned by Task 6 tests.
4. **Disk pressure with pinned cache entries:** evict only unpinned LRU entries and reject local execution when required headroom still cannot be reached; pinned by Task 7 tests.
5. **Duplicate object/change replay:** make identical content idempotent and make Drive change-cursor application replay-safe; pinned by Task 7 tests.

---

## File Structure

### New fleet modules

- `persistd/src/fleet/contracts.js` — validates fleet registry, heartbeat, and route-intent shapes.
- `persistd/src/fleet/auth.js` — verifies per-node HMAC heartbeat/token-broker requests.
- `persistd/src/fleet/store.js` — file-backed dynamic heartbeat and route-decision state.
- `persistd/src/fleet/eligibility.js` — deterministic hard filters and fallback ordering.
- `persistd/src/fleet/typesafe-router.js` — bounded TypeSafe scoring request/response.
- `persistd/src/fleet/router.js` — composes eligibility, TypeSafe scoring, fallback, and durable decision.
- `persistd/src/fleet/node-agent.js` — machine metrics, heartbeat loop, and cache inventory.
- `persistd/config/fleet.json` — non-secret registered node/capability metadata.
- `persistd/scripts/install-fleet-agent.ps1` — Windows Scheduled Task installer.
- `persistd/scripts/install-fleet-agent.sh` — Linux systemd-user installer.

### New storage modules

- `persistd/src/storage/drive-auth.js` — refresh-token exchange and short-lived access-token broker.
- `persistd/src/storage/drive-client.js` — Drive v3 metadata/search/download/resumable-upload primitives.
- `persistd/src/storage/object-store.js` — SHA-256 content-addressed object semantics.
- `persistd/src/storage/cache-manager.js` — local verified object cache, pinning, and LRU eviction.
- `persistd/src/storage/catalog-sync.js` — Drive changes cursor and replay-safe local catalog.
- `persistd/scripts/bootstrap-drive-store.js` — one-time dedicated root/folder bootstrap.

### Existing integration points

- `persistd/src/persistflow/service.js` — add fleet/status/route/token-broker operations.
- `persistd/src/persistflow/http-server.js` — authenticated heartbeat and Drive-token endpoints.
- `persistd/src/persistflow/mcp-handler.js` — fleet status/route/catalog MCP tools.
- `persistd/src/persistflow/baton-v2.js` — project latest selected node into successor baton.
- `persistd/src/start-entrypoint.js` — construct production fleet/storage dependencies.
- `persistd/package.json` — add fleet-agent and storage bootstrap scripts; no new runtime package dependency.

### Tests

- `persistd/fleet-contracts.test.js`
- `persistd/fleet-auth-store.test.js`
- `persistd/fleet-node-agent.test.js`
- `persistd/drive-auth.test.js`
- `persistd/drive-client.test.js`
- `persistd/object-store-cache.test.js`
- `persistd/catalog-sync.test.js`
- `persistd/typesafe-fleet-router.test.js`
- `persistd/persistflow-fleet-integration.test.js`

---

### Task 1: Define the fleet registry and route-intent contracts

**Files:**
- Create: `persistd/src/fleet/contracts.js`
- Create: `persistd/config/fleet.json`
- Create: `persistd/fleet-contracts.test.js`

**Interfaces:**
- Consumes: plain JSON configuration and caller route intent.
- Produces:
  - `loadFleetConfig(value) -> { nodes: FleetNode[] }`
  - `normalizeHeartbeat(value) -> FleetHeartbeat`
  - `normalizeRouteIntent(value) -> RouteIntent`
  - Node IDs are stable strings; numeric resource fields are finite non-negative integers.

- [ ] **Step 1: Write failing contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFleetConfig, normalizeHeartbeat, normalizeRouteIntent } = require('./src/fleet/contracts');

test('fleet config rejects duplicate node ids and secret-looking fields', () => {
  assert.throws(
    () => loadFleetConfig({ nodes: [
      { id: 'ec2-primary', capabilities: ['node'] },
      { id: 'ec2-primary', capabilities: ['git'] },
    ] }),
    /FLEET_NODE_DUPLICATE/,
  );
  assert.throws(
    () => loadFleetConfig({ nodes: [{ id: 'ec2-primary', capabilities: [], token: 'secret' }] }),
    /FLEET_SECRET_FIELD_FORBIDDEN/,
  );
});

test('heartbeat and route intent are bounded and normalized', () => {
  const beat = normalizeHeartbeat({
    observedAt: '2026-09-24T17:00:00.000Z',
    hostname: 'EC2AMAZ-7IT0M73',
    freeDiskBytes: 120,
    totalDiskBytes: 500,
    freeMemoryBytes: 20,
    totalMemoryBytes: 64,
    cpuPercent: 11.5,
    activeJobs: 1,
    cacheBytes: 10,
    cachedObjectHashes: ['a'.repeat(64)],
  });
  assert.equal(beat.activeJobs, 1);

  const intent = normalizeRouteIntent({
    taskId: 't1',
    summary: 'run tests',
    requiredCapabilities: ['node', 'git'],
    artifactRefs: ['sha256:' + 'a'.repeat(64)],
    estimatedScratchBytes: 1024,
  });
  assert.deepEqual(intent.requiredCapabilities, ['git', 'node']);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd persistd
node --test fleet-contracts.test.js
```

Expected: FAIL with `Cannot find module './src/fleet/contracts'`.

- [ ] **Step 3: Implement the contract module**

Create `persistd/src/fleet/contracts.js` with these exact public helpers:

```js
const SECRET_KEYS = /(?:secret|token|password|credential|private[_-]?key)/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function finiteInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error('INVALID_' + name);
  return n;
}

function uniqueStrings(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('INVALID_' + name);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function assertNoSecretFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEYS.test(key)) throw new Error('FLEET_SECRET_FIELD_FORBIDDEN');
  }
}

function loadFleetConfig(value = {}) {
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const seen = new Set();
  return {
    nodes: nodes.map((node) => {
      assertNoSecretFields(node);
      const id = String(node.id || '').trim();
      if (!id) throw new Error('FLEET_NODE_ID_REQUIRED');
      if (seen.has(id)) throw new Error('FLEET_NODE_DUPLICATE');
      seen.add(id);
      return {
        id,
        platform: String(node.platform || 'unknown'),
        arch: String(node.arch || 'unknown'),
        capabilities: uniqueStrings(node.capabilities, 'CAPABILITIES'),
        affinities: uniqueStrings(node.affinities, 'AFFINITIES'),
        concurrencyLimit: finiteInt(node.concurrencyLimit ?? 1, 'CONCURRENCY_LIMIT'),
        drained: node.drained === true,
      };
    }),
  };
}

function normalizeHeartbeat(value = {}) {
  const hashes = uniqueStrings(value.cachedObjectHashes, 'CACHED_HASHES');
  if (hashes.some((hash) => !SHA256.test(hash))) throw new Error('INVALID_CACHED_HASH');
  const observedAt = String(value.observedAt || '');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('INVALID_OBSERVED_AT');
  return {
    observedAt,
    hostname: String(value.hostname || ''),
    freeDiskBytes: finiteInt(value.freeDiskBytes, 'FREE_DISK_BYTES'),
    totalDiskBytes: finiteInt(value.totalDiskBytes, 'TOTAL_DISK_BYTES'),
    freeMemoryBytes: finiteInt(value.freeMemoryBytes, 'FREE_MEMORY_BYTES'),
    totalMemoryBytes: finiteInt(value.totalMemoryBytes, 'TOTAL_MEMORY_BYTES'),
    cpuPercent: Number(value.cpuPercent),
    activeJobs: finiteInt(value.activeJobs ?? 0, 'ACTIVE_JOBS'),
    cacheBytes: finiteInt(value.cacheBytes ?? 0, 'CACHE_BYTES'),
    cachedObjectHashes: hashes,
    runtimeVersion: String(value.runtimeVersion || ''),
    capabilitiesHash: String(value.capabilitiesHash || ''),
  };
}

function normalizeRouteIntent(value = {}) {
  const taskId = String(value.taskId || '').trim();
  const summary = String(value.summary || '').trim();
  if (!taskId) throw new Error('TASK_ID_REQUIRED');
  if (!summary || summary.length > 2000) throw new Error('TASK_SUMMARY_INVALID');
  const artifactRefs = uniqueStrings(value.artifactRefs, 'ARTIFACT_REFS');
  for (const ref of artifactRefs) {
    if (!/^sha256:[0-9a-f]{64}$/i.test(ref)) throw new Error('INVALID_ARTIFACT_REF');
  }
  return {
    taskId,
    summary,
    repo: value.repo ? String(value.repo) : null,
    ref: value.ref ? String(value.ref) : null,
    requiredCapabilities: uniqueStrings(value.requiredCapabilities, 'REQUIRED_CAPABILITIES'),
    preferredCapabilities: uniqueStrings(value.preferredCapabilities, 'PREFERRED_CAPABILITIES'),
    estimatedScratchBytes: finiteInt(value.estimatedScratchBytes ?? 0, 'ESTIMATED_SCRATCH_BYTES'),
    artifactRefs,
    requiresInteractiveUi: value.requiresInteractiveUi === true,
    requiresGpu: value.requiresGpu === true,
    parallelSafe: value.parallelSafe === true,
    pinnedNodeId: value.pinnedNodeId ? String(value.pinnedNodeId) : null,
  };
}

module.exports = { loadFleetConfig, normalizeHeartbeat, normalizeRouteIntent };
```

Create `persistd/config/fleet.json` with non-secret initial registrations only:

```json
{
  "nodes": [
    { "id": "desktop-primary", "platform": "win32", "arch": "x64", "capabilities": ["git", "node", "python", "interactive-ui", "browser"], "affinities": ["interactive", "desktop"], "concurrencyLimit": 1, "drained": false },
    { "id": "ec2-primary", "platform": "win32", "arch": "x64", "capabilities": ["git", "node", "python", "remote-worker"], "affinities": ["background", "tests"], "concurrencyLimit": 2, "drained": false },
    { "id": "aws-vm", "platform": "linux", "arch": "x64", "capabilities": ["git", "node", "python", "remote-worker"], "affinities": ["background"], "concurrencyLimit": 1, "drained": false },
    { "id": "persistflow", "platform": "linux", "arch": "x64", "capabilities": ["persistflow"], "affinities": ["control-plane"], "concurrencyLimit": 1, "drained": true },
    { "id": "tsim-vm", "platform": "linux", "arch": "x64", "capabilities": ["git", "node", "python", "remote-worker"], "affinities": ["simulation"], "concurrencyLimit": 1, "drained": false },
    { "id": "tiktok-live-aws", "platform": "win32", "arch": "x64", "capabilities": ["git", "node", "python", "remote-worker"], "affinities": ["tiktok-live"], "concurrencyLimit": 1, "drained": false }
  ]
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd persistd
node --test fleet-contracts.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add persistd/src/fleet/contracts.js persistd/config/fleet.json persistd/fleet-contracts.test.js
git commit -m "feat: define persistflow fleet contracts"
```

---

### Task 2: Add authenticated heartbeat storage with freshness semantics

**Files:**
- Create: `persistd/src/fleet/auth.js`
- Create: `persistd/src/fleet/store.js`
- Create: `persistd/fleet-auth-store.test.js`

**Interfaces:**
- Consumes:
  - `normalizeHeartbeat(value)` from Task 1.
  - env JSON `PERSISTFLOW_FLEET_NODE_SECRETS_JSON` shaped as `{"desktop-primary":"...","ec2-primary":"..."}`.
- Produces:
  - `signNodeRequest({ nodeId, secret, timestamp, body }) -> hex`
  - `verifyNodeRequest({ nodeId, timestamp, signature, rawBody, secrets, nowMs, maxSkewMs }) -> boolean`
  - `FileFleetStore(directory).putHeartbeat(nodeId, heartbeat)`
  - `FileFleetStore(directory).snapshot({ nowMs, staleAfterMs })`

- [ ] **Step 1: Write failing authentication/freshness tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { signNodeRequest, verifyNodeRequest } = require('./src/fleet/auth');
const { FileFleetStore } = require('./src/fleet/store');

test('node request signature is body-bound and time-bound', () => {
  const body = JSON.stringify({ observedAt: '2026-09-24T17:00:00.000Z' });
  const timestamp = '2026-09-24T17:00:00.000Z';
  const secret = 'node-secret';
  const signature = signNodeRequest({ nodeId: 'ec2-primary', secret, timestamp, body });
  assert.equal(verifyNodeRequest({
    nodeId: 'ec2-primary', timestamp, signature, rawBody: body,
    secrets: { 'ec2-primary': secret },
    nowMs: () => Date.parse(timestamp),
  }), true);
  assert.equal(verifyNodeRequest({
    nodeId: 'ec2-primary', timestamp, signature, rawBody: body + 'x',
    secrets: { 'ec2-primary': secret },
    nowMs: () => Date.parse(timestamp),
  }), false);
});

test('fleet store marks heartbeat stale after 90 seconds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-'));
  const store = new FileFleetStore(dir);
  store.putHeartbeat('ec2-primary', {
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'EC2',
    freeDiskBytes: 100, totalDiskBytes: 200,
    freeMemoryBytes: 10, totalMemoryBytes: 20,
    cpuPercent: 10, activeJobs: 0, cacheBytes: 0,
    cachedObjectHashes: [], runtimeVersion: '1', capabilitiesHash: '',
  });
  const state = store.snapshot({ nowMs: Date.parse('2026-09-24T17:01:31.000Z'), staleAfterMs: 90_000 });
  assert.equal(state.nodes[0].fresh, false);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
cd persistd
node --test fleet-auth-store.test.js
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement HMAC verification**

Create `persistd/src/fleet/auth.js`:

```js
const crypto = require('node:crypto');

function canonicalNodeRequest({ nodeId, timestamp, body }) {
  return [String(nodeId), String(timestamp), String(body || '')].join('\n');
}

function signNodeRequest({ nodeId, secret, timestamp, body }) {
  return crypto.createHmac('sha256', String(secret))
    .update(canonicalNodeRequest({ nodeId, timestamp, body }), 'utf8')
    .digest('hex');
}

function safeEqualHex(a, b) {
  if (!/^[0-9a-f]{64}$/i.test(String(a)) || !/^[0-9a-f]{64}$/i.test(String(b))) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function verifyNodeRequest({
  nodeId, timestamp, signature, rawBody, secrets,
  nowMs = Date.now, maxSkewMs = 5 * 60 * 1000,
}) {
  const secret = secrets?.[nodeId];
  if (!secret || !timestamp || !signature) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || Math.abs(Number(nowMs()) - parsed) > maxSkewMs) return false;
  const expected = signNodeRequest({ nodeId, secret, timestamp, body: rawBody });
  return safeEqualHex(expected, signature);
}

module.exports = { canonicalNodeRequest, signNodeRequest, verifyNodeRequest };
```

- [ ] **Step 4: Implement atomic file-backed fleet state**

Create `persistd/src/fleet/store.js` using one JSON file per node and the same temp-write/rename pattern already used by `FileAuthorityStore`. `snapshot` must return sorted nodes and compute `fresh` from server time, not trust a client-provided boolean.

Use this exact exported shape:

```js
module.exports = { MemoryFleetStore, FileFleetStore };
```

and each snapshot row must include:

```js
{
  nodeId,
  heartbeat,
  fresh,
  ageMs,
}
```

- [ ] **Step 5: Run focused tests**

```bash
cd persistd
node --test fleet-auth-store.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add persistd/src/fleet/auth.js persistd/src/fleet/store.js persistd/fleet-auth-store.test.js
git commit -m "feat: persist authenticated fleet heartbeats"
```

---

### Task 3: Expose fleet heartbeat and status through PersistFlow

**Files:**
- Modify: `persistd/src/persistflow/service.js`
- Modify: `persistd/src/persistflow/http-server.js`
- Modify: `persistd/src/persistflow/mcp-handler.js`
- Modify: `persistd/src/start-entrypoint.js`
- Create: `persistd/persistflow-fleet-integration.test.js`

**Interfaces:**
- Consumes: `FleetStore`, Task 2 HMAC verifier, Task 1 registry.
- Produces:
  - HTTP `POST /v1/fleet/nodes/:nodeId/heartbeat`
  - MCP `persist_fleet_status`
  - `PersistFlowService.fleetStatus()`
  - `PersistFlowService.fleetHeartbeat(nodeId, heartbeat)`

- [ ] **Step 1: Write failing integration tests**

Add a server test that signs the raw JSON body, posts a valid heartbeat and then reads status. Add a second case with a bad signature expecting `401`.

The successful assertion must be:

```js
assert.equal(status.nodes.find((node) => node.nodeId === 'ec2-primary').fresh, true);
```

- [ ] **Step 2: Run RED**

```bash
cd persistd
node --test persistflow-fleet-integration.test.js
```

Expected: `404` for the heartbeat route.

- [ ] **Step 3: Inject fleet dependencies into `PersistFlowService`**

Change the constructor to:

```js
constructor({ store, clock = () => new Date(), sandbox = null, fleetStore = null, fleetConfig = { nodes: [] }, fleetRouter = null, driveAuth = null } = {}) {
  if (!store) throw new Error('AUTHORITY_STORE_REQUIRED');
  this.store = store;
  this.clock = clock;
  this.sandbox = sandbox;
  this.fleetStore = fleetStore;
  this.fleetConfig = fleetConfig;
  this.fleetRouter = fleetRouter;
  this.driveAuth = driveAuth;
}
```

Add:

```js
fleetHeartbeat(nodeId, heartbeat) {
  if (!this.fleetStore) throw new Error('FLEET_NOT_CONFIGURED');
  return this.fleetStore.putHeartbeat(nodeId, heartbeat);
}

fleetStatus() {
  if (!this.fleetStore) throw new Error('FLEET_NOT_CONFIGURED');
  return this.fleetStore.snapshot({ nowMs: this.clock().getTime(), staleAfterMs: 90_000 });
}
```

- [ ] **Step 4: Add the authenticated HTTP route**

In `http-server.js`, preserve the exact raw request body for signature verification. Extend `readJson` to optionally return `{ value, raw }` instead of re-serializing parsed JSON.

The heartbeat route must read:

```text
x-persistflow-node-id
x-persistflow-node-timestamp
x-persistflow-node-signature
```

and reject when the path node ID does not exactly match the signed header node ID.

- [ ] **Step 5: Add read-only MCP fleet status**

Register:

```js
server.registerTool('persist_fleet_status', {
  title: 'Inspect PersistFlow fleet',
  description: 'Read registered fleet health and freshness without mutating machines.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true },
}, async () => jsonResult({ fleet: service.fleetStatus() }));
```

- [ ] **Step 6: Wire production file store and config**

`start-entrypoint.js` must load `persistd/config/fleet.json`, create `FileFleetStore(path.join(productionDataDir(), 'fleet'))`, and pass the dependencies into `createServer`.

Do not read node secrets from a repo file. Parse them only from `PERSISTFLOW_FLEET_NODE_SECRETS_JSON`.

- [ ] **Step 7: Run integration tests**

```bash
cd persistd
node --test fleet-auth-store.test.js persistflow-fleet-integration.test.js mcp-http.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add persistd/src/persistflow/service.js persistd/src/persistflow/http-server.js persistd/src/persistflow/mcp-handler.js persistd/src/start-entrypoint.js persistd/persistflow-fleet-integration.test.js
git commit -m "feat: expose persistflow fleet health"
```

---

### Task 4: Build the cross-platform node agent and disk/resource telemetry

**Files:**
- Create: `persistd/src/fleet/node-agent.js`
- Create: `persistd/fleet-node-agent.test.js`
- Create: `persistd/scripts/install-fleet-agent.ps1`
- Create: `persistd/scripts/install-fleet-agent.sh`
- Modify: `persistd/package.json`

**Interfaces:**
- Consumes env:
  - `PERSISTFLOW_BASE_URL`
  - `PERSISTFLOW_FLEET_NODE_ID`
  - `PERSISTFLOW_FLEET_NODE_SECRET`
  - `GABRIEL_CACHE_DIR` optional
- Produces:
  - `collectHeartbeat(options) -> Promise<FleetHeartbeat>`
  - `postHeartbeat(options) -> Promise<void>`
  - CLI loop every 30 seconds.

- [ ] **Step 1: Write failing telemetry test with injected filesystem/OS probes**

The test must avoid depending on the host machine. Inject `statfs`, `memory`, `cpuSampler`, hostname, and cache inventory; assert exact byte values are forwarded and object hashes are deduplicated.

- [ ] **Step 2: Run RED**

```bash
cd persistd
node --test fleet-node-agent.test.js
```

- [ ] **Step 3: Implement CPU sampling and disk telemetry**

Use `fs.promises.statfs(cacheRoot)` for filesystem capacity and two `os.cpus()` snapshots separated by 250 ms to compute aggregate CPU percentage. Clamp CPU into `0..100`.

The agent must calculate a capability hash as:

```js
crypto.createHash('sha256')
  .update(JSON.stringify([...capabilities].sort()), 'utf8')
  .digest('hex')
```

- [ ] **Step 4: Implement signed heartbeat POST**

Build the raw JSON string once, sign that exact string with Task 2 `signNodeRequest`, and send it unchanged. Do not call `JSON.stringify` a second time after signing.

- [ ] **Step 5: Add service installers**

Windows installer creates a Scheduled Task named `Gabriel Fleet Agent` that starts at logon and restarts on failure. It invokes:

```text
node <repo>\persistd\src\fleet\node-agent.js
```

Linux installer creates `~/.config/systemd/user/gabriel-fleet-agent.service` with `Restart=always` and `RestartSec=5`.

Neither script writes secret values into the repository. Windows reads the node secret from the task user's environment; Linux reads an external `EnvironmentFile=%h/.config/gabriel/fleet-agent.env` with mode `0600`.

- [ ] **Step 6: Add package script**

```json
"fleet:agent": "node src/fleet/node-agent.js"
```

- [ ] **Step 7: Run tests**

```bash
cd persistd
node --test fleet-node-agent.test.js fleet-auth-store.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add persistd/src/fleet/node-agent.js persistd/fleet-node-agent.test.js persistd/scripts/install-fleet-agent.ps1 persistd/scripts/install-fleet-agent.sh persistd/package.json
git commit -m "feat: add persistflow fleet node agent"
```

---

### Task 5: Implement the Google OAuth access-token broker without exposing the refresh token

**Files:**
- Create: `persistd/src/storage/drive-auth.js`
- Create: `persistd/drive-auth.test.js`
- Modify: `persistd/src/persistflow/service.js`
- Modify: `persistd/src/persistflow/http-server.js`

**Interfaces:**
- Consumes central-only env:
  - `GOOGLE_DRIVE_CLIENT_ID`
  - `GOOGLE_DRIVE_CLIENT_SECRET`
  - `GOOGLE_DRIVE_REFRESH_TOKEN`
  - `GABRIEL_DRIVE_ROOT_ID`
- Produces:
  - `DriveTokenProvider.getAccess() -> { accessToken, expiresAt, scope, rootId }`
  - HTTP `POST /v1/fleet/nodes/:nodeId/drive-token`, protected by the same node HMAC scheme.

- [ ] **Step 1: Write failing token refresh/cache tests**

Use a fake `fetchImpl` that returns:

```json
{
  "access_token": "access-1",
  "expires_in": 3600,
  "scope": "https://www.googleapis.com/auth/drive.file",
  "token_type": "Bearer"
}
```

Call `getAccess()` twice within the cache window and assert the fake token endpoint was invoked once.

Add a test where the returned scope omits `drive.file` and assert `DRIVE_SCOPE_MISMATCH`.

- [ ] **Step 2: Run RED**

```bash
cd persistd
node --test drive-auth.test.js
```

- [ ] **Step 3: Implement refresh-token exchange**

`drive-auth.js` must POST URL-encoded fields to `https://oauth2.googleapis.com/token`:

```js
const body = new URLSearchParams({
  client_id: this.clientId,
  client_secret: this.clientSecret,
  refresh_token: this.refreshToken,
  grant_type: 'refresh_token',
});
```

Cache the access token until 60 seconds before expiry. Never return client secret or refresh token from any method.

- [ ] **Step 4: Add node-authenticated token endpoint**

The response body must be exactly:

```json
{
  "accessToken": "<short-lived>",
  "expiresAt": "2026-09-24T18:00:00.000Z",
  "scope": "https://www.googleapis.com/auth/drive.file",
  "rootId": "<configured-root-id>"
}
```

The route must reject unregistered nodes even if a correct-looking HMAC secret exists in env.

- [ ] **Step 5: Run tests**

```bash
cd persistd
node --test drive-auth.test.js persistflow-fleet-integration.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add persistd/src/storage/drive-auth.js persistd/drive-auth.test.js persistd/src/persistflow/service.js persistd/src/persistflow/http-server.js
git commit -m "feat: broker short-lived drive access"
```

---

### Task 6: Implement Drive API primitives and resumable uploads

**Files:**
- Create: `persistd/src/storage/drive-client.js`
- Create: `persistd/drive-client.test.js`

**Interfaces:**
- Consumes: `tokenProvider() -> Promise<{ accessToken, rootId }>`
- Produces:
  - `searchByHash(sha256)`
  - `createFolder(name, parentId)`
  - `downloadToFile(fileId, tempPath)`
  - `startResumableUpload({ name, parentId, appProperties, size, mimeType })`
  - `uploadFileResumable({ filePath, sessionUrl, startOffset })`
  - `getStartPageToken()`
  - `listChanges(pageToken)`

- [ ] **Step 1: Write failing resumable-upload tests**

Fake the Drive API so:
1. session creation returns a `Location` header;
2. first 8 MiB `PUT` returns `308` with `Range: bytes=0-8388607`;
3. injected network failure occurs;
4. status probe returns the same range;
5. resumed final `PUT` returns file metadata.

Assert that the second transfer begins at byte `8388608`, not zero.

- [ ] **Step 2: Run RED**

```bash
cd persistd
node --test drive-client.test.js
```

- [ ] **Step 3: Implement Drive metadata/search calls**

All calls use `Authorization: Bearer <accessToken>`. Search hash with:

```text
'<rootId>' in parents and trashed = false and appProperties has { key='gdb_sha256' and value='<sha>' }
```

Request only required fields:

```text
files(id,name,size,mimeType,appProperties,modifiedTime),nextPageToken
```

- [ ] **Step 4: Implement resumable upload in 8 MiB chunks**

Use `8 * 1024 * 1024`, which is a multiple of Drive's 256 KiB resumable chunk requirement.

Read each chunk from a file descriptor at an explicit byte offset and send:

```text
Content-Length: <chunk bytes>
Content-Range: bytes <start>-<end>/<total>
```

Treat `308` as incomplete and parse the response `Range`. Treat `200` or `201` as complete. On network failure, send an empty `PUT` with `Content-Range: bytes */<total>` to learn the accepted offset before retrying.

- [ ] **Step 5: Implement streaming download**

Download to `<target>.partial-<uuid>`; do not write directly to a canonical cache path. The caller owns hash verification and final rename.

- [ ] **Step 6: Run focused tests**

```bash
cd persistd
node --test drive-client.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add persistd/src/storage/drive-client.js persistd/drive-client.test.js
git commit -m "feat: add resilient drive api client"
```

---

### Task 7: Build the content-addressed object store, cache manager, and incremental catalog

**Files:**
- Create: `persistd/src/storage/object-store.js`
- Create: `persistd/src/storage/cache-manager.js`
- Create: `persistd/src/storage/catalog-sync.js`
- Create: `persistd/object-store-cache.test.js`
- Create: `persistd/catalog-sync.test.js`
- Create: `persistd/scripts/bootstrap-drive-store.js`
- Modify: `persistd/package.json`

**Interfaces:**
- Consumes: Task 6 `DriveClient`.
- Produces:
  - `hashFile(path) -> Promise<{ sha256, size }>`
  - `DriveObjectStore.put(filePath, metadata) -> ObjectRef`
  - `DriveObjectStore.resolve(ref) -> DriveFile`
  - `CacheManager.acquire(ref, fetcher) -> localPath`
  - `CacheManager.pin(ref) / unpin(ref)`
  - `CacheManager.evictFor(requiredBytes)`
  - `CatalogSync.syncOnce()`

- [ ] **Step 1: Write failing idempotency/cache tests**

Required cases:
- two calls to `put` with identical bytes return the same canonical SHA reference;
- a downloaded object's wrong SHA deletes the partial file and throws `OBJECT_HASH_MISMATCH`;
- eviction skips pinned entries;
- eviction removes oldest unpinned entries until target free space is reached;
- if free space remains insufficient, `evictFor` throws `INSUFFICIENT_LOCAL_CAPACITY`.

- [ ] **Step 2: Write failing catalog replay test**

Feed the same Drive change page twice and assert the local catalog is unchanged after the second application. Then feed a removed-file change and assert the mapping is removed without deleting unrelated cache bytes.

- [ ] **Step 3: Run RED**

```bash
cd persistd
node --test object-store-cache.test.js catalog-sync.test.js
```

- [ ] **Step 4: Implement immutable object semantics**

Object metadata sent to Drive must include:

```js
{
  gdb_schema: '1',
  gdb_sha256: sha256,
  gdb_namespace: String(metadata.namespace || 'default').slice(0, 80),
  gdb_kind: String(metadata.kind || 'artifact').slice(0, 40),
  gdb_size: String(size),
}
```

Before upload, call `searchByHash`. If one or more verified-size matches exist, pick the lexicographically smallest file ID as canonical and return without uploading.

After a new upload, query by hash again. If multiple matches now exist, return the smallest ID and record the remaining IDs as duplicate cleanup candidates; do not delete them in the write path.

- [ ] **Step 5: Implement cache index atomically**

Store index at `<cacheRoot>/index.json`. Use `index.json.<pid>.<uuid>.tmp` plus rename.

Each entry:

```js
{
  sha256,
  fileId,
  size,
  lastAccessAt,
  pinnedCount,
  verifiedAt
}
```

Cache object bytes live at `<cacheRoot>/objects/<sha256>`.

- [ ] **Step 6: Implement exact eviction thresholds**

Compute:

```js
const startReserve = Math.max(50 * GiB, Math.floor(totalBytes * 0.10));
const targetReserve = Math.max(80 * GiB, Math.floor(totalBytes * 0.15));
```

Start eviction when `freeBytes - requiredBytes < startReserve` or cache exceeds `GABRIEL_CACHE_MAX_BYTES`. Stop only when projected free bytes reach `targetReserve` and cache is below max.

- [ ] **Step 7: Implement Drive changes cursor**

Persist cursor at `<cacheRoot>/catalog-state.json`. Initial bootstrap calls `getStartPageToken`. Subsequent sync calls `listChanges(cursor)` until no `nextPageToken`, then atomically stores `newStartPageToken`.

Apply only files within the configured Drive root/object namespace and only files with valid `gdb_sha256`.

- [ ] **Step 8: Implement one-time root bootstrap**

`bootstrap-drive-store.js` creates:
- `Gabriel Object Store`
- `objects`
- `manifests`
- `quarantine`

It prints only folder IDs and writes them to `$PERSISTFLOW_DATA_DIR/drive-store.json` with mode `0600`. It never prints OAuth credentials.

- [ ] **Step 9: Add package scripts**

```json
"drive:bootstrap": "node scripts/bootstrap-drive-store.js"
```

- [ ] **Step 10: Run tests**

```bash
cd persistd
node --test drive-client.test.js object-store-cache.test.js catalog-sync.test.js
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add persistd/src/storage/object-store.js persistd/src/storage/cache-manager.js persistd/src/storage/catalog-sync.js persistd/object-store-cache.test.js persistd/catalog-sync.test.js persistd/scripts/bootstrap-drive-store.js persistd/package.json
git commit -m "feat: add drive object store and local cache"
```

---

### Task 8: Implement deterministic eligibility and TypeSafe semantic routing

**Files:**
- Create: `persistd/src/fleet/eligibility.js`
- Create: `persistd/src/fleet/typesafe-router.js`
- Create: `persistd/src/fleet/router.js`
- Create: `persistd/typesafe-fleet-router.test.js`

**Interfaces:**
- Consumes:
  - Fleet registry from Task 1.
  - Heartbeat snapshot from Task 2.
  - `RouteIntent`.
  - env `TYPESAFE_API_KEY`; optional `TYPESAFE_ENDPOINT` and `TYPESAFE_MODEL`.
- Produces:
  - `eligibleNodes({ config, snapshot, intent, nowMs })`
  - `deterministicOrder(candidates, intent)`
  - `TypeSafeFleetRouter.score({ intent, candidates })`
  - `FleetRouter.route(intent) -> RouteDecision`

- [ ] **Step 1: Write failing hard-eligibility tests**

Cover:
- stale node excluded;
- drained node excluded;
- missing required capability excluded;
- interactive UI excludes EC2 if it does not declare `interactive-ui`;
- scratch allocation that would violate reserve excludes node;
- activeJobs >= concurrencyLimit excludes node;
- pinned node mismatch excludes all others.

- [ ] **Step 2: Write failing TypeSafe safety tests**

Use fake answers where TypeSafe gives a high score to a node that was not in the eligible set. Assert the final decision never includes that node.

Use malformed answers and a simulated HTTP 500. With two eligible candidates, assert `decisionSource === 'deterministic-fallback'`.

- [ ] **Step 3: Run RED**

```bash
cd persistd
node --test typesafe-fleet-router.test.js
```

- [ ] **Step 4: Implement deterministic eligibility**

The disk check must use the same reserve function as Task 7. Export it from `cache-manager.js` instead of duplicating constants.

Candidate rows sent forward must include only:

```js
{
  id,
  platform,
  capabilities,
  affinities,
  freeDiskBytes,
  totalDiskBytes,
  freeMemoryBytes,
  totalMemoryBytes,
  cpuPercent,
  activeJobs,
  cachedArtifactCount,
}
```

- [ ] **Step 5: Implement TypeSafe scoring using the existing System One request pattern**

For each candidate generate one score question:

```js
questions['candidate__' + safeId] = {
  type: 'score',
  instructions: 'How suitable is this already-eligible node for the task, considering task semantics, resource headroom, artifact locality, interaction needs, and coordination cost?',
  criteria: [
    'Eligible but poor fit; another eligible node is materially better.',
    'Acceptable fit with no material blocker.',
    'Strong fit for this task.',
  ],
};
```

POST:

```js
{
  state: {
    task: intent,
    candidates: candidates.map(redactCandidate),
  },
  model: process.env.TYPESAFE_MODEL || 'jev-latest',
  questions,
}
```

to `process.env.TYPESAFE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone'`.

Do not include environment, credentials, file contents, repo secrets, or logs in `state`.

- [ ] **Step 6: Implement final route selection**

Selection order:
1. highest TypeSafe score;
2. most requested hashes cached;
3. highest post-allocation free-disk ratio;
4. fewest active jobs;
5. lexicographically smallest ID.

If TypeSafe errors or answers are invalid, skip criterion 1 and use 2–5.

Return:

```js
{
  taskId,
  nodeId,
  decisionSource,
  eligibleNodeIds,
  typesafeScores,
  evaluatedAt,
}
```

- [ ] **Step 7: Run focused tests**

```bash
cd persistd
node --test typesafe-fleet-router.test.js object-store-cache.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add persistd/src/fleet/eligibility.js persistd/src/fleet/typesafe-router.js persistd/src/fleet/router.js persistd/typesafe-fleet-router.test.js
git commit -m "feat: route fleet work with typesafe scoring"
```

---

### Task 9: Make routing durable in PersistFlow and project it into Baton v2

**Files:**
- Modify: `persistd/src/persistflow/service.js`
- Modify: `persistd/src/persistflow/mcp-handler.js`
- Modify: `persistd/src/persistflow/baton-v2.js`
- Modify: `persistd/persistflow-baton.test.js`
- Modify: `persistd/persistflow-fleet-integration.test.js`

**Interfaces:**
- Consumes: `FleetRouter.route(intent)`.
- Produces:
  - `PersistFlowService.routeTask(runId, { generation, intent })`
  - MCP `persist_fleet_route`
  - `run.latestRoute`
  - Baton `machine.nodeId` in addition to existing `deviceId`.

- [ ] **Step 1: Write failing durable-route test**

Start a run, route a task, inspect the run and assert:

```js
assert.equal(run.latestRoute.nodeId, 'ec2-primary');
assert.equal(run.latestCheckpoint.evidence.type, 'fleet.route');
assert.equal(run.latestCheckpoint.evidence.taskId, 'task-123');
```

- [ ] **Step 2: Write failing Baton test**

Given state with:

```js
LATEST_ROUTE_JSON: JSON.stringify({ nodeId: 'ec2-primary', taskId: 'task-123' })
```

assert:

```js
assert.equal(baton.machine.nodeId, 'ec2-primary');
```

while preserving existing `deviceId`.

- [ ] **Step 3: Run RED**

```bash
cd persistd
node --test persistflow-fleet-integration.test.js persistflow-baton.test.js
```

- [ ] **Step 4: Implement `routeTask`**

The method must first call `assertRunGeneration`, then route, then append a checkpoint with:

```js
{
  type: 'fleet.route',
  taskId: decision.taskId,
  nodeId: decision.nodeId,
  decisionSource: decision.decisionSource,
  eligibleNodeIds: decision.eligibleNodeIds,
  evaluatedAt: decision.evaluatedAt,
}
```

Finally update `latestRoute` in the same authority-store update as the checkpoint, not in two independent writes.

Refactor `checkpoint` only as much as required to support an updater that can add both fields atomically.

- [ ] **Step 5: Register MCP route tool**

```js
server.registerTool('persist_fleet_route', {
  title: 'Route a PersistFlow task to the fleet',
  description: 'Choose and durably record the best eligible machine for one bounded task intent.',
  inputSchema: z.object({
    runId: z.string().min(1),
    generation: z.number().int().positive(),
    intent: z.object({
      taskId: z.string().min(1),
      summary: z.string().min(1).max(2000),
      repo: z.string().optional(),
      ref: z.string().optional(),
      requiredCapabilities: z.array(z.string()).default([]),
      preferredCapabilities: z.array(z.string()).default([]),
      estimatedScratchBytes: z.number().int().nonnegative().default(0),
      artifactRefs: z.array(z.string()).default([]),
      requiresInteractiveUi: z.boolean().default(false),
      requiresGpu: z.boolean().default(false),
      parallelSafe: z.boolean().default(false),
      pinnedNodeId: z.string().optional(),
    }),
  }),
}, async ({ runId, ...input }) => jsonResult(await service.routeTask(runId, input)));
```

- [ ] **Step 6: Project selected node into Baton v2**

Parse `state.LATEST_ROUTE_JSON` and return:

```js
machine: {
  deviceId: state.DEVICE_ID || null,
  nodeId: latestRoute?.nodeId || null,
}
```

Do not replace `deviceId`; it remains the concrete Commander attachment when known.

- [ ] **Step 7: Run integration tests**

```bash
cd persistd
node --test persistflow-fleet-integration.test.js persistflow-baton.test.js mcp-http.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add persistd/src/persistflow/service.js persistd/src/persistflow/mcp-handler.js persistd/src/persistflow/baton-v2.js persistd/persistflow-baton.test.js persistd/persistflow-fleet-integration.test.js
git commit -m "feat: persist fleet route decisions"
```

---

### Task 10: Integrate object storage into node routing and expose safe storage tools

**Files:**
- Modify: `persistd/src/fleet/node-agent.js`
- Modify: `persistd/src/persistflow/service.js`
- Modify: `persistd/src/persistflow/mcp-handler.js`
- Modify: `persistd/persistflow-fleet-integration.test.js`
- Create: `persistd/storage-mcp.test.js`

**Interfaces:**
- Consumes: Task 7 object store/cache/catalog.
- Produces:
  - MCP `persist_object_lookup` read-only.
  - MCP `persist_cache_status` read-only for current/selected node evidence.
  - Node heartbeat advertises cached object hashes and cache bytes.
  - Route intent artifact locality affects TypeSafe/fallback ranking.

- [ ] **Step 1: Write failing locality test**

Give Desktop two requested artifacts cached and EC2 zero, with otherwise equal resource state. Make TypeSafe scores equal and assert Desktop wins by the deterministic locality tie-break.

- [ ] **Step 2: Write failing safe-storage MCP test**

`persist_object_lookup` accepts only `sha256:<64hex>` and returns metadata/file ID, never an OAuth token or refresh credential.

- [ ] **Step 3: Run RED**

```bash
cd persistd
node --test storage-mcp.test.js typesafe-fleet-router.test.js
```

- [ ] **Step 4: Wire cache inventory into node heartbeat**

Limit `cachedObjectHashes` to the 256 most recently accessed objects to bound heartbeat size. The node agent must include full `cacheBytes` even when hashes are truncated.

- [ ] **Step 5: Add read-only storage tools**

`persist_object_lookup` invokes catalog/object metadata only. It does not download bytes through MCP.

`persist_cache_status` returns heartbeat-derived cache bytes/hash count and freshness; it does not read arbitrary local filesystem paths.

- [ ] **Step 6: Run tests**

```bash
cd persistd
node --test storage-mcp.test.js fleet-node-agent.test.js typesafe-fleet-router.test.js persistflow-fleet-integration.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add persistd/src/fleet/node-agent.js persistd/src/persistflow/service.js persistd/src/persistflow/mcp-handler.js persistd/persistflow-fleet-integration.test.js persistd/storage-mcp.test.js
git commit -m "feat: connect drive locality to fleet routing"
```

---

### Task 11: Add operational docs, security checks, and end-to-end fake-provider acceptance

**Files:**
- Create: `persistd/docs/drive-fleet-operations.md`
- Create: `persistd/drive-fleet-acceptance.test.js`
- Modify: `.gitignore` if local data paths are not already covered.
- Modify: `docs/context/ACTIVE_LEARNING_LOG.md` only if implementation uncovers a new durable failure pattern not already recorded.

**Interfaces:**
- Consumes all prior tasks.
- Produces a reproducible fake-provider acceptance suite and operator runbook.

- [ ] **Step 1: Write end-to-end acceptance test**

Use:
- Memory authority store;
- Memory fleet store;
- fake TypeSafe fetch;
- fake Drive token endpoint;
- fake Drive API;
- temporary cache directory.

Prove in one test:
1. Desktop and EC2 heartbeat;
2. a 20 GiB scratch requirement excludes the low-disk node;
3. TypeSafe ranks the remaining eligible node;
4. route is checkpointed;
5. object upload returns a SHA ref;
6. local cache fetch verifies the hash;
7. Baton contains the selected `nodeId`.

No live Google, TypeSafe, or machine credential is required for this test.

- [ ] **Step 2: Add secret-leak regression**

Recursively inspect generated TypeSafe request fixtures and serialized route evidence and assert they do not contain values of:
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `PERSISTFLOW_FLEET_NODE_SECRET`
- `TYPESAFE_API_KEY`

Use test-local sentinel values such as `SHOULD_NOT_LEAK_REFRESH`.

- [ ] **Step 3: Write the operations runbook**

Document exact order:
1. configure Google OAuth app with `drive.file`;
2. store OAuth values only on PersistFlow host;
3. run `npm run drive:bootstrap` once;
4. configure per-node fleet secret;
5. install node agent;
6. verify `persist_fleet_status`;
7. dry-route a bounded task;
8. verify Drive put/get using a disposable test file;
9. only then enable `PERSISTFLOW_FLEET_ROUTER_ENABLED=1`.

Document rollback: set feature flag to `0`; existing PersistFlow behavior continues and Drive objects remain untouched.

- [ ] **Step 4: Run the focused acceptance suite**

```bash
cd persistd
node --test drive-fleet-acceptance.test.js
```

Expected: PASS.

- [ ] **Step 5: Run the complete PersistFlow test suite once**

```bash
cd persistd
npm test
```

Expected: all existing and new tests PASS.

- [ ] **Step 6: Run repository-level checks relevant to this change**

From repository root:

```bash
git diff --check
git status --short
```

If the repository has a documented broader test command outside `persistd`, run it once here, not repeatedly during earlier tasks.

- [ ] **Step 7: Commit**

```bash
git add persistd/docs/drive-fleet-operations.md persistd/drive-fleet-acceptance.test.js .gitignore docs/context/ACTIVE_LEARNING_LOG.md
git commit -m "docs: operationalize drive-backed fleet routing"
```

---

## Self-Review

### Spec coverage

- PersistFlow remains authority: Tasks 3, 9, 11.
- Drive content-addressed durable store: Tasks 5–7.
- Resumable large uploads and hash verification: Tasks 6–7.
- Local disk cache/eviction: Task 7.
- Fleet registry and fresh health: Tasks 1–4.
- TypeSafe semantic scheduler with deterministic bounds: Task 8.
- Durable route evidence and Baton continuity: Task 9.
- Artifact locality influences scheduling: Task 10.
- Secrets remain out of Drive metadata/TypeSafe/Git: Tasks 5, 8, 11.
- Feature-disable rollback: Task 11.
- Gabriel Ops remains read-only: intentionally outside this implementation plan and handled by a separate observability plan after the core contracts are stable.
- PersistFlow Sandbox remains untouched: explicitly preserved.

### Placeholder scan

No `TBD`, `TODO`, “implement later”, unspecified error-handling step, or undefined neighboring interface is required by this plan. All deferred work is explicitly outside scope rather than left as a placeholder.

### Type/interface consistency

- Fleet node ID is consistently `nodeId`.
- Task identity is consistently `taskId`.
- Artifact references are consistently `sha256:<64hex>`.
- Route output is consistently `RouteDecision` with `nodeId`, `decisionSource`, `eligibleNodeIds`, and `evaluatedAt`.
- Baton retains `deviceId` and adds `nodeId`; neither field replaces the other.
- Drive auth returns only short-lived `accessToken`, expiry, scope, and root ID.

### Review Focus mapping

- forged/stale heartbeat -> Tasks 2–3;
- malformed/ineligible TypeSafe result -> Task 8;
- interrupted/corrupt Drive transfer -> Tasks 6–7;
- pinned cache under disk pressure -> Task 7;
- duplicate/replayed Drive state -> Task 7.

---

## Execution Notes

Implementation should begin from a fresh isolated worktree created from current `main` using `superpowers:using-git-worktrees`. Each task gets its own test cycle and commit. Do not deploy or install agents on production machines until Task 11 acceptance is green in a fake-provider environment.

For the first live rollout, enroll only `desktop-primary` and `ec2-primary`, because those are the two machines with currently verified Remote Desktop Commander connectivity. Add the remaining registered fleet nodes only after each has a fresh heartbeat and its local cache/storage smoke test passes.

The Drive API design in this plan relies on currently documented v3 features: searchable private `appProperties`, `changes.getStartPageToken`/`changes.list` incremental tracking, and resumable uploads for interruption-prone or >5 MB transfers.

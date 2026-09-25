const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { collectHeartbeat, postHeartbeat } = require('./src/fleet/node-agent');

test('collectHeartbeat forwards injected machine metrics and deduplicates cache hashes', async () => {
  const beat = await collectHeartbeat({
    cacheRoot: 'X:/cache',
    ensureCacheRoot: async () => {},
    statfs: async () => ({ bsize: 10, bavail: 12, blocks: 50 }),
    memory: () => ({ freeMemoryBytes: 20, totalMemoryBytes: 64 }),
    cpuSampler: async () => 12.5,
    hostname: () => 'NODE-A',
    activeJobs: () => 2,
    cacheInventory: async () => ({
      cacheBytes: 99,
      cachedObjectHashes: ['b'.repeat(64), 'a'.repeat(64), 'a'.repeat(64)],
    }),
    capabilities: ['python', 'node', 'node'],
    runtimeVersion: 'agent-1',
    now: () => new Date('2026-09-24T17:00:00.000Z'),
  });
  assert.equal(beat.freeDiskBytes, 120);
  assert.equal(beat.totalDiskBytes, 500);
  assert.deepEqual(beat.cachedObjectHashes, ['a'.repeat(64), 'b'.repeat(64)]);
  assert.equal(beat.capabilitiesHash, crypto.createHash('sha256')
    .update(JSON.stringify(['node', 'python']), 'utf8').digest('hex'));
});

test('postHeartbeat signs the exact raw body and heartbeat path', async () => {
  let observed;
  const heartbeat = {
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'NODE-A',
    freeDiskBytes: 1, totalDiskBytes: 2, freeMemoryBytes: 1, totalMemoryBytes: 2,
    cpuPercent: 1, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [],
    runtimeVersion: '1', capabilitiesHash: '',
  };
  await postHeartbeat({
    baseUrl: 'https://persist.example',
    nodeId: 'desktop-primary',
    secret: 's',
    heartbeat,
    timestamp: '2026-09-24T17:00:00.000Z',
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  assert.equal(observed.url, 'https://persist.example/v1/fleet/nodes/desktop-primary/heartbeat');
  assert.equal(observed.init.body, JSON.stringify(heartbeat));
  assert.match(observed.init.headers['x-persistflow-node-signature'], /^[0-9a-f]{64}$/);
});

test('fleet agent installers and package script are present without embedded secrets', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const winPath = path.join(__dirname, 'scripts', 'install-fleet-agent.ps1');
  const linuxPath = path.join(__dirname, 'scripts', 'install-fleet-agent.sh');
  assert.equal(fs.existsSync(winPath), true);
  assert.equal(fs.existsSync(linuxPath), true);
  const win = fs.readFileSync(winPath, 'utf8');
  const linux = fs.readFileSync(linuxPath, 'utf8');
  assert.match(win, /Gabriel Fleet Agent/);
  assert.match(win, /PERSISTFLOW_FLEET_NODE_SECRET/);
  assert.match(linux, /EnvironmentFile=%h\/\.config\/gabriel\/fleet-agent\.env/);
  assert.doesNotMatch(win + linux, /fleet-secret|google.*refresh/i);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['fleet:agent'], 'node src/fleet/node-agent.js');
});

test('cache inventory advertises at most 256 most-recent hashes', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { readCacheInventory } = require('./src/fleet/node-agent');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cache-inventory-'));
  const entries = {};
  for (let i = 0; i < 300; i += 1) {
    const sha = i.toString(16).padStart(64, '0');
    entries[sha] = {
      sha256: sha, size: 1, lastAccessAt: new Date(1700000000000 + i * 1000).toISOString(),
    };
  }
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ entries }), 'utf8');
  const inventory = await readCacheInventory(root);
  assert.equal(inventory.cachedObjectHashes.length, 256);
  assert.equal(inventory.cacheBytes, 300);
  assert.equal(inventory.cachedObjectHashes[0], (299).toString(16).padStart(64, '0'));
});

test('collectHeartbeat ensures cache root exists before statfs', async () => {
  const events = [];
  await collectHeartbeat({
    cacheRoot: 'virtual-cache',
    ensureCacheRoot: async (root) => { events.push('mkdir:' + root); },
    statfs: async () => {
      events.push('statfs');
      return { bsize: 1, bavail: 100, blocks: 200 };
    },
    memory: () => ({ freeMemoryBytes: 10, totalMemoryBytes: 20 }),
    cpuSampler: async () => 1,
    hostname: () => 'NODE',
    activeJobs: () => 0,
    cacheInventory: async () => ({ cacheBytes: 0, cachedObjectHashes: [] }),
    capabilities: [],
    runtimeVersion: '1',
    now: () => new Date('2026-09-24T17:00:00Z'),
  });
  assert.deepEqual(events.slice(0, 2), ['mkdir:virtual-cache', 'statfs']);
});

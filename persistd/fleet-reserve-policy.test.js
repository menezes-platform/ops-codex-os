const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eligibleNodes } = require('./src/fleet/eligibility');
const { CacheManager, evictionReserves, GiB } = require('./src/storage/cache-manager');

function candidates(freeGiB, { scratchGiB = 0, totalGiB = 223, activeJobs = 0 } = {}) {
  const nodeId = 'desktop-primary';
  const hb = {
    freeDiskBytes: freeGiB * GiB, totalDiskBytes: totalGiB * GiB,
    freeMemoryBytes: 12 * GiB, totalMemoryBytes: 32 * GiB,
    cpuPercent: 8, activeJobs, cachedObjectHashes: [],
  };
  return eligibleNodes({
    config: { nodes: [{ id: nodeId, capabilities: ['node', 'fleet-executor', 'command:node-version'], concurrencyLimit: 1 }] },
    snapshot: { nodes: [{ nodeId, fresh: true, heartbeat: hb }] },
    intent: { pinnedNodeId: nodeId, requiredCapabilities: ['fleet-executor', 'command:node-version'],
      estimatedScratchBytes: scratchGiB * GiB },
  }).map(node => node.id);
}

test('desktop around 223 GiB can route at 49.34 GiB without scratch', () => {
  assert.deepEqual(evictionReserves(223 * GiB), { startReserve: 30 * GiB, targetReserve: 80 * GiB });
  assert.deepEqual(candidates(49.34), ['desktop-primary']);
  assert.deepEqual(candidates(30), ['desktop-primary']);
  assert.deepEqual(candidates(29.99), []);
});

test('route eligibility continues to subtract per-task scratch and respect active jobs', () => {
  assert.deepEqual(candidates(49.34, { scratchGiB: 19 }), ['desktop-primary']);
  assert.deepEqual(candidates(49.34, { scratchGiB: 20 }), []);
  assert.deepEqual(candidates(49.34, { activeJobs: 1 }), []);
});

test('percentage reserve still dominates on large disks', () => {
  assert.deepEqual(evictionReserves(500 * GiB), { startReserve: 50 * GiB, targetReserve: 80 * GiB });
  assert.deepEqual(candidates(49, { totalGiB: 500 }), []);
  assert.deepEqual(candidates(50, { totalGiB: 500 }), ['desktop-primary']);
});

test('cache evacuation threshold drops to 30 GiB while recovery target stays 80 GiB', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-reserve-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = new CacheManager({
    cacheRoot: root,
    statfs: async () => ({ bsize: 1, bavail: 49 * GiB, blocks: 223 * GiB }),
  });
  const idle = await cache.evictFor(0);
  assert.deepEqual(idle.evicted, []);
  assert.equal(idle.freeBytes, 49 * GiB);
  await assert.rejects(() => cache.evictFor(20 * GiB), /INSUFFICIENT_LOCAL_CAPACITY/);
});

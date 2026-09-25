const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFleetConfig, normalizeHeartbeat, normalizeRouteIntent } = require('./src/fleet/contracts');

test('fleet config rejects duplicate node ids and secret-looking fields', () => {
  assert.throws(() => loadFleetConfig({ nodes: [
    { id: 'ec2-primary', capabilities: ['node'] },
    { id: 'ec2-primary', capabilities: ['git'] },
  ] }), /FLEET_NODE_DUPLICATE/);
  assert.throws(() => loadFleetConfig({
    nodes: [{ id: 'ec2-primary', capabilities: [], token: 'secret' }],
  }), /FLEET_SECRET_FIELD_FORBIDDEN/);
});

test('heartbeat and route intent are bounded and normalized', () => {
  const beat = normalizeHeartbeat({
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'EC2AMAZ-7IT0M73',
    freeDiskBytes: 120, totalDiskBytes: 500, freeMemoryBytes: 20, totalMemoryBytes: 64,
    cpuPercent: 11.5, activeJobs: 1, cacheBytes: 10, cachedObjectHashes: ['a'.repeat(64)],
  });
  assert.equal(beat.activeJobs, 1);
  const intent = normalizeRouteIntent({
    taskId: 't1', summary: 'run tests', requiredCapabilities: ['node', 'git'],
    artifactRefs: ['sha256:' + 'a'.repeat(64)], estimatedScratchBytes: 1024,
  });
  assert.deepEqual(intent.requiredCapabilities, ['git', 'node']);
});

test('heartbeat rejects invalid cpu and impossible resource totals', () => {
  assert.throws(() => normalizeHeartbeat({
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'bad',
    freeDiskBytes: 10, totalDiskBytes: 5, freeMemoryBytes: 1, totalMemoryBytes: 2,
    cpuPercent: 101, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [],
  }), /INVALID_(CPU_PERCENT|DISK_RANGE)/);
});

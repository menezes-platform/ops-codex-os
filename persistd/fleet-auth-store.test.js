const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { signNodeRequest, verifyNodeRequest } = require('./src/fleet/auth');
const { FileFleetStore, MemoryFleetStore } = require('./src/fleet/store');

test('node request signature is body, method, path, and time bound', () => {
  const body = JSON.stringify({ observedAt: '2026-09-24T17:00:00.000Z' });
  const timestamp = '2026-09-24T17:00:00.000Z';
  const requestPath = '/v1/fleet/nodes/ec2-primary/heartbeat';
  const secret = 'node-secret';
  const signature = signNodeRequest({
    nodeId: 'ec2-primary', secret, timestamp, method: 'POST', path: requestPath, body,
  });
  const base = {
    nodeId: 'ec2-primary', timestamp, signature, method: 'POST', path: requestPath,
    rawBody: body, secrets: { 'ec2-primary': secret }, nowMs: () => Date.parse(timestamp),
  };
  assert.equal(verifyNodeRequest(base), true);
  assert.equal(verifyNodeRequest({ ...base, rawBody: body + 'x' }), false);
  assert.equal(verifyNodeRequest({ ...base, path: '/v1/fleet/nodes/ec2-primary/drive-token' }), false);
});

test('node request rejects stale timestamps', () => {
  const timestamp = '2026-09-24T17:00:00.000Z';
  const body = '{}';
  const signature = signNodeRequest({
    nodeId: 'desktop-primary', secret: 's', timestamp, method: 'POST', path: '/hb', body,
  });
  assert.equal(verifyNodeRequest({
    nodeId: 'desktop-primary', timestamp, signature, method: 'POST', path: '/hb',
    rawBody: body, secrets: { 'desktop-primary': 's' },
    nowMs: () => Date.parse('2026-09-24T17:06:00.000Z'), maxSkewMs: 300000,
  }), false);
});

test('fleet store marks heartbeat stale after 90 seconds and sorts nodes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-'));
  const store = new FileFleetStore(dir);
  const heartbeat = {
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'EC2',
    freeDiskBytes: 100, totalDiskBytes: 200, freeMemoryBytes: 10, totalMemoryBytes: 20,
    cpuPercent: 10, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [],
    runtimeVersion: '1', capabilitiesHash: '',
  };
  store.putHeartbeat('ec2-primary', heartbeat);
  store.putHeartbeat('desktop-primary', { ...heartbeat, hostname: 'DESKTOP' });
  const state = store.snapshot({ nowMs: Date.parse('2026-09-24T17:01:31.000Z'), staleAfterMs: 90000 });
  assert.deepEqual(state.nodes.map((node) => node.nodeId), ['desktop-primary', 'ec2-primary']);
  assert.equal(state.nodes[0].fresh, false);
});

test('memory fleet store returns clones instead of mutable references', () => {
  const store = new MemoryFleetStore();
  store.putHeartbeat('a', {
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'A',
    freeDiskBytes: 1, totalDiskBytes: 2, freeMemoryBytes: 1, totalMemoryBytes: 2,
    cpuPercent: 1, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [],
    runtimeVersion: '', capabilitiesHash: '',
  });
  const one = store.snapshot({ nowMs: Date.parse('2026-09-24T17:00:01.000Z') });
  one.nodes[0].heartbeat.hostname = 'MUTATED';
  const two = store.snapshot({ nowMs: Date.parse('2026-09-24T17:00:01.000Z') });
  assert.equal(two.nodes[0].heartbeat.hostname, 'A');
});

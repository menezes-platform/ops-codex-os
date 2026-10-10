// Local, deterministic security checks. Synthetic credentials; no paid inference or remote calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../persistd/src/persistflow/http-server');
const { MemoryAuthorityStore } = require('../persistd/src/persistflow/authority-store');
const { MemoryFleetStore } = require('../persistd/src/fleet/store');
const { FleetRouter } = require('../persistd/src/fleet/router');
const { PersistFlowService } = require('../persistd/src/persistflow/service');
const { signNodeRequest, verifyNodeRequest } = require('../persistd/src/fleet/auth');
const { FleetAuthorityClient } = require('../persistd/src/fleet/executor-client');

const secrets = { desktop: 'synthetic-desktop-secret', other: 'synthetic-other-secret' };
const route = node => '/v1/fleet/nodes/' + node + '/executions/poll';
const input = { generation: 1, operationId: 'security-001', commandId: 'smoke',
  intent: { taskId: 'security', summary: 'Synthetic local check', pinnedNodeId: 'desktop' } };
async function fixture(t, enabled = true) {
  const store = new MemoryAuthorityStore();
  const fleetConfig = { nodes: ['desktop', 'other'].map(id => ({ id, capabilities: ['fleet-executor', 'command:smoke'], concurrencyLimit: 1 })) };
  const fleetStore = new MemoryFleetStore();
  for (const node of fleetConfig.nodes) fleetStore.putHeartbeat(node.id, {
    observedAt: new Date().toISOString(), hostname: 'synthetic', freeDiskBytes: 100 * 1024 ** 3,
    totalDiskBytes: 200 * 1024 ** 3, freeMemoryBytes: 1, totalMemoryBytes: 2,
    cpuPercent: 0, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [], runtimeVersion: 'test', capabilitiesHash: '',
  });
  // Pinning to one candidate means TypeSafe cannot be called, even if an API key exists elsewhere.
  const fleetRouter = new FleetRouter({ fleetConfig, fleetStore, typesafeRouter: { score() { throw new Error('UNEXPECTED_AI_CALL'); } } });
  const options = { store, fleetConfig, fleetStore, fleetRouter, fleetExecutorEnabled: enabled };
  const service = new PersistFlowService(options);
  service.startRun({ runId: 'security', generation: 1 });
  const server = createServer({ ...options, fleetNodeSecrets: secrets, mcpToken: 'synthetic-owner', mcpTokenDigest: '', driveAuth: null, sandboxProvider: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const post = (pathname, body, headers = {}) => fetch(origin + pathname, { method: 'POST', body,
    headers: { 'content-type': 'application/json', ...headers } });
  const signed = (pathname, body, node = 'desktop', timestamp = new Date().toISOString(), signedBody = body) => post(pathname, body, {
    'x-persistflow-node-id': node, 'x-persistflow-node-timestamp': timestamp,
    'x-persistflow-node-signature': signNodeRequest({ nodeId: node, secret: secrets[node], timestamp, method: 'POST', path: pathname, body: signedBody }),
  });
  return { store, service, post, signed, origin };
}

test('owner endpoint rejects missing/wrong bearer and a node secret; no queue mutation', async t => {
  const f = await fixture(t);
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer ' + secrets.desktop }]) {
    assert.equal((await f.post('/v1/runs/security/fleet/execute', JSON.stringify(input), headers)).status, 401);
  }
  assert.equal(f.store.get('security').fleetExecutions, undefined);
});

test('owner submission rejects caller args, enforces node pin and immutable operation', async t => {
  const f = await fixture(t), headers = { authorization: 'Bearer synthetic-owner' };
  assert.equal((await f.post('/v1/runs/security/fleet/execute', JSON.stringify({ ...input, args: ['evil'] }), headers)).status, 400);
  const response = await f.post('/v1/runs/security/fleet/execute', JSON.stringify(input), headers);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).operation.nodeId, 'desktop');
  assert.equal((await f.post('/v1/runs/security/fleet/execute', JSON.stringify({ ...input, commandId: 'changed' }), headers)).status, 409);
});

test('HMAC binds node, exact bytes, method and path and rejects both clock-window edges', () => {
  const timestamp = new Date().toISOString();
  const fields = { nodeId: 'desktop', timestamp, method: 'POST', path: route('desktop'), rawBody: '{}', secrets, maxSkewMs: 60_000 };
  const signature = signNodeRequest({ ...fields, secret: secrets.desktop, body: fields.rawBody });
  assert.equal(verifyNodeRequest({ ...fields, signature }), true);
  for (const changed of [{ nodeId: 'other' }, { method: 'GET' }, { path: route('other') }, { rawBody: '{} ' },
    { nowMs: () => Date.parse(timestamp) + 60_001 }, { nowMs: () => Date.parse(timestamp) - 60_001 }]) {
    assert.equal(verifyNodeRequest({ ...fields, signature, ...changed }), false);
  }
});

test('signed worker identity must match URL; owner bearer does not authorize poll', async t => {
  const f = await fixture(t);
  assert.equal((await f.signed(route('desktop'), '{}', 'other')).status, 401);
  assert.equal((await f.post(route('desktop'), '{}', { authorization: 'Bearer synthetic-owner' })).status, 401);
  assert.equal((await f.signed(route('desktop'), '{}', 'desktop', new Date(0).toISOString())).status, 401);
  assert.equal((await f.signed(route('desktop'), '{} ', 'desktop', new Date().toISOString(), '{}')).status, 401);
});

test('valid replay within window returns same assignment; another node cannot complete it', async t => {
  const f = await fixture(t);
  await f.service.executeFleetTask('security', input);
  const timestamp = new Date().toISOString();
  const first = await (await f.signed(route('desktop'), '{}', 'desktop', timestamp)).json();
  const replay = await (await f.signed(route('desktop'), '{}', 'desktop', timestamp)).json();
  assert.deepEqual(replay, first);
  assert.deepEqual(await (await f.signed(route('other'), '{}', 'other')).json(), { job: null });
  const report = { ...first.job, status: 'COMPLETED', exitCode: 0, outputTruncated: false };
  assert.equal((await f.signed('/v1/fleet/nodes/other/executions/report', JSON.stringify(report), 'other')).status, 409);
  assert.equal(f.store.get('security').fleetExecutions[input.operationId].status, 'RUNNING');
});

test('report repeats are idempotent and cannot change terminal status or persist output/secrets', async t => {
  const f = await fixture(t);
  await f.service.executeFleetTask('security', input);
  const job = f.service.pollFleetExecution('desktop').job;
  const report = { ...job, status: 'COMPLETED', exitCode: 0, outputTruncated: false };
  const pathname = '/v1/fleet/nodes/desktop/executions/report';
  assert.equal((await f.signed(pathname, JSON.stringify({ ...report, stdout: secrets.desktop }))).status, 400);
  assert.equal((await f.signed(pathname, JSON.stringify(report))).status, 200);
  const count = f.store.get('security').checkpoints.length;
  assert.equal((await (await f.signed(pathname, JSON.stringify(report))).json()).replayed, true);
  assert.equal(f.store.get('security').checkpoints.length, count);
  assert.equal((await f.signed(pathname, JSON.stringify({ ...report, status: 'FAILED', exitCode: 1 }))).status, 409);
  for (const secret of Object.values(secrets)) assert.ok(!JSON.stringify(f.store.list()).includes(secret));
});

test('disabled feature returns a signed 503, proving route presence independently of flag', async t => {
  const f = await fixture(t, false), pathname = route('desktop');
  assert.equal((await f.post(pathname, '{}')).status, 401);
  const response = await f.signed(pathname, '{}');
  assert.equal(response.status, 503);
  const rawBody = await response.text();
  assert.equal(JSON.parse(rawBody).error, 'FLEET_EXECUTION_DISABLED');
  assert.equal(verifyNodeRequest({ nodeId: 'desktop', timestamp: response.headers.get('x-persistflow-node-timestamp'),
    signature: response.headers.get('x-persistflow-node-signature'), method: 'RESPONSE-503', path: pathname, rawBody, secrets, maxSkewMs: 60_000 }), true);
});

test('client rejects stale/oversized signed responses and signatures reused for another HTTP status', async () => {
  const pathname = route('desktop');
  for (const scenario of ['stale', 'oversize', 'status']) {
    const body = scenario === 'oversize' ? 'x'.repeat(16 * 1024 + 1) : '{"job":null}';
    const timestamp = scenario === 'stale' ? new Date(0).toISOString() : new Date().toISOString();
    const client = new FleetAuthorityClient({ baseUrl: 'https://synthetic.invalid', nodeId: 'desktop', secret: secrets.desktop,
      fetchImpl: async () => new Response(body, { status: scenario === 'status' ? 503 : 200, headers: {
        'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': signNodeRequest({ nodeId: 'desktop', secret: secrets.desktop,
          timestamp, method: 'RESPONSE-200', path: pathname, body }),
      } }),
    });
    await assert.rejects(client.poll(), scenario === 'oversize' ? /AUTHORITY_RESPONSE_TOO_LARGE/ : /AUTHORITY_RESPONSE_UNAUTHENTICATED/);
  }
});

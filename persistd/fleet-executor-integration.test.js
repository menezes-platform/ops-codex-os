const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { MemoryAuthorityStore, FileAuthorityStore } = require('./src/persistflow/authority-store');
const { PersistFlowService } = require('./src/persistflow/service');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryFleetStore } = require('./src/fleet/store');
const { FleetRouter } = require('./src/fleet/router');
const { FleetExecutor } = require('./src/fleet/executor');
const { FleetAuthorityClient, pollAndExecute } = require('./src/fleet/executor-client');
const { signNodeRequest } = require('./src/fleet/auth');
const { productionFleetExecutorEnabled } = require('./src/start-entrypoint');

function fleet() {
  const fleetConfig = { nodes: [{ id: 'worker', capabilities: ['fleet-executor', 'command:smoke'], concurrencyLimit: 1 }] };
  const fleetStore = new MemoryFleetStore();
  fleetStore.putHeartbeat('worker', { observedAt: new Date().toISOString(), hostname: 'fixture',
    freeDiskBytes: 100 * 1024 ** 3, totalDiskBytes: 200 * 1024 ** 3, freeMemoryBytes: 1, totalMemoryBytes: 2,
    cpuPercent: 0, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [], runtimeVersion: 'test', capabilitiesHash: '' });
  return { fleetConfig, fleetStore, fleetRouter: new FleetRouter({ fleetConfig, fleetStore }) };
}
function fixture(extra = {}) {
  const service = new PersistFlowService({ store: new MemoryAuthorityStore(), fleetExecutorEnabled: true, ...fleet(), ...extra });
  service.startRun({ runId: 'r1', generation: 1 });
  return { service, input: { generation: 1, operationId: 'op1', commandId: 'smoke', intent: { taskId: 't1', summary: 'smoke test' } } };
}

test('queue submission is durable and idempotent, and changed input conflicts', async () => {
  const f = fixture();
  assert.equal((await f.service.executeFleetTask('r1', f.input)).operation.status, 'QUEUED');
  assert.equal((await f.service.executeFleetTask('r1', f.input)).replayed, true);
  await assert.rejects(f.service.executeFleetTask('r1', { ...f.input, commandId: 'different' }), /EXECUTION_ID_CONFLICT/);
  assert.equal(f.service.inspectRun('r1').checkpoints.length, 1);
});

test('disabled executor, stale generation and unsupported capability fail before enqueue', async () => {
  const f = fixture();
  await assert.rejects(f.service.executeFleetTask('r1', { ...f.input, generation: 2 }), /STALE_GENERATION/);
  await assert.rejects(f.service.executeFleetTask('r1', { ...f.input, commandId: 'unknown' }), /NO_ELIGIBLE_NODE/);
  f.service.fleetExecutorEnabled = false;
  await assert.rejects(f.service.executeFleetTask('r1', f.input), /FLEET_EXECUTION_DISABLED/);
});

test('concurrent submissions and generation change during routing cannot duplicate queue entries', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.executeFleetTask('r1', f.input), f.service.executeFleetTask('r1', f.input)]);
  assert.equal(results.filter(row => row.replayed).length, 1);
  assert.equal(Object.keys(f.service.inspectRun('r1').fleetExecutions).length, 1);
  const raced = fixture({ fleetRouter: { route: async () => {
    raced.service.store.update('r1', state => ({ ...state, generation: 2 })); return { nodeId: 'worker' };
  } } });
  await assert.rejects(raced.service.executeFleetTask('r1', raced.input), /STALE_GENERATION/);
});

test('poll delivers same assignment until acknowledged, receipt rejects wrong node and changed IDs', async () => {
  const f = fixture();
  await f.service.executeFleetTask('r1', f.input);
  const job = f.service.pollFleetExecution('worker').job;
  assert.deepEqual(f.service.pollFleetExecution('worker').job, job);
  assert.equal(f.service.pollFleetExecution('other').job, null);
  const report = { ...job, status: 'COMPLETED', exitCode: 0, outputTruncated: false };
  assert.throws(() => f.service.reportFleetExecution('other', report), /EXECUTION_ID_CONFLICT/);
  assert.throws(() => f.service.reportFleetExecution('worker', { ...report, requestId: 'wrong' }), /EXECUTION_ID_CONFLICT/);
  f.service.reportFleetExecution('worker', report);
  assert.equal(f.service.reportFleetExecution('worker', report).replayed, true);
  assert.equal(f.service.pollFleetExecution('worker').job, null);
});

test('old-generation queued jobs are not delivered; claimed completion retains original generation', async () => {
  const f = fixture();
  await f.service.executeFleetTask('r1', f.input);
  f.service.store.update('r1', state => ({ ...state, generation: 2 }));
  assert.equal(f.service.pollFleetExecution('worker').job, null);
  f.service.store.update('r1', state => ({ ...state, generation: 1 }));
  const job = f.service.pollFleetExecution('worker').job;
  f.service.store.update('r1', state => ({ ...state, generation: 2 }));
  f.service.reportFleetExecution('worker', { ...job, status: 'COMPLETED', exitCode: 0 });
  assert.equal(f.service.inspectRun('r1').latestCheckpoint.generation, 1);
});

test('production flag is off by default and needs no worker inbound endpoint', () => {
  assert.equal(productionFleetExecutorEnabled({}), false);
  assert.equal(productionFleetExecutorEnabled({ PERSISTFLOW_FLEET_EXECUTOR_ENABLED: '1' }), true);
});

test('uncertain recovery reports are idempotent and keep delivery pinned', async () => {
  const f = fixture();
  await f.service.executeFleetTask('r1', f.input);
  const job = f.service.pollFleetExecution('worker').job;
  const report = { ...job, status: 'RUNNING', exitCode: null, outputTruncated: false };
  f.service.reportFleetExecution('worker', report);
  const count = f.service.inspectRun('r1').checkpoints.length;
  assert.equal(f.service.reportFleetExecution('worker', report).replayed, true);
  assert.equal(f.service.inspectRun('r1').checkpoints.length, count);
  assert.deepEqual(f.service.pollFleetExecution('worker').job, job);
});

test('outbound MCP to Authority to real Windows process survives lost report and both restarts', async t => {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-e2e-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'executions.txt');
  const store = new FileAuthorityStore(path.join(root, 'authority'));
  const fixtureFleet = fleet();
  new PersistFlowService({ store }).startRun({ runId: 'e2e', generation: 1 });
  const authority = createServer({ store, ...fixtureFleet, fleetExecutorEnabled: true,
    fleetNodeSecrets: { worker: 'test-node-secret' }, mcpToken: 'test-owner', mcpTokenDigest: '', driveAuth: null });
  await new Promise(resolve => authority.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => authority.close(resolve)));
  const baseUrl = 'http://127.0.0.1:' + authority.address().port;
  const workerOptions = { nodeId: 'worker', secret: 'test-node-secret', receiptDir: path.join(root, 'receipts'),
    commands: { smoke: { executable: process.execPath, args: ['-e', 'require("node:fs").appendFileSync(' + JSON.stringify(marker) + ', "once\\n"); console.log("private-output")'], cwd: root, timeoutMs: 3000, maxOutputBytes: 1024 } },
    statfs: async () => ({ bsize: 1, bavail: 100 * 1024 ** 3, blocks: 200 * 1024 ** 3 }),
  };
  const worker = new FleetExecutor(workerOptions);
  const nodeClient = new FleetAuthorityClient({ baseUrl, nodeId: worker.nodeId, secret: worker.secret });
  const client = new Client({ name: 'fleet-executor-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer test-owner' } } }));
  t.after(() => client.close());
  const input = { runId: 'e2e', generation: 1, operationId: 'op-e2e', commandId: 'smoke', intent: { taskId: 'smoke', summary: 'real outbound process smoke' } };
  const queued = await client.callTool({ name: 'persist_fleet_execute', arguments: input });
  assert.ok(!queued.isError, JSON.stringify(queued));
  assert.equal(JSON.parse(queued.content[0].text).operation.status, 'QUEUED');
  const job = await nodeClient.poll();
  assert.equal((await worker.execute({ requestId: job.requestId, commandId: job.commandId })).status, 'COMPLETED');
  // Simulate losing the first report and restarting the worker. Receipt must prevent another spawn.
  const result = await pollAndExecute({ executor: new FleetExecutor(workerOptions), client: nodeClient });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'once\n');
  assert.equal(await nodeClient.poll(), null);
  const restarted = new PersistFlowService({ store: new FileAuthorityStore(store.directory), ...fixtureFleet, fleetExecutorEnabled: true });
  const { runId, ...body } = input;
  assert.equal((await restarted.executeFleetTask(runId, body)).operation.status, 'COMPLETED');
  assert.equal((await restarted.executeFleetTask(runId, body)).replayed, true);
  assert.ok(!JSON.stringify(store.list()).includes('private-output'));
  // No unsigned, wrong-node, stale or modified-body poll can read an assignment.
  const route = '/v1/fleet/nodes/worker/executions/poll';
  for (const [nodeId, timestamp, actualBody] of [
    ['other', new Date().toISOString(), '{}'], ['worker', new Date(0).toISOString(), '{}'], ['worker', new Date().toISOString(), '{} '],
  ]) {
    const signature = signNodeRequest({ nodeId, secret: worker.secret, timestamp, method: 'POST', path: route, body: '{}' });
    assert.equal((await fetch(baseUrl + route, { method: 'POST', headers: { 'x-persistflow-node-id': nodeId,
      'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': signature }, body: actualBody })).status, 401);
  }
  assert.equal((await fetch(baseUrl + route, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(baseUrl + '/v1/runs/e2e/fleet/execute', { method: 'POST', body: '{}' })).status, 401);
});

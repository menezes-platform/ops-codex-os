const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');
const { MemoryFleetStore } = require('./src/fleet/store');
const { loadFleetConfig } = require('./src/fleet/contracts');
const { signNodeRequest } = require('./src/fleet/auth');

async function withFleetServer(fn, overrides = {}) {
  const fleetStore = new MemoryFleetStore();
  const fleetConfig = loadFleetConfig({ nodes: [
    { id: 'ec2-primary', platform: 'win32', capabilities: ['node'], concurrencyLimit: 2 },
  ] });
  const server = createServer({
    store: new MemoryAuthorityStore(), fleetStore, fleetConfig,
    fleetNodeSecrets: { 'ec2-primary': 'fleet-secret' }, mcpToken: 'owner',
    clock: () => new Date('2026-09-24T17:00:10.000Z'),
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('authenticated fleet heartbeat becomes visible through read-only MCP status', async () => {
  await withFleetServer(async (base) => {
    const path = '/v1/fleet/nodes/ec2-primary/heartbeat';
    const timestamp = '2026-09-24T17:00:10.000Z';
    const body = JSON.stringify({
      observedAt: timestamp, hostname: 'EC2', freeDiskBytes: 100, totalDiskBytes: 200,
      freeMemoryBytes: 10, totalMemoryBytes: 20, cpuPercent: 10, activeJobs: 0,
      cacheBytes: 0, cachedObjectHashes: [], runtimeVersion: '1', capabilitiesHash: '',
    });
    const signature = signNodeRequest({
      nodeId: 'ec2-primary', secret: 'fleet-secret', timestamp, method: 'POST', path, body,
    });
    const response = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-persistflow-node-id': 'ec2-primary',
        'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': signature,
      },
      body,
    });
    assert.equal(response.status, 200);

    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'fleet-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer owner' } },
    });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.ok(listed.tools.some((tool) => tool.name === 'persist_fleet_status'));
      const result = await client.callTool({ name: 'persist_fleet_status', arguments: {} });
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.fleet.nodes[0].nodeId, 'ec2-primary');
      assert.equal(payload.fleet.nodes[0].fresh, true);
    } finally { await client.close(); }
  });
});

test('fleet heartbeat rejects bad signatures and unknown nodes', async () => {
  await withFleetServer(async (base) => {
    const timestamp = '2026-09-24T17:00:10.000Z';
    const body = '{}';
    let response = await fetch(base + '/v1/fleet/nodes/ec2-primary/heartbeat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-persistflow-node-id': 'ec2-primary',
        'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': '0'.repeat(64),
      },
      body,
    });
    assert.equal(response.status, 401);

    const unknownPath = '/v1/fleet/nodes/ghost/heartbeat';
    const sig = signNodeRequest({
      nodeId: 'ghost', secret: 'ghost-secret', timestamp, method: 'POST', path: unknownPath, body,
    });
    response = await fetch(base + unknownPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-persistflow-node-id': 'ghost',
        'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': sig,
      },
      body,
    });
    assert.equal(response.status, 401);
  });
});

test('production fleet helpers load registry and keep node secrets in env only', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createProductionFleetStore, loadProductionFleetConfig, productionFleetNodeSecrets } = require('./src/persistflow/http-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-fleet-prod-'));
  const configPath = path.join(dir, 'fleet.json');
  fs.writeFileSync(configPath, JSON.stringify({ nodes: [{ id: 'n1', capabilities: [] }] }), 'utf8');
  const config = loadProductionFleetConfig({ configPath });
  assert.equal(config.nodes[0].id, 'n1');
  const store = createProductionFleetStore({ env: { PERSISTFLOW_DATA_DIR: dir } });
  assert.equal(store.kind, 'file');
  assert.deepEqual(productionFleetNodeSecrets({
    env: { PERSISTFLOW_FLEET_NODE_SECRETS_JSON: JSON.stringify({ n1: 'secret' }) },
  }), { n1: 'secret' });
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('registered node can obtain short-lived Drive access without refresh credentials', async () => {
  const driveAuth = {
    async getAccess() {
      return {
        accessToken: 'short-lived',
        expiresAt: '2026-09-24T18:00:00.000Z',
        scope: 'https://www.googleapis.com/auth/drive.file',
        rootId: 'root-1',
      };
    },
  };
  await withFleetServer(async (base) => {
    const requestPath = '/v1/fleet/nodes/ec2-primary/drive-token';
    const timestamp = '2026-09-24T17:00:10.000Z';
    const body = '{}';
    const signature = signNodeRequest({
      nodeId: 'ec2-primary', secret: 'fleet-secret', timestamp,
      method: 'POST', path: requestPath, body,
    });
    const response = await fetch(base + requestPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-persistflow-node-id': 'ec2-primary',
        'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': signature,
      },
      body,
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.accessToken, 'short-lived');
    assert.equal(JSON.stringify(payload).includes('refresh'), false);
  }, { driveAuth });
});

test('Drive access endpoint reports unavailable auth as 503 without deleting or exposing state', async () => {
  await withFleetServer(async (base) => {
    const requestPath = '/v1/fleet/nodes/ec2-primary/drive-token';
    const timestamp = '2026-09-24T17:00:10.000Z';
    const body = '{}';
    const signature = signNodeRequest({
      nodeId: 'ec2-primary', secret: 'fleet-secret', timestamp,
      method: 'POST', path: requestPath, body,
    });
    const response = await fetch(base + requestPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-persistflow-node-id': 'ec2-primary',
        'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': signature,
      },
      body,
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'drive_auth_unavailable' });
  }, { driveAuth: null });
});

test('routeTask records one atomic fleet.route checkpoint and latestRoute', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  const service = new PersistFlowService({
    store,
    clock: () => new Date('2026-09-24T17:02:00.000Z'),
    fleetRouter: {
      route: async (intent) => ({
        taskId: intent.taskId,
        nodeId: 'ec2-primary',
        decisionSource: 'provider-gateway',
        eligibleNodeIds: ['desktop-primary', 'ec2-primary'],
        semanticScores: { 'desktop-primary': 1, 'ec2-primary': 2 },
        providerRouteId: 'fleet-semantic-v1',
        providerUsage: { input_tokens: 42, output_tokens: 8 },
        evaluatedAt: '2026-09-24T17:02:00.000Z',
      }),
    },
  });
  service.startRun({ runId: 'route-run', generation: 1, goal: 'route task' });
  const result = await service.routeTask('route-run', {
    generation: 1,
    intent: {
      taskId: 'task-123', summary: 'run tests',
      requiredCapabilities: [], preferredCapabilities: [],
      estimatedScratchBytes: 0, artifactRefs: [],
    },
  });
  assert.equal(result.run.latestRoute.nodeId, 'ec2-primary');
  assert.equal(result.run.latestCheckpoint.evidence.type, 'fleet.route');
  assert.equal(result.run.latestCheckpoint.evidence.taskId, 'task-123');
  assert.equal(result.run.latestCheckpoint.evidence.providerRouteId, 'fleet-semantic-v1');
  assert.deepEqual(result.run.latestCheckpoint.evidence.providerUsage, { input_tokens: 42, output_tokens: 8 });
  assert.equal(result.decision.nodeId, 'ec2-primary');
});

test('ephemeral execution persists provider and operation identity before remote acquire', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  const observed = [];
  const provider = {
    acquire: async ({ workerId }) => {
      const run = store.get('ephemeral-run');
      observed.push({ status: run.ephemeralOperations['op-1'].status, provider: run.ephemeralOperations['op-1'].provider, workerId });
      return { id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' };
    },
    exec: async (_worker, command) => ({ exitCode: 0, stdout: 'REMOTE_OK:' + command, stderr: '' }),
    release: async () => {},
    describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const service = new PersistFlowService({
    store,
    ephemeralEnabled: true,
    ephemeralProvider: provider,
    fleetRouter: { route: async (intent) => ({
      taskId: intent.taskId, nodeId: 'railway-anonymous', decisionSource: 'single-candidate-fallback',
      eligibleNodeIds: ['railway-anonymous'], candidates: [{ id: 'railway-anonymous', provider: 'railway-anonymous' }],
      evaluatedAt: '2026-09-28T02:00:00.000Z', routingEvidence: { candidates: [{ id: 'railway-anonymous', provider: 'railway-anonymous' }] },
    }) },
  });
  service.startRun({ runId: 'ephemeral-run', generation: 1, goal: 'run bounded remote work' });
  const result = await service.executeEphemeralTask('ephemeral-run', {
    generation: 1, operationId: 'op-1', command: 'printf REMOTE_OK',
    intent: { taskId: 'task-1', summary: 'run stateless test', requiredCapabilities: ['remote-worker'] },
  });
  assert.deepEqual(observed, [{ status: 'ACQUIRING', provider: 'railway-anonymous', workerId: 'ephemeral-run-op-1-g1' }]);
  assert.match(result.result.stdout, /REMOTE_OK/);
  const run = service.inspectRun('ephemeral-run');
  assert.equal(run.ephemeralOperations['op-1'].status, 'COMPLETED');
  assert.equal(run.ephemeralOperations['op-1'].workerGeneration, 1);
  assert.equal(run.latestRoute.nodeId, 'railway-anonymous');
  assert.ok(run.checkpoints.some((checkpoint) => checkpoint.evidence?.type === 'ephemeral.worker.completed'));
});

test('ephemeral operation idempotency survives service restart and client retry', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const { FileAuthorityStore } = require('./src/persistflow/authority-store');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-ephemeral-idempotency-'));
  const store = new FileAuthorityStore(dir);
  let executions = 0;
  const router = { route: async (intent) => ({
    taskId: intent.taskId, nodeId: 'railway-anonymous', decisionSource: 'single-candidate-fallback',
    eligibleNodeIds: ['railway-anonymous'], evaluatedAt: '2026-09-28T02:00:00.000Z',
  }) };
  const provider = {
    acquire: async ({ workerId }) => ({ id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' }),
    exec: async () => { executions += 1; return { exitCode: 0, stdout: 'OK', stderr: '' }; },
    release: async () => {}, describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const args = { generation: 1, operationId: 'op-retry', command: 'true', intent: { taskId: 'task-retry', summary: 'run tests' } };
  const first = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider, fleetRouter: router });
  first.startRun({ runId: 'restart-run', generation: 1, goal: 'idempotency' });
  await first.executeEphemeralTask('restart-run', args);
  const restarted = new PersistFlowService({ store: new FileAuthorityStore(dir), ephemeralEnabled: true, ephemeralProvider: provider, fleetRouter: router });
  const retry = await restarted.executeEphemeralTask('restart-run', args);
  assert.equal(executions, 1);
  assert.equal(retry.operation.status, 'COMPLETED');
  await assert.rejects(
    () => restarted.executeEphemeralTask('restart-run', { ...args, command: 'false' }),
    { message: 'OPERATION_ID_CONFLICT' },
  );
  assert.equal(executions, 1);
});

test('PersistFlow restart inspects an already acquired operation without launching a duplicate worker', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const { FileAuthorityStore } = require('./src/persistflow/authority-store');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-ephemeral-restart-active-'));
  const store = new FileAuthorityStore(dir);
  let releaseExec;
  let acquires = 0;
  const provider = {
    acquire: async ({ workerId }) => { acquires += 1; return { id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' }; },
    exec: async () => new Promise((resolve) => { releaseExec = () => resolve({ exitCode: 0, stdout: 'OK', stderr: '' }); }),
    release: async () => {}, describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const router = { route: async (intent) => ({ taskId: intent.taskId, nodeId: 'railway-anonymous', provider: 'railway-anonymous', eligibleNodeIds: ['railway-anonymous'], evaluatedAt: new Date().toISOString() }) };
  const args = { generation: 1, operationId: 'active-op', command: 'long-command', intent: { taskId: 'active-task', summary: 'long job' } };
  const first = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider, fleetRouter: router });
  first.startRun({ runId: 'active-restart-run', generation: 1, goal: 'recover without replay' });
  const inFlight = first.executeEphemeralTask('active-restart-run', args);
  while (!releaseExec) await new Promise((resolve) => setImmediate(resolve));
  const restarted = new PersistFlowService({ store: new FileAuthorityStore(dir), ephemeralEnabled: true, ephemeralProvider: provider, fleetRouter: router });
  const inspected = await restarted.executeEphemeralTask('active-restart-run', args);
  assert.equal(inspected.operation.status, 'RUNNING');
  assert.equal(acquires, 1);
  releaseExec();
  await inFlight;
});

test('ephemeral execution is default-off and keeps local-only hard constraints ahead of routing', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  const service = new PersistFlowService({ store, fleetRouter: { route: async () => { throw new Error('must not route'); } } });
  service.startRun({ runId: 'off-run', generation: 1, goal: 'off' });
  await assert.rejects(() => service.executeEphemeralTask('off-run', {
    generation: 1, operationId: 'op-off', command: 'true', intent: { taskId: 'off', summary: 'run' },
  }), /EPHEMERAL_EXECUTION_DISABLED/);
  assert.equal(service.inspectRun('off-run').ephemeralOperations, undefined);
});

test('client disconnect does not cancel a durable operation and retry joins the same in-flight execution', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  let finish;
  let executions = 0;
  const provider = {
    acquire: async ({ workerId }) => ({ id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' }),
    exec: async () => { executions += 1; return new Promise((resolve) => { finish = () => resolve({ exitCode: 0, stdout: 'DONE', stderr: '' }); }); },
    release: async () => {}, describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const service = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider,
    fleetRouter: { route: async (intent) => ({ taskId: intent.taskId, nodeId: 'railway-anonymous', provider: 'railway-anonymous', decisionSource: 'only', eligibleNodeIds: ['railway-anonymous'], evaluatedAt: new Date().toISOString() }) } });
  service.startRun({ runId: 'disconnect-run', generation: 1, goal: 'disconnect resilience' });
  const input = { generation: 1, operationId: 'disconnect-op', command: 'long-task', intent: { taskId: 'disconnect-task', summary: 'long stateless test' } };
  const original = service.executeEphemeralTask('disconnect-run', input);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  const retry = service.executeEphemeralTask('disconnect-run', input);
  assert.equal(executions, 1);
  finish();
  const [firstResult, retryResult] = await Promise.all([original, retry]);
  assert.equal(firstResult.operation.status, 'COMPLETED');
  assert.equal(retryResult.operation.status, 'COMPLETED');
  assert.equal(executions, 1);
});

test('ephemeral logs and durable checkpoints omit private keys, bearer values, cookies and claim URLs', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----secret-material-----END OPENSSH PRIVATE KEY-----';
  const bearer = 'Bearer abcdefghijklmnopqrstuvwxyz123456';
  const claimUrl = 'https://railway.com/ssh-signup?code=one-time-claim';
  const cookie = 'session=private-cookie-value';
  const provider = {
    acquire: async ({ workerId }) => ({ id: workerId, provider: 'railway-anonymous', keyPath: privateKey, claimUrl, buildExpiresAt: '2026-09-28T03:00:00.000Z' }),
    exec: async () => ({ exitCode: 0, stdout: [privateKey, bearer, claimUrl, cookie].join('\n'), stderr: '' }),
    release: async () => {}, describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const service = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider,
    fleetRouter: { route: async (intent) => ({ taskId: intent.taskId, nodeId: 'railway-anonymous', provider: 'railway-anonymous', decisionSource: 'only', eligibleNodeIds: ['railway-anonymous'], evaluatedAt: new Date().toISOString() }) } });
  service.startRun({ runId: 'secret-run', generation: 1, goal: 'secret scrub regression' });
  await service.executeEphemeralTask('secret-run', { generation: 1, operationId: 'secret-op', command: 'true', intent: { taskId: 'secret-task', summary: 'run a safe test' } });
  const persisted = JSON.stringify(service.inspectRun('secret-run'));
  for (const value of [privateKey, bearer, claimUrl, cookie]) assert.equal(persisted.includes(value), false);
});

test('when Railway is quota-ineligible, routing records the existing node fallback without acquiring Railway', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  let acquisitions = 0;
  const provider = { acquire: async () => { acquisitions += 1; throw new Error('should not acquire'); }, exec: async () => {}, release: async () => {}, describe: () => ({}), remaining: () => 0 };
  const service = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider,
    fleetRouter: { route: async (intent) => ({ taskId: intent.taskId, nodeId: 'ec2-primary', provider: 'fleet-node', decisionSource: 'deterministic-fallback', eligibleNodeIds: ['ec2-primary'], routingEvidence: { candidates: [{ id: 'ec2-primary', provider: 'fleet-node' }], ineligible: [{ id: 'railway-anonymous', reasons: ['daily_quota_exhausted'] }], selectedProvider: 'fleet-node', fallbackReason: 'daily_quota_exhausted' }, evaluatedAt: new Date().toISOString() }) } });
  service.startRun({ runId: 'fallback-run', generation: 1, goal: 'quota fallback' });
  const result = await service.executeEphemeralTask('fallback-run', { generation: 1, operationId: 'fallback-op', command: 'true', intent: { taskId: 'fallback-task', summary: 'run tests' } });
  assert.equal(result.operation.status, 'ROUTED_TO_EXISTING_PROVIDER');
  assert.equal(result.operation.provider, 'fleet-node');
  assert.equal(acquisitions, 0);
});

test('PersistFlow checkpoints and resumes a cooperative G1 to G2 handoff before releasing G1', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  const actions = [];
  let generation = 0;
  const checkpoint = { step: 2, nextSafeAction: 'continue the bounded task' };
  const encoded = Buffer.from(JSON.stringify(checkpoint)).toString('base64');
  const provider = {
    acquire: async ({ workerId }) => {
      generation += 1;
      actions.push('acquire:g' + generation);
      return { id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' };
    },
    exec: async (worker, command) => {
      if (command === 'true') { actions.push('ready:' + worker.id); return { exitCode: 0, stdout: '', stderr: '' }; }
      if (worker.id.endsWith('-g1')) {
        actions.push('work:g1');
        return { exitCode: 0, stdout: 'PARTIAL\nPERSISTFLOW_HANDOFF_BASE64=' + encoded, stderr: '' };
      }
      assert.match(command, /^PERSISTFLOW_RESUME_BASE64=/);
      assert.equal(Buffer.from(command.match(/^PERSISTFLOW_RESUME_BASE64=([^ ]+)/)[1], 'base64').toString('utf8'), JSON.stringify(checkpoint));
      actions.push('resume:g2');
      return { exitCode: 0, stdout: 'DONE', stderr: '' };
    },
    release: async (worker) => actions.push('release:' + worker.id),
    describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const service = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider,
    fleetRouter: { route: async (intent) => ({ taskId: intent.taskId, nodeId: 'railway-anonymous', provider: 'railway-anonymous', decisionSource: 'only', eligibleNodeIds: ['railway-anonymous'], evaluatedAt: new Date().toISOString() }) } });
  service.startRun({ runId: 'handoff-run', generation: 1, goal: 'resumable remote work' });
  const result = await service.executeEphemeralTask('handoff-run', {
    generation: 1, operationId: 'handoff-op', command: 'run-cooperative-task',
    intent: { taskId: 'handoff-task', summary: 'run a checkpointable CLI task' },
  });
  assert.deepEqual(actions, [
    'acquire:g1', 'work:g1', 'acquire:g2', 'ready:handoff-run-handoff-op-g2',
    'release:handoff-run-handoff-op-g1', 'resume:g2', 'release:handoff-run-handoff-op-g2',
  ]);
  const run = service.inspectRun('handoff-run');
  const events = run.ephemeralOperations['handoff-op'].events.map((event) => event.type);
  assert.ok(events.includes('ephemeral.worker.successor_ready'));
  assert.ok(events.includes('ephemeral.worker.handoff'));
  assert.ok(events.includes('ephemeral.worker.completed'));
  assert.equal(run.ephemeralOperations['handoff-op'].workerGeneration, 2);
  assert.equal(result.result.stdout, 'DONE');
  assert.ok(run.checkpoints.some((item) => item.evidence?.resume?.step === 2));
});

test('successor acquisition failure keeps G1 and the exact checkpoint inspectable without retrying', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  let acquisitions = 0;
  let releases = 0;
  const resume = { step: 8, nextSafeAction: 'continue safely' };
  const provider = {
    acquire: async ({ workerId }) => {
      acquisitions += 1;
      if (acquisitions === 2) throw new Error('RAILWAY_ANON_CAPACITY_UNAVAILABLE');
      return { id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' };
    },
    exec: async () => ({ exitCode: 0, stdout: 'PERSISTFLOW_HANDOFF_BASE64=' + Buffer.from(JSON.stringify(resume)).toString('base64'), stderr: '' }),
    release: async () => { releases += 1; },
    describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  const service = new PersistFlowService({ store, ephemeralEnabled: true, ephemeralProvider: provider,
    fleetRouter: { route: async (intent) => ({ taskId: intent.taskId, nodeId: 'railway-anonymous', provider: 'railway-anonymous', eligibleNodeIds: ['railway-anonymous'], evaluatedAt: new Date().toISOString() }) } });
  service.startRun({ runId: 'successor-fail-run', generation: 1, goal: 'retain G1' });
  await assert.rejects(() => service.executeEphemeralTask('successor-fail-run', {
    generation: 1, operationId: 'successor-fail-op', command: 'checkpointable-work',
    intent: { taskId: 'successor-fail-task', summary: 'work with safe checkpoint' },
  }), /RAILWAY_ANON_CAPACITY_UNAVAILABLE/);
  const run = service.inspectRun('successor-fail-run');
  assert.equal(run.ephemeralOperations['successor-fail-op'].status, 'HANDOFF_BLOCKED');
  assert.equal(acquisitions, 2);
  assert.equal(releases, 0);
  assert.ok(run.checkpoints.some((item) => item.evidence?.resume?.step === 8));
});

test('persist_fleet_route MCP tool exposes durable route decision', async () => {
  const fakeRouter = {
    route: async (intent) => ({
      taskId: intent.taskId, nodeId: 'ec2-primary',
      decisionSource: 'deterministic-fallback',
      eligibleNodeIds: ['ec2-primary'], semanticScores: null,
      evaluatedAt: '2026-09-24T17:02:00.000Z',
    }),
  };
  await withFleetServer(async (base) => {
    let response = await fetch(base + '/v1/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'mcp-route', generation: 1 }),
    });
    assert.equal(response.status, 201);

    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'route-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer owner' } },
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'persist_fleet_route',
        arguments: {
          runId: 'mcp-route', generation: 1,
          intent: { taskId: 'task-1', summary: 'route me' },
        },
      });
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.decision.nodeId, 'ec2-primary');
      assert.equal(payload.run.latestRoute.nodeId, 'ec2-primary');
    } finally { await client.close(); }
  }, { fleetRouter: fakeRouter });
});

test('PersistFlow MCP executes Railway selected work through its durable service method', async () => {
  const { route } = { route: async (intent) => ({
    taskId: intent.taskId, nodeId: 'railway-anonymous', provider: 'railway-anonymous',
    decisionSource: 'single-candidate-fallback', eligibleNodeIds: ['railway-anonymous'],
    routingEvidence: { candidates: [{ id: 'railway-anonymous', provider: 'railway-anonymous', eligible: true }], selectedProvider: 'railway-anonymous' },
    evaluatedAt: '2026-09-28T02:00:00.000Z',
  }) };
  const provider = {
    acquire: async ({ workerId }) => ({ id: workerId, provider: 'railway-anonymous', buildExpiresAt: '2026-09-28T03:00:00.000Z' }),
    exec: async () => ({ exitCode: 0, stdout: 'REMOTE_MCP_OK', stderr: '' }),
    release: async () => {}, describe: (worker) => ({ id: worker.id, provider: worker.provider, buildExpiresAt: worker.buildExpiresAt }),
  };
  await withFleetServer(async (base) => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'ephemeral-mcp-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer owner' } } }));
    try {
      await client.callTool({ name: 'persist_run_start', arguments: { runId: 'mcp-ephemeral-run', goal: 'remote smoke through MCP' } });
      const result = await client.callTool({ name: 'persist_fleet_execute_ephemeral', arguments: {
        runId: 'mcp-ephemeral-run', generation: 1, operationId: 'mcp-operation', command: 'printf REMOTE_MCP_OK',
        intent: { taskId: 'mcp-task', summary: 'run one bounded remote command', requiredCapabilities: ['remote-worker'] },
      } });
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.operation.status, 'COMPLETED');
      assert.equal(payload.operation.provider, 'railway-anonymous');
      assert.equal(payload.result.stdout, 'REMOTE_MCP_OK');
      assert.ok(payload.run.checkpoints.some((item) => item.evidence?.type === 'ephemeral.worker.completed'));
    } finally { await client.close(); }
  }, {
    fleetRouter: { route },
    ephemeralEnabled: true,
    ephemeralProvider: provider,
  });
});

test('routeTask rechecks generation after async scheduling before persisting route', async () => {
  const { PersistFlowService } = require('./src/persistflow/service');
  const store = new MemoryAuthorityStore();
  let service;
  service = new PersistFlowService({
    store,
    fleetRouter: {
      route: async (intent) => {
        store.update('route-race', (state) => ({ ...state, generation: 2 }));
        return {
          taskId: intent.taskId, nodeId: 'ec2-primary',
          decisionSource: 'provider-gateway', eligibleNodeIds: ['ec2-primary'],
          semanticScores: { 'ec2-primary': 2 }, evaluatedAt: new Date().toISOString(),
        };
      },
    },
  });
  service.startRun({ runId: 'route-race', generation: 1 });
  await assert.rejects(() => service.routeTask('route-race', {
    generation: 1,
    intent: { taskId: 'race', summary: 'race check' },
  }), /STALE_GENERATION/);
  assert.equal(service.inspectRun('route-race').latestRoute, undefined);
});

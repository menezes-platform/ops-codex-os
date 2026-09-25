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
        decisionSource: 'typesafe',
        eligibleNodeIds: ['desktop-primary', 'ec2-primary'],
        typesafeScores: { 'desktop-primary': 1, 'ec2-primary': 2 },
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
  assert.equal(result.decision.nodeId, 'ec2-primary');
});

test('persist_fleet_route MCP tool exposes durable route decision', async () => {
  const fakeRouter = {
    route: async (intent) => ({
      taskId: intent.taskId, nodeId: 'ec2-primary',
      decisionSource: 'deterministic-fallback',
      eligibleNodeIds: ['ec2-primary'], typesafeScores: null,
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
          decisionSource: 'typesafe', eligibleNodeIds: ['ec2-primary'],
          typesafeScores: { 'ec2-primary': 2 }, evaluatedAt: new Date().toISOString(),
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

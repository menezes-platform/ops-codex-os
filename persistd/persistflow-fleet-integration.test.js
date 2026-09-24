const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');
const { MemoryFleetStore } = require('./src/fleet/store');
const { loadFleetConfig } = require('./src/fleet/contracts');
const { signNodeRequest } = require('./src/fleet/auth');

async function withFleetServer(fn) {
  const fleetStore = new MemoryFleetStore();
  const fleetConfig = loadFleetConfig({ nodes: [
    { id: 'ec2-primary', platform: 'win32', capabilities: ['node'], concurrencyLimit: 2 },
  ] });
  const server = createServer({
    store: new MemoryAuthorityStore(), fleetStore, fleetConfig,
    fleetNodeSecrets: { 'ec2-primary': 'fleet-secret' }, mcpToken: 'owner',
    clock: () => new Date('2026-09-24T17:00:10.000Z'),
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

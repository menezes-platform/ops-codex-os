const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');

async function withServer(fn) {
  const server = createServer({
    store: new MemoryAuthorityStore(),
    mcpToken: 'owner-token',
    mcpTokenDigest: '',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('bridge sync requires owner bearer and advances exactly one generation', async () => {
  await withServer(async (base) => {
    let response = await fetch(`${base}/v1/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'bridge-run',
        generation: 2,
        goal: 'continue',
        latestRoute: { taskId: 'task-1', nodeId: 'ec2-primary', decisionSource: 'typesafe' },
      }),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${base}/v1/runs/bridge-run/bridge/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedGeneration: 2, generation: 3 }),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${base}/v1/runs/bridge-run/bridge/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner-token' },
      body: JSON.stringify({
        expectedGeneration: 2,
        generation: 3,
        progress: 'g3 alive',
        nextSafeAction: 'continue g3',
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.run.generation, 3);
    assert.equal(payload.run.status, 'ACTIVE');
    assert.equal(payload.run.progress, 'g3 alive');
    assert.equal(payload.run.nextSafeAction, 'continue g3');
    assert.equal(payload.run.latestRoute.nodeId, 'ec2-primary');

    response = await fetch(`${base}/v1/runs/bridge-run/bridge/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner-token' },
      body: JSON.stringify({ expectedGeneration: 2, generation: 3 }),
    });
    assert.equal(response.status, 409);
  });
});

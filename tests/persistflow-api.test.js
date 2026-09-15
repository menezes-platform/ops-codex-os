const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { MemoryAuthorityStore, digestClaimSecret } = require('../persistd/src/persistflow/authority-store');

async function withServer(store, fn) {
  const server = createServer({ store, clock: () => new Date('2026-09-15T20:00:00Z') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
test('creates and inspects a run through the semantic API', async () => {
  const store = new MemoryAuthorityStore();
  await withServer(store, async (base) => {
    const created = await post(base, '/v1/runs', { runId: 'run-api', generation: 1, status: 'ACTIVE' });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.run.runId, 'run-api');
    assert.equal(createdBody.run.generation, 1);

    const inspected = await fetch(`${base}/v1/runs/run-api`);
    assert.equal(inspected.status, 200);
    assert.equal((await inspected.json()).run.runId, 'run-api');
  });
});

test('heartbeat and checkpoint are fenced by the current generation', async () => {
  const store = new MemoryAuthorityStore();
  await withServer(store, async (base) => {
    await post(base, '/v1/runs', { runId: 'run-fence', generation: 2, status: 'ACTIVE' });
    const heartbeat = await post(base, '/v1/runs/run-fence/heartbeat', { generation: 2, progress: { task: 8 } });
    assert.equal(heartbeat.status, 200);
    const heartbeatRun = (await heartbeat.json()).run;
    assert.equal(heartbeatRun.controllerHeartbeatAt, '2026-09-15T20:00:00.000Z');
    assert.deepEqual(heartbeatRun.progress, { task: 8 });

    const stale = await post(base, '/v1/runs/run-fence/checkpoints', { generation: 1, nextSafeAction: { type: 'noop' } });
    assert.equal(stale.status, 409);
    const checkpoint = await post(base, '/v1/runs/run-fence/checkpoints', {
      generation: 2, nextSafeAction: { type: 'verify', task: 8 }, evidence: { tests: 'green' },
    });
    assert.equal(checkpoint.status, 200);
    const checkpointRun = (await checkpoint.json()).run;
    assert.equal(checkpointRun.checkpoints.length, 1);
    assert.deepEqual(checkpointRun.nextSafeAction, { type: 'verify', task: 8 });
  });
});

test('claim endpoint CAS-promotes only the prepared successor secret', async () => {
  const store = new MemoryAuthorityStore();
  await withServer(store, async (base) => {
    await post(base, '/v1/runs', {
      runId: 'run-claim', generation: 3, status: 'ACTIVE',
      successor: { generation: 4, chatId: 'chat-4', claimNonceDigest: digestClaimSecret('secret-4') },
    });
    const wrong = await post(base, '/v1/runs/run-claim/claim', {
      expectedGeneration: 3, generation: 4, claimSecret: 'wrong',
    });
    assert.equal(wrong.status, 409);

    const claimed = await post(base, '/v1/runs/run-claim/claim', {
      expectedGeneration: 3, generation: 4, claimSecret: 'secret-4',
    });
    assert.equal(claimed.status, 200);
    const run = (await claimed.json()).run;
    assert.equal(run.generation, 4);
    assert.equal(run.successor, null);
  });
});

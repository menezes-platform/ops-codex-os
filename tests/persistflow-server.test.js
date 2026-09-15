const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { createServer, createProductionStore } = require('../server');

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('serves PersistFlow identity and health JSON', async () => {
  await withServer(async (base) => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.deepEqual(await root.json(), { service: 'persistflow', status: 'ok' });
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'persistflow', authority: 'memory', durable: false });
  });
});

test('returns a JSON 404 for unknown routes', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/missing`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /^application\/json/);
    assert.deepEqual(await response.json(), { error: 'not_found' });
  });
});


test('production store resolves outside the deployment tree by default', () => {
  const fakeHome = path.join(os.tmpdir(), 'persistflow-home');
  const store = createProductionStore({ env: {}, homedir: fakeHome });
  assert.equal(store.kind, 'file');
  assert.equal(store.directory, path.join(fakeHome, '.persistflow-data'));
});

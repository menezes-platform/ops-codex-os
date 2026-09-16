const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRemoteAuthorityClient } = require('./src/persistflow/remote-authority');

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('remote authority client inspects one durable run', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/v1/runs/remote-run');
    assert.equal(req.headers.authorization, 'Bearer owner-token');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ run: { runId: 'remote-run', generation: 2, status: 'ACTIVE' } }));
  }, async (baseUrl) => {
    const client = createRemoteAuthorityClient({ baseUrl, token: 'owner-token' });
    const run = await client.inspectRun('remote-run');
    assert.equal(run.runId, 'remote-run');
    assert.equal(run.generation, 2);
  });
});
test('remote authority client advances generation through bridge sync', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/v1/runs/remote-run/bridge/sync');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer owner-token');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      expectedGeneration: 2,
      generation: 3,
      progress: 'rolled over',
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ run: { runId: 'remote-run', generation: 3, status: 'ACTIVE' } }));
  }, async (baseUrl) => {
    const client = createRemoteAuthorityClient({ baseUrl, token: 'owner-token' });
    const run = await client.syncGeneration('remote-run', {
      expectedGeneration: 2,
      generation: 3,
      progress: 'rolled over',
    });
    assert.equal(run.generation, 3);
  });
});
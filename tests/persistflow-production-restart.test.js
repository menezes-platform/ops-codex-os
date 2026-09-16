const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function start(dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: '0', PERSISTFLOW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    const match = /persistflow listening on (\d+)/.exec(output);
    if (match) return { child, base: `http://127.0.0.1:${match[1]}` };
  }
  throw new Error('SERVER_DID_NOT_START');
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}
test('production server survives a process restart with the same data directory', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-prod-'));
  const first = await start(dataDir);
  try {
    const create = await fetch(`${first.base}/v1/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'restart-run', generation: 1, status: 'ACTIVE' }),
    });
    assert.equal(create.status, 201);
  } finally { await stop(first.child); }

  const second = await start(dataDir);
  try {
    const health = await fetch(`${second.base}/healthz`);
    assert.deepEqual(await health.json(), { ok: true, service: 'persistflow', authority: 'file', durable: true });
    const inspect = await fetch(`${second.base}/v1/runs/restart-run`);
    assert.equal(inspect.status, 200);
    const body = await inspect.json();
    assert.equal(body.run.runId, 'restart-run');
    assert.equal(body.run.generation, 1);
  } finally { await stop(second.child); }
});

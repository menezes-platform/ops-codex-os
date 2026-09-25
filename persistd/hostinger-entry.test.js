const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

async function waitForHealth(child, port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return null;
    try { return await requestHealth(port); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test('Hostinger entry starts listening when loaded with require()', async () => {
  const port = 38125;
  const cwd = path.join(__dirname);
  const child = spawn(process.execPath, ['-e', "require('./src/hostinger-entry.js')"], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const result = await waitForHealth(child, port);
    assert.ok(result, `entry did not listen within readiness deadline; stderr=${stderr}`);
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).service, 'persistflow');
  } finally {
    child.kill();
  }
});


test('Hostinger entry works from an isolated persistd deployment root', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-hostinger-'));
  const isolated = path.join(tempRoot, 'persistd');
  fs.cpSync(__dirname, isolated, { recursive: true });
  // Hostinger installs runtime dependencies in the deployed application root.
  // Mirror that contract in the isolated-root test instead of relying on the
  // source repository's parent-directory module resolution.
  fs.cpSync(path.join(__dirname, '..', 'node_modules'), path.join(isolated, 'node_modules'), { recursive: true });
  const port = 38126;
  const child = spawn(process.execPath, ['-e', "require('./src/hostinger-entry.js')"], {
    cwd: isolated,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const result = await waitForHealth(child, port);
    assert.ok(result, `isolated entry did not listen within readiness deadline; stderr=${stderr}`);
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).service, 'persistflow');
  } finally {
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
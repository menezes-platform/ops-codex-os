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
    let result;
    for (let i = 0; i < 20; i += 1) {
      if (child.exitCode !== null) break;
      try { result = await requestHealth(port); break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(result, `entry did not listen; stderr=${stderr}`);
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).service, 'persistflow');
  } finally {
    child.kill();
  }
});

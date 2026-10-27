const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function freePort() {
  const server = http.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(child, base) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Root process exited before ready');
    try {
      const response = await fetch(base + '/healthz');
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Root process readiness timeout');
}

test('Hostinger root entry supports HMAC-signed MARTHA heartbeat and durable state', async () => {
  const port = await freePort();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-root-smoke-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(port), PERSISTFLOW_DATA_DIR: temp,
      PERSISTFLOW_FLEET_NODE_SECRET_CONTHABIL_MARTHA: secret,
      PERSISTFLOW_FLEET_ROUTER_ENABLED: '0',
    },
    stdio: 'ignore',
  });
  const base = 'http://127.0.0.1:' + port;
  try {
    const health = await waitForHealth(child, base);
    assert.equal(health.authority, 'file');
    assert.equal(health.durable, true);
    const endpoint = '/v1/fleet/nodes/conthabil-martha/heartbeat';
    const heartbeat = JSON.stringify({
      observedAt: new Date().toISOString(), hostname: 'MARTHA',
      freeDiskBytes: 80e9, totalDiskBytes: 150e9,
      freeMemoryBytes: 4e9, totalMemoryBytes: 8e9,
      cpuPercent: 7, activeJobs: 0, cacheBytes: 0,
      cachedObjectHashes: [], runtimeVersion: 'test', capabilitiesHash: 'abc',
    });
    const timestamp = new Date().toISOString();
    const signature = crypto.createHmac('sha256', secret)
      .update(['conthabil-martha', timestamp, 'POST', endpoint, heartbeat].join('\n'))
      .digest('hex');
    const response = await fetch(base + endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-persistflow-node-id': 'conthabil-martha',
        'x-persistflow-node-timestamp': timestamp,
        'x-persistflow-node-signature': signature,
      },
      body: heartbeat,
    });
    assert.equal(response.status, 200);
  } finally {
    child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

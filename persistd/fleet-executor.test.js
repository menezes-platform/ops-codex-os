const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FleetExecutor } = require('./src/fleet/executor');
const { FleetAuthorityClient } = require('./src/fleet/executor-client');
const { signNodeRequest } = require('./src/fleet/auth');

const capacity = async () => ({ bsize: 1, bavail: 100 * 1024 ** 3, blocks: 200 * 1024 ** 3 });
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-exec-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    nodeId: 'worker', secret: 'fixture-node-secret', receiptDir: path.join(root, 'receipts'),
    commands: {
      smoke: { executable: process.execPath, args: ['-e', 'console.log("smoke-ok"); console.log(process.env.PERSISTFLOW_FLEET_NODE_SECRET || "no-secret")'], cwd: root, timeoutMs: 2000, maxOutputBytes: 2048 },
      timeout: { executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: root, timeoutMs: 100, maxOutputBytes: 1024 },
      noisy: { executable: process.execPath, args: ['-e', 'console.log("x".repeat(10000))'], cwd: root, timeoutMs: 2000, maxOutputBytes: 128 },
    }, statfs: capacity, ...overrides,
  };
  return { root, options, executor: new FleetExecutor(options) };
}
test('fixed command executes without inherited Fleet secrets', async t => {
  const f = fixture(t);
  const result = await f.executor.execute({ requestId: 'one', commandId: 'smoke' });
  assert.equal(result.status, 'COMPLETED');
  assert.match(result.stdout, /smoke-ok/);
  assert.match(result.stdout, /no-secret/);
});

test('unknown commands and caller-supplied args/env/cwd are rejected', async t => {
  const f = fixture(t);
  await assert.rejects(f.executor.execute({ requestId: 'x', commandId: 'shell' }), /COMMAND_NOT_ALLOWED/);
  for (const extra of [{ args: ['-e', 'evil'] }, { env: { X: 'evil' } }, { cwd: '/' }, { command: 'evil' }]) {
    await assert.rejects(f.executor.execute({ requestId: 'x', commandId: 'smoke', ...extra }), /INVALID_EXECUTION_REQUEST/);
  }
});

test('duplicate IDs remain deduplicated after restart; changed command conflicts', async t => {
  const f = fixture(t);
  const first = await f.executor.execute({ requestId: 'dedup', commandId: 'smoke' });
  assert.equal(first.status, 'COMPLETED');
  const restarted = new FleetExecutor(f.options);
  const replay = await restarted.execute({ requestId: 'dedup', commandId: 'smoke' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.stdout, undefined);
  await assert.rejects(restarted.execute({ requestId: 'dedup', commandId: 'timeout' }), /EXECUTION_ID_CONFLICT/);
  const receipts = fs.readdirSync(f.options.receiptDir).map(name => fs.readFileSync(path.join(f.options.receiptDir, name), 'utf8')).join('');
  assert.ok(!receipts.includes('smoke-ok'));
  assert.ok(!receipts.includes(f.options.secret));
});

test('concurrent requests and second executor process cannot claim same ID twice', async t => {
  const f = fixture(t);
  const second = new FleetExecutor(f.options);
  const results = await Promise.all([f.executor.execute({ requestId: 'race', commandId: 'timeout' }), second.execute({ requestId: 'race', commandId: 'timeout' })]);
  assert.equal(results.filter(row => !row.replayed).length, 1);
  assert.equal(results.filter(row => row.replayed).length, 1);
});

test('timeout terminates command, output is bounded, active job is released', async t => {
  const f = fixture(t);
  assert.equal((await f.executor.execute({ requestId: 'timeout', commandId: 'timeout' })).status, 'TIMED_OUT');
  const result = await f.executor.execute({ requestId: 'noisy', commandId: 'noisy' });
  assert.ok(Buffer.byteLength(result.stdout) <= 128);
  assert.equal(result.outputTruncated, true);
  assert.equal(f.executor.activeJobs, 0);
});

test('worker independently enforces disk reserve and concurrency', async t => {
  const low = fixture(t, { statfs: async () => ({ bsize: 1, bavail: 1, blocks: 200 * 1024 ** 3 }) });
  await assert.rejects(low.executor.execute({ requestId: 'low', commandId: 'smoke' }), /INSUFFICIENT_LOCAL_CAPACITY/);
  const f = fixture(t);
  const first = f.executor.execute({ requestId: 'busy', commandId: 'timeout' });
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(f.executor.execute({ requestId: 'second', commandId: 'smoke' }), /EXECUTOR_BUSY/);
  await first;
});

test('outbound client rejects plain remote HTTP, redirects and unsigned responses', async () => {
  assert.throws(() => new FleetAuthorityClient({ baseUrl: 'http://example.com', nodeId: 'worker', secret: 's' }), /AUTHORITY_HTTPS_REQUIRED/);
  for (const status of [200, 302]) {
    const client = new FleetAuthorityClient({ baseUrl: 'https://example.com', nodeId: 'worker', secret: 's', fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error'); return new Response('{}', { status });
    } });
    await assert.rejects(client.poll(), /AUTHORITY_RESPONSE_UNAUTHENTICATED/);
  }
});

test('RUNNING receipt survives restart without running an uncertain command again', async t => {
  const f = fixture(t);
  const crypto = require('node:crypto');
  fs.mkdirSync(f.options.receiptDir);
  const target = path.join(f.options.receiptDir, crypto.createHash('sha256').update('crash').digest('hex') + '.json');
  fs.writeFileSync(target, JSON.stringify({ requestId: 'crash', commandId: 'smoke', nodeId: 'worker', status: 'RUNNING' }));
  const receipt = await f.executor.execute({ requestId: 'crash', commandId: 'smoke' });
  assert.equal(receipt.status, 'RUNNING');
  assert.equal(receipt.replayed, true);
  assert.equal(receipt.stdout, undefined);
  const restarted = new FleetExecutor(f.options);
  await assert.rejects(restarted.execute({ requestId: 'new', commandId: 'smoke' }), /EXECUTOR_BUSY/);
});

test('outbound client rejects a tampered signed assignment', async () => {
  const timestamp = new Date().toISOString(), body = '{"job":null}';
  const signature = signNodeRequest({ nodeId: 'worker', secret: 's', timestamp, method: 'RESPONSE-200', path: '/v1/fleet/nodes/worker/executions/poll', body });
  const client = new FleetAuthorityClient({ baseUrl: 'https://example.com', nodeId: 'worker', secret: 's', fetchImpl: async () =>
    new Response(body + ' ', { status: 200, headers: { 'x-persistflow-node-timestamp': timestamp, 'x-persistflow-node-signature': signature } }) });
  await assert.rejects(client.poll(), /AUTHORITY_RESPONSE_UNAUTHENTICATED/);
});

test('worker startup is opt-in, opens no listener, and rollback leaves heartbeat mode', async t => {
  const { startConfiguredExecutor } = require('./src/fleet/node-agent');
  assert.equal(await startConfiguredExecutor({ env: {} }), null);
  assert.equal(await startConfiguredExecutor({ env: { PERSISTFLOW_FLEET_EXECUTOR_ENABLED: '0' } }), null);
  const f = fixture(t);
  const config = path.join(f.root, 'executor.json');
  fs.writeFileSync(config, JSON.stringify({ commands: f.options.commands, receiptDir: f.options.receiptDir }));
  const running = await startConfiguredExecutor({ env: {
    PERSISTFLOW_FLEET_EXECUTOR_ENABLED: '1', PERSISTFLOW_FLEET_EXECUTOR_CONFIG: config,
    PERSISTFLOW_BASE_URL: 'https://authority.example', PERSISTFLOW_FLEET_NODE_ID: 'worker', PERSISTFLOW_FLEET_NODE_SECRET: f.options.secret,
  } });
  assert.equal(running.server, undefined);
  assert.equal(running.client.baseUrl, 'https://authority.example');
  assert.equal(running.executor.activeJobs, 0);
});

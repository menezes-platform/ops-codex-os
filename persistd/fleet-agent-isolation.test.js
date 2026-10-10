const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAgent, startConfiguredExecutor } = require('./src/fleet/node-agent');

for (const scenario of ['invalid-json', 'inaccessible-file', 'missing-executable', 'corrupt-receipt', 'missing-config']) {
  test('executor startup ' + scenario + ' stays disabled while three heartbeats continue', { timeout: 4000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-isolation-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const configPath = path.join(root, 'config.json'), receipts = path.join(root, 'receipts');
    const config = { receiptDir: receipts, commands: { smoke: {
      executable: scenario === 'missing-executable' ? path.join(root, 'absent.exe') : process.execPath,
      args: ['--version'], cwd: root, timeoutMs: 1000, maxOutputBytes: 1024,
    } } };
    fs.writeFileSync(configPath, scenario === 'invalid-json' ? '{private-SYNTHETIC-SECRET' : JSON.stringify(config));
    if (scenario === 'corrupt-receipt') {
      fs.mkdirSync(receipts);
      fs.writeFileSync(path.join(receipts, 'a'.repeat(64) + '.json'), '{private-SYNTHETIC-SECRET');
    }
    const env = { PERSISTFLOW_FLEET_EXECUTOR_ENABLED: '1', PERSISTFLOW_FLEET_EXECUTOR_CONFIG: configPath,
      PERSISTFLOW_BASE_URL: 'https://synthetic.invalid', PERSISTFLOW_FLEET_NODE_ID: 'desktop-primary',
      PERSISTFLOW_FLEET_NODE_SECRET: 'SYNTHETIC-SECRET' };
    if (scenario === 'missing-config') delete env.PERSISTFLOW_FLEET_EXECUTOR_CONFIG;
    const controller = new AbortController();
    let starts = 0, beats = 0;
    const logs = [];
    await runAgent({ env, signal: controller.signal, intervalMs: 1,
      startExecutor: options => {
        starts++;
        return startConfiguredExecutor({ ...options, ...(scenario === 'inaccessible-file' ? { readFile: () => {
          throw Object.assign(new Error('SYNTHETIC-SECRET private path'), { code: 'EACCES' });
        } } : {}) });
      },
      collect: async options => {
        assert.equal(options.activeJobs, undefined, 'partially constructed executor must not be used');
        return { syntheticHeartbeat: true };
      },
      post: async ({ heartbeat }) => {
        assert.equal(heartbeat.syntheticHeartbeat, true);
        if (++beats === 3) controller.abort();
      },
      logError: code => logs.push(code),
    });
    assert.equal(beats, 3);
    assert.equal(starts, 1, 'no uncontrolled retry/restart');
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^EXECUTOR_[A-Z_]+$/);
    assert.ok(!logs.join('').includes('SYNTHETIC-SECRET'));
    assert.ok(!logs.join('').includes(root));
  });
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { FleetExecutor, killTree } = require('./src/fleet/executor');
function fakeChild() {
  const child = new EventEmitter(); child.pid = 123456;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.unref = () => {}; child.kill = () => true;
  return child;
}
function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-timeout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { nodeId: 'worker', secret: 'synthetic', receiptDir: path.join(root, 'receipts'),
    commands: { smoke: { executable: process.execPath, args: ['--version'], cwd: root, timeoutMs: 50, maxOutputBytes: 1024 } },
    statfs: async () => ({ bsize: 1, bavail: 100 * 1024 ** 3, blocks: 200 * 1024 ** 3 }), supervisionMs: 40, ...extra };
  return { root, options, executor: new FleetExecutor(options) };
}
for (const scenario of ['no-exit', 'pipes-open', 'kill-failure', 'kill-start-failure']) {
  test('timeout ' + scenario + ' is bounded, observable, uncertain and keeps capacity', { timeout: 4000 }, async t => {
    const child = fakeChild(); let spawned = 0;
    const f = fixture(t, { spawnImpl: () => { spawned++; return child; }, terminate: async () => {
      if (scenario === 'kill-start-failure') throw new Error('SYNTHETIC-PRIVATE-ERROR');
      if (scenario === 'pipes-open') child.emit('exit', 0, null);
      if (scenario === 'kill-failure') setImmediate(() => { child.emit('exit', 1, null); child.emit('close', 1, null); });
      return { code: scenario === 'kill-failure' ? 'TREE_KILL_FAILED' : 'TREE_KILL_CONFIRMED' };
    } });
    const result = await f.executor.execute({ requestId: 'op', commandId: 'smoke' });
    assert.equal(result.status, 'RUNNING');
    assert.match(result.terminationCode, /^(PROCESS_TERMINATION_UNCONFIRMED|PIPES_STILL_OPEN|TREE_KILL_FAILED|TREE_KILL_START_FAILED)$/);
    assert.equal(result.finishedAt, undefined);
    assert.equal(f.executor.activeJobs, 1);
    await assert.rejects(f.executor.execute({ requestId: 'new', commandId: 'smoke' }), /EXECUTOR_BUSY/);
    assert.equal((await f.executor.execute({ requestId: 'op', commandId: 'smoke' })).replayed, true);
    assert.equal(new FleetExecutor(f.options).activeJobs, 1);
    assert.equal(spawned, 1);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PRIVATE-ERROR'));
  });
}

test('Windows taskkill nonzero/start error/helper hang produce fixed outcomes', { timeout: 4000 }, async () => {
  assert.equal(typeof killTree, 'function');
  for (const scenario of ['nonzero', 'start-error', 'hang']) {
    const killer = new EventEmitter(); killer.kill = () => true; killer.unref = () => {};
    const outcome = await killTree({ pid: 123456, kill: () => true }, { platform: 'win32', waitMs: 25,
      spawnImpl: (_file, args) => {
        assert.deepEqual(args, ['/PID', '123456', '/T', '/F']);
        if (scenario === 'start-error') setImmediate(() => killer.emit('error', new Error('private details')));
        if (scenario === 'nonzero') setImmediate(() => killer.emit('close', 1));
        return killer;
      } });
    assert.equal(outcome.code, scenario === 'nonzero' ? 'TREE_KILL_FAILED' : scenario === 'start-error' ? 'TREE_KILL_START_FAILED' : 'TREE_KILL_UNCONFIRMED');
  }
});

test('Windows real taskkill closes a process tree including a descendant holding pipes', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const f = fixture(t, { supervisionMs: 5000 });
  f.executor.commands.get('smoke').timeoutMs = 1500;
  f.executor.commands.get('smoke').args = ['-e',
    'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log(c.pid);setInterval(()=>{},1000)'];
  const result = await f.executor.execute({ requestId: 'windows-tree', commandId: 'smoke' });
  assert.equal(result.status, 'TIMED_OUT');
  assert.equal(result.terminationCode, 'TREE_KILL_CONFIRMED');
  const descendant = Number(result.stdout.trim());
  assert.ok(Number.isInteger(descendant) && descendant > 0, 'descendant must actually have started');
  assert.throws(() => process.kill(descendant, 0), error => error.code === 'ESRCH');
  assert.equal(f.executor.activeJobs, 0);
});

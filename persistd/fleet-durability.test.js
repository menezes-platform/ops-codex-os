const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { FileAuthorityStore } = require('./src/persistflow/authority-store');
const { FleetExecutor } = require('./src/fleet/executor');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-durable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function faultIO(method, shouldFail) {
  return { ...fs, [method]: (...args) => {
    if (shouldFail(...args)) throw Object.assign(new Error('injected private details'), { code: 'EIO' });
    return fs[method](...args);
  } };
}
function workerOptions(root, extra = {}) {
  return { nodeId: 'fixture', secret: 'synthetic-only', receiptDir: path.join(root, 'receipts'),
    commands: { smoke: { executable: process.execPath, args: ['--version'], cwd: root, timeoutMs: 1000, maxOutputBytes: 1024 } },
    statfs: async () => ({ bsize: 1, bavail: 100 * 1024 ** 3, blocks: 200 * 1024 ** 3 }), ...extra };
}

test('Authority file sync failure prevents successful update and preserves previous queue', t => {
  const root = fixture(t), store = new FileAuthorityStore(root);
  store.create({ runId: 'r', generation: 1, fleetExecutions: { op: { status: 'QUEUED' } } });
  const broken = new FileAuthorityStore(root, { io: faultIO('fsyncSync', () => true) });
  assert.throws(() => broken.update('r', state => ({ ...state, generation: 2 })), /injected/);
  assert.equal(new FileAuthorityStore(root).get('r').generation, 1);
  assert.equal(store.get('r').fleetExecutions.op.status, 'QUEUED');
});

test('Authority rename failure leaves old state readable; orphan temp is excluded from queue enumeration', t => {
  const root = fixture(t), store = new FileAuthorityStore(root);
  store.create({ runId: 'r', generation: 1 });
  const broken = new FileAuthorityStore(root, { io: faultIO('renameSync', () => true) });
  assert.throws(() => broken.update('r', state => ({ ...state, generation: 2 })), /injected/);
  assert.equal(store.get('r').generation, 1);
  assert.equal(store.list().length, 1);
});

test('file and parent sync surround replace; post-rename sync failure has uncertain commit, never false success', t => {
  const root = fixture(t), events = [];
  const io = { ...fs, fsyncSync: fd => { events.push(fs.fstatSync(fd).isDirectory() ? 'directory' : 'file'); fs.fsyncSync(fd); },
    renameSync: (...args) => { events.push('rename'); fs.renameSync(...args); } };
  // Inject successful directory sync for Windows, whose native directory fsync is unsupported.
  io.fsyncSync = fd => { const directory = fs.fstatSync(fd).isDirectory(); events.push(directory ? 'directory' : 'file'); if (!directory) fs.fsyncSync(fd); };
  io.openSync = (name, flags, mode) => flags === 'r' && name === root && process.platform === 'win32'
    ? fs.openSync(path.join(root, 'directory-fd-fixture'), 'a+') : fs.openSync(name, flags, mode);
  const store = new FileAuthorityStore(root, { io });
  store.create({ runId: 'r', generation: 1 });
  assert.ok(events.indexOf('file') >= 0);
  assert.ok(events.indexOf('rename') > events.indexOf('file'));
  assert.ok(events.length > events.indexOf('rename') + 1, 'directory durability must be attempted after rename');
  const broken = new FileAuthorityStore(root, { io: faultIO('openSync', (_name, flags) => flags === 'r') });
  assert.throws(() => broken.update('r', state => ({ ...state, generation: 2 })), /injected/);
});

test('failed initial receipt sync never spawns and keeps capacity conservatively blocked', async t => {
  const root = fixture(t), options = workerOptions(root, { io: faultIO('fsyncSync', fd => !fs.fstatSync(fd).isDirectory()) });
  const executor = new FleetExecutor(options);
  let launches = 0; executor.run = async () => { launches++; return { status: 'COMPLETED', exitCode: 0 }; };
  await assert.rejects(executor.execute({ requestId: 'op', commandId: 'smoke' }), /injected/);
  assert.equal(launches, 0);
  assert.equal(executor.activeJobs, 1);
  await assert.rejects(new FleetExecutor(workerOptions(root)).execute({ requestId: 'different', commandId: 'smoke' }), /EXECUTOR_BUSY/);
});

test('terminal replacement failure retains RUNNING receipt after restart and does not relaunch', async t => {
  const root = fixture(t), options = workerOptions(root, { io: faultIO('renameSync', () => true) });
  const executor = new FleetExecutor(options);
  let launches = 0; executor.run = async () => { launches++; return { status: 'COMPLETED', exitCode: 0 }; };
  await assert.rejects(executor.execute({ requestId: 'op', commandId: 'smoke' }), /injected/);
  const restarted = new FleetExecutor(workerOptions(root));
  const receipt = await restarted.execute({ requestId: 'op', commandId: 'smoke' });
  assert.equal(receipt.status, 'RUNNING'); assert.equal(receipt.replayed, true);
  assert.equal(launches, 1); assert.equal(restarted.activeJobs, 1);
});

test('separate executor instances sharing receipts cannot run different IDs concurrently', async t => {
  const root = fixture(t), options = workerOptions(root);
  const first = new FleetExecutor(options), second = new FleetExecutor(options);
  let finish, launched;
  const ready = new Promise(resolve => { launched = resolve; });
  first.run = () => { launched(); return new Promise(resolve => { finish = resolve; }); };
  const running = first.execute({ requestId: 'one', commandId: 'smoke' });
  await ready;
  try { await assert.rejects(second.execute({ requestId: 'two', commandId: 'smoke' }), /EXECUTOR_BUSY/); }
  finally { finish({ status: 'COMPLETED', exitCode: 0 }); await running; }
});

test('unsupported Windows directory fsync is explicit; actual I/O failures are not swallowed', t => {
  const { syncDirectory } = require('./src/durable-file');
  const root = fixture(t);
  const denied = faultIO('openSync', () => true);
  denied.openSync = () => { throw Object.assign(new Error('unsupported'), { code: 'EPERM' }); };
  assert.equal(syncDirectory(root, { io: denied, platform: 'win32' }), false);
  assert.throws(() => syncDirectory(root, { io: faultIO('openSync', () => true), platform: 'win32' }), /injected/);
});

test('real worker processes sharing receipts fence different IDs with only one command launch', { timeout: 10000 }, async t => {
  const { spawn } = require('node:child_process');
  const root = fixture(t), marker = path.join(root, 'launches.txt');
  const options = workerOptions(root);
  delete options.statfs;
  options.commands.smoke.args = ['-e', 'require("node:fs").appendFileSync(' + JSON.stringify(marker) + ',"launch\\n");setTimeout(()=>{},1500)'];
  options.commands.smoke.timeoutMs = 5000;
  const modulePath = require.resolve('./src/fleet/executor');
  function launch(id) {
    const code = 'const {FleetExecutor}=require(' + JSON.stringify(modulePath) + ');' +
      'const worker=new FleetExecutor({...'+ JSON.stringify(options) +',statfs:async()=>({bsize:1,bavail:100*1024**3,blocks:200*1024**3})});' +
      'const run=worker.run.bind(worker);worker.run=c=>{console.log("READY");return run(c)};' +
      'worker.execute({requestId:'+JSON.stringify(id)+',commandId:"smoke"}).then(r=>console.log(r.status)).catch(e=>console.log(e.message));';
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = ''; const waiters = [];
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.includes('READY')) waiters.splice(0).forEach(resolve => resolve()); });
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', () => resolve(stdout)); });
    return { done, ready: () => stdout.includes('READY') ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)) };
  }
  const first = launch('first'); await first.ready();
  assert.match(await launch('second').done, /EXECUTOR_BUSY/);
  assert.match(await first.done, /COMPLETED/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'launch\n');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  RailwayAnonymousProvider,
  RailwayAnonymousQuotaStore,
  parseRailwayManifest,
  stripRailwayManifest,
} = require('./src/fleet/railway-anonymous');

function manifest(overrides = {}) {
  return {
    status: 'trial_ready',
    state: 'running',
    preview_url: 'https://preview-test.up.railway.app',
    human_claim_url: 'https://railway.com/ssh-signup?code=secret',
    build_expires_at: '2026-09-27T05:00:00.000Z',
    usage: { run: 'ssh railway.new COMMAND_HERE' },
    ...overrides,
  };
}

test('parseRailwayManifest accepts structured agent output from stdout or stderr', () => {
  const json = JSON.stringify(manifest());
  for (const [stdout, stderr] of [[json + '\n', ''], ['', json + '\n']]) {
    const parsed = parseRailwayManifest(stdout, stderr);
    assert.equal(parsed.status, 'trial_ready');
    assert.equal(parsed.previewUrl, 'https://preview-test.up.railway.app');
    assert.equal(parsed.buildExpiresAt, '2026-09-27T05:00:00.000Z');
  }
});

test('stripRailwayManifest removes Railway metadata without dropping command output', () => {
  const json = JSON.stringify(manifest());
  assert.equal(stripRailwayManifest(json + '\nREMOTE_OK\n'), 'REMOTE_OK');
});

test('quota store resets by UTC day and records successful uses only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'railway-quota-'));
  let now = new Date('2026-09-27T01:00:00.000Z');
  const store = new RailwayAnonymousQuotaStore(path.join(root, 'quota.json'), {
    clock: () => now,
  });
  assert.equal(store.remaining(3), 3);
  store.recordUse();
  store.recordUse();
  assert.equal(store.remaining(3), 1);
  now = new Date('2026-09-28T01:00:00.000Z');
  assert.equal(store.remaining(3), 3);
});

test('provider creates a fresh SSH identity, reads manifest, and enforces local daily budget', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'railway-provider-'));
  const calls = [];
  const quota = new RailwayAnonymousQuotaStore(path.join(root, 'quota.json'), {
    clock: () => new Date('2026-09-27T04:00:00.000Z'),
  });
  const fakeRun = async (file, args) => {
    calls.push({ file, args });
    if (file === 'ssh-keygen') {
      const keyPath = args[args.indexOf('-f') + 1];
      fs.writeFileSync(keyPath, 'private', { mode: 0o600 });
      fs.writeFileSync(keyPath + '.pub', 'public');
      return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false };
    }
    return {
      code: 0, signal: null, stdout: JSON.stringify(manifest()) + '\n', stderr: '', timedOut: false,
    };
  };
  const provider = new RailwayAnonymousProvider({
    keyRoot: path.join(root, 'keys'),
    quotaStore: quota,
    dailyLimit: 1,
    clock: () => new Date('2026-09-27T04:00:00.000Z'),
    runProcessImpl: fakeRun,
  });

  const worker = await provider.acquire({ workerId: 'job-1' });
  assert.equal(worker.id, 'job-1');
  assert.equal(worker.previewUrl, 'https://preview-test.up.railway.app');
  assert.ok(calls.some((call) => call.file === 'ssh-keygen'));
  assert.ok(calls.some((call) => call.file === 'ssh' && call.args.includes('railway.new')));
  await assert.rejects(() => provider.acquire({ workerId: 'job-2' }), /DAILY_BUDGET_EXHAUSTED/);
  await provider.release(worker);
  assert.equal(fs.existsSync(worker.keyPath), false);
});

test('provider exposes quota remaining without acquiring anonymous capacity', () => {
  const provider = new RailwayAnonymousProvider({
    dailyLimit: 3,
    quotaStore: { remaining: (limit) => limit - 2 },
  });
  assert.equal(provider.remaining(), 1);
});

test('concurrent acquisitions serialize quota checks so one remaining box cannot become two', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'railway-provider-concurrency-'));
  let used = 0;
  let sshCalls = 0;
  const provider = new RailwayAnonymousProvider({
    keyRoot: path.join(root, 'keys'),
    dailyLimit: 1,
    clock: () => new Date('2026-09-28T02:00:00.000Z'),
    quotaStore: { remaining: (limit) => Math.max(0, limit - used), recordUse: () => ({ used: ++used }) },
    runProcessImpl: async (file, args) => {
      if (file === 'ssh-keygen') {
        const keyPath = args[args.indexOf('-f') + 1];
        fs.writeFileSync(keyPath, 'private', { mode: 0o600 });
        fs.writeFileSync(keyPath + '.pub', 'public');
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      }
      sshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { code: 0, stdout: JSON.stringify(manifest({ build_expires_at: '2026-09-28T03:00:00.000Z' })) + '\n', stderr: '', timedOut: false };
    },
  });
  const results = await Promise.allSettled([
    provider.acquire({ workerId: 'parallel-1' }),
    provider.acquire({ workerId: 'parallel-2' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(sshCalls, 1);
});

test('provider removes generated key material when SSH connection setup rejects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'railway-provider-connect-failure-'));
  const provider = new RailwayAnonymousProvider({
    keyRoot: path.join(root, 'keys'),
    clock: () => new Date('2026-09-28T02:00:00.000Z'),
    quotaStore: { remaining: () => 3, recordUse: () => { throw new Error('not reached'); } },
    runProcessImpl: async (file, args) => {
      if (file === 'ssh-keygen') {
        const keyPath = args[args.indexOf('-f') + 1];
        fs.writeFileSync(keyPath, 'private', { mode: 0o600 });
        fs.writeFileSync(keyPath + '.pub', 'public');
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      }
      throw Object.assign(new Error('network detail must not be persisted'), { code: 'ECONNRESET' });
    },
  });
  await assert.rejects(() => provider.acquire({ workerId: 'connect-failure' }), /RAILWAY_ANON_CONNECT_FAILED:ECONNRESET/);
  assert.equal(fs.existsSync(path.join(root, 'keys', 'connect-failure')), false);
  assert.equal(fs.existsSync(path.join(root, 'keys', 'connect-failure.pub')), false);
});

test('provider exec reuses worker key and strips the repeated manifest', async () => {
  const calls = [];
  const fakeRun = async (file, args, options) => {
    calls.push({ file, args, options });
    return {
      code: 0,
      signal: null,
      stdout: 'REMOTE_OK\n',
      stderr: JSON.stringify(manifest()) + '\n',
      timedOut: false,
    };
  };
  const provider = new RailwayAnonymousProvider({
    quotaStore: { remaining: () => 3, recordUse: () => ({ used: 1 }) },
    clock: () => new Date('2026-09-27T04:00:00.000Z'),
    execGuardMs: 60_000,
    runProcessImpl: fakeRun,
  });
  const result = await provider.exec({
    id: 'w1',
    keyPath: '/tmp/key',
    buildExpiresAt: '2026-09-27T05:00:00.000Z',
  }, 'printf REMOTE_OK');
  assert.equal(result.stdout, 'REMOTE_OK');
  assert.equal(result.stderr, '');
  assert.equal(calls[0].file, 'ssh');
  assert.equal(calls[0].args.at(-1), 'printf REMOTE_OK');
  assert.ok(calls[0].options.timeoutMs <= 59 * 60_000);
});

test('provider restricts scp paths to the anonymous VM app directory', async () => {
  const provider = new RailwayAnonymousProvider({
    quotaStore: { remaining: () => 3, recordUse: () => ({ used: 1 }) },
    runProcessImpl: async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false }),
  });
  await assert.rejects(
    () => provider.copyTo({ keyPath: '/tmp/key' }, '/tmp/a', '/etc/passwd'),
    /REMOTE_PATH_FORBIDDEN/,
  );
});

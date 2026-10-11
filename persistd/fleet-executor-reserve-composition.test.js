const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FleetExecutor } = require('./src/fleet/executor');
const { GiB } = require('./src/storage/cache-manager');

function fixture(t, { freeGiB, scratchGiB = 0 }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-executor-disk-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return new FleetExecutor({
    nodeId: 'desktop-primary',
    secret: 'synthetic-test-secret',
    receiptDir: path.join(cwd, 'receipts'),
    commands: {
      version: {
        executable: process.execPath,
        args: ['--version'],
        cwd,
        timeoutMs: 4000,
        maxOutputBytes: 1024,
        estimatedScratchBytes: scratchGiB * GiB,
      },
    },
    statfs: async () => ({ bsize: 1, blocks: 223 * GiB, bavail: freeGiB * GiB }),
  });
}

test('executor accepts desktop ~49 GiB free with zero scratch under 30 GiB policy', async t => {
  const result = await fixture(t, { freeGiB: 49 }).execute({ requestId: 'ok', commandId: 'version' });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.exitCode, 0);
});

test('executor blocks jobs that would leave under 30 GiB after scratch', async t => {
  await assert.rejects(
    fixture(t, { freeGiB: 49, scratchGiB: 20 }).execute({ requestId: 'scratch-over', commandId: 'version' }),
    /INSUFFICIENT_LOCAL_CAPACITY/,
  );
});

test('executor blocks jobs when actual free space is under the 30 GiB floor', async t => {
  await assert.rejects(
    fixture(t, { freeGiB: 29 }).execute({ requestId: 'under-reserve', commandId: 'version' }),
    /INSUFFICIENT_LOCAL_CAPACITY/,
  );
});

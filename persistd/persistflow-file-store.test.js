const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileAuthorityStore, digestClaimSecret } = require('./src/persistflow/authority-store');

test('file authority store survives a fresh store instance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-store-'));
  const first = new FileAuthorityStore(dir);
  first.create({
    runId: 'durable-run', generation: 1, status: 'ACTIVE', checkpoints: [],
    successor: { generation: 2, chatId: 'chat-2', claimNonceDigest: digestClaimSecret('secret') },
  });
  first.update('durable-run', (state) => ({ ...state, nextSafeAction: { type: 'verify' } }));

  const second = new FileAuthorityStore(dir);
  assert.equal(second.get('durable-run').generation, 1);
  assert.deepEqual(second.get('durable-run').nextSafeAction, { type: 'verify' });

  second.claimSuccessor({ runId: 'durable-run', expectedGeneration: 1, generation: 2, claimSecret: 'secret' });
  const third = new FileAuthorityStore(dir);
  assert.equal(third.get('durable-run').generation, 2);
  assert.equal(third.get('durable-run').successor, null);
});

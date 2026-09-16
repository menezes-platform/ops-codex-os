const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunState, prepareSuccessor } = require('./src/persistflow/run-state');
const {
  MemoryAuthorityStore,
  digestClaimSecret,
} = require('./src/persistflow/authority-store');
const { projectControlState } = require('./src/persistflow/control-projection-store');

function preparedState(secret = 'nonce-8') {
  return prepareSuccessor(createRunState({ runId: 'demo', generation: 7 }), {
    generation: 8,
    chatId: 'chat-8',
    claimNonceDigest: digestClaimSecret(secret),
  });
}

test('CAS-promotes one matching successor and consumes its claim', () => {
  const store = new MemoryAuthorityStore([preparedState()]);
  const promoted = store.claimSuccessor({
    runId: 'demo', expectedGeneration: 7, generation: 8, claimSecret: 'nonce-8',
  });
  assert.equal(promoted.generation, 8);
  assert.equal(promoted.successor, null);
  assert.throws(() => store.claimSuccessor({
    runId: 'demo', expectedGeneration: 7, generation: 8, claimSecret: 'nonce-8',
  }), /STALE_GENERATION/);
});

test('rejects a wrong claim secret without changing authority', () => {
  const store = new MemoryAuthorityStore([preparedState()]);
  assert.throws(() => store.claimSuccessor({
    runId: 'demo', expectedGeneration: 7, generation: 8, claimSecret: 'wrong',
  }), /CLAIM_NONCE_MISMATCH/);
  const state = store.get('demo');
  assert.equal(state.generation, 7);
  assert.equal(state.successor.generation, 8);
});

test('projects canonical state into CONTROL-compatible fields while preserving metadata', () => {
  const projected = projectControlState(
    { ...preparedState(), nextSafeAction: { type: 'RECONCILE', operationId: 'op-1' } },
    { DISPLAY_NAME: 'Demo Run', CHAT_HISTORY_JSON: '["chat-7"]', CLAIM_NONCE: 'legacy-secret' },
  );
  assert.equal(projected.RUN_ID, 'demo');
  assert.equal(projected.GENERATION, '7');
  assert.equal(projected.STATUS, 'ACTIVE');
  assert.equal(projected.DISPLAY_NAME, 'Demo Run');
  assert.equal(projected.CHAT_HISTORY_JSON, '["chat-7"]');
  assert.equal(projected.CANONICAL_AUTHORITY, 'PERSISTFLOW');
  assert.equal(projected.CLAIM_NONCE, '');
  assert.match(projected.NEXT_SAFE_ACTION_JSON, /RECONCILE/);
});

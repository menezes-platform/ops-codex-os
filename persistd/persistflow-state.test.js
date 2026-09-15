const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRunState,
  assertMutableGeneration,
  prepareSuccessor,
} = require('./src/persistflow/run-state');

test('normalizes a new run with one current generation and no successor', () => {
  const state = createRunState({ runId: 'demo' });
  assert.equal(state.runId, 'demo');
  assert.equal(state.generation, 1);
  assert.equal(state.status, 'ACTIVE');
  assert.equal(state.successor, null);
});

test('allows exactly one successor at current generation plus one', () => {
  const state = createRunState({ runId: 'demo', generation: 7 });
  const prepared = prepareSuccessor(state, { generation: 8, chatId: 'chat-8' });
  assert.equal(prepared.successor.generation, 8);
  assert.equal(prepared.successor.chatId, 'chat-8');
  assert.throws(() => prepareSuccessor(prepared, { generation: 8 }), /SUCCESSOR_ALREADY_PENDING/);
  assert.throws(() => prepareSuccessor(state, { generation: 9 }), /INVALID_SUCCESSOR_GENERATION/);
});

test('fails closed for stale mutating generations', () => {
  const state = createRunState({ runId: 'demo', generation: 8 });
  assert.doesNotThrow(() => assertMutableGeneration(state, 8));
  assert.throws(() => assertMutableGeneration(state, 7), /STALE_GENERATION/);
});

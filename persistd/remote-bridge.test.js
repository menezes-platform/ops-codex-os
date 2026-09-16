const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileRemoteRun } = require('./src/persistflow/remote-bridge');

test('equal remote generation projects heartbeat and progress without losing local browser metadata', () => {
  const local = {
    RUN_ID: 'local-run', REMOTE_RUN_ID: 'remote-run', GENERATION: '2', STATUS: 'ACTIVE',
    PROJECT_ROOT: 'C:\\repo', CHAT_ID: 'chat-g2', CURRENT_STATE: 'old', NEXT_SAFE_ACTION: 'old next',
  };
  const remote = {
    runId: 'remote-run', generation: 2, status: 'ACTIVE',
    controllerHeartbeatAt: '2026-09-16T10:32:32.589Z',
    progress: 'fresh remote progress', nextSafeAction: 'resume review',
    updatedAt: '2026-09-16T10:32:33.000Z',
  };
  const result = reconcileRemoteRun(local, remote);
  assert.equal(result.relation, 'EQUAL');
  assert.equal(result.state.GENERATION, '2');
  assert.equal(result.state.PROJECT_ROOT, 'C:\\repo');
  assert.equal(result.state.CHAT_ID, 'chat-g2');
  assert.equal(result.state.CONTROLLER_HEARTBEAT_AT, remote.controllerHeartbeatAt);
  assert.equal(result.state.CURRENT_STATE, 'fresh remote progress');
  assert.equal(result.state.NEXT_SAFE_ACTION, 'resume review');
  assert.equal(result.state.REMOTE_GENERATION, '2');
});

test('remote generation ahead is reported without mutating local generation', () => {
  const local = { RUN_ID: 'local', GENERATION: '2', STATUS: 'ACTIVE', CHAT_ID: 'chat-g2' };
  const remote = { runId: 'remote', generation: 3, status: 'ACTIVE', progress: 'g3' };
  const result = reconcileRemoteRun(local, remote);
  assert.equal(result.relation, 'AHEAD');
  assert.equal(result.state.GENERATION, '2');
  assert.equal(result.state.CHAT_ID, 'chat-g2');
  assert.equal(result.state.REMOTE_GENERATION, '3');
});

test('remote generation behind is reported without regressing local generation', () => {
  const local = { RUN_ID: 'local', GENERATION: '3', STATUS: 'ACTIVE', CHAT_ID: 'chat-g3' };
  const remote = { runId: 'remote', generation: 2, status: 'ACTIVE', progress: 'g2' };
  const result = reconcileRemoteRun(local, remote);
  assert.equal(result.relation, 'BEHIND');
  assert.equal(result.state.GENERATION, '3');
  assert.equal(result.state.CHAT_ID, 'chat-g3');
  assert.equal(result.state.REMOTE_GENERATION, '2');
});

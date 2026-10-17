'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideEpisodicAuthority } = require('../modules/context-gateway/src/episodic-authority-gate');
test('task_11_contract blocks migration without explicit consent and verified rollback', () => {
  const approved = { approved: true, approval_id: 'owner-rag-final-20261015', scope: 'personal/current' };
  const receipt = { verified: true, backup_ref: 'sha256:' + 'a'.repeat(64), restore_test_passed: true };
  assert.equal(decideEpisodicAuthority({ ownerApproval: null, rollbackReceipt: receipt }), 'blocked');
  assert.equal(decideEpisodicAuthority({ ownerApproval: approved, rollbackReceipt: null }), 'blocked');
  assert.equal(decideEpisodicAuthority({ ownerApproval: approved, rollbackReceipt: { verified: true } }), 'blocked');
  assert.equal(decideEpisodicAuthority({ ownerApproval: true, rollbackReceipt: receipt }), 'blocked');
  assert.equal(decideEpisodicAuthority({ ownerApproval: approved, rollbackReceipt: receipt }), 'ready');
});
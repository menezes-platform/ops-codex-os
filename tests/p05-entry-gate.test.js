const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateP05EntryEvidence } = require('../scripts/validate-p05-entry');

test('P05 entry evidence does not mark P05 passed with P03/P04 unmet', () => {
  const result = evaluateP05EntryEvidence({
    phase_id: 'P05',
    claimed_p05_status: 'PASSED',
    p03: { status: 'NOT_PASSED', evidence_ref: 'docs/P03-pending.md' },
    p04: { status: 'NOT_PASSED', evidence_ref: 'docs/P04-pending.md' },
  });
  assert.equal(result.formal_entry, 'NOT_SATISFIED');
  assert.equal(result.p05_release_allowed, false);
  assert.deepEqual(result.blockers, ['P03_EXIT_UNVERIFIED', 'P04_EXIT_UNVERIFIED']);
});

test('offline source tests and draft pull requests do not satisfy the P04 runtime entry', () => {
  const result = evaluateP05EntryEvidence({
    phase_id: 'P05',
    p03: { status: 'PASSED', evidence_ref: 'audit/p03-evidence.md', evidence_kind: 'runtime_verified' },
    p04: { status: 'OFFLINE_SOURCE_ONLY', evidence_ref: 'https://github.com/example/pull/1', evidence_kind: 'source_only' },
  });
  assert.equal(result.formal_entry, 'NOT_SATISFIED');
  assert.deepEqual(result.blockers, ['P04_EXIT_UNVERIFIED']);
});

test('even declared prerequisite passes only nominate entry for independent runtime review', () => {
  const result = evaluateP05EntryEvidence({
    phase_id: 'P05',
    p03: { status: 'PASSED', evidence_ref: 'audit/p03.md', evidence_kind: 'runtime_verified' },
    p04: { status: 'PASSED', evidence_ref: 'audit/p04.md', evidence_kind: 'runtime_verified' },
  });
  assert.equal(result.formal_entry, 'REQUIRES_RUNTIME_VERIFICATION');
  assert.equal(result.p05_release_allowed, false);
  assert.deepEqual(result.blockers, ['P05_RUNTIME_GATES_PENDING']);
});

test('rejects structurally invalid or ambiguous phase-evidence input', () => {
  for (const input of [null, {}, { phase_id: 'P06' }, { phase_id: 'P05', p03: [], p04: {} }, { phase_id: 'P05', p03: { status: 'PASSED' }, p04: { status: 'PASSED' } }]) {
    assert.throws(() => evaluateP05EntryEvidence(input), /P05_ENTRY_EVIDENCE_INVALID/);
  }
});

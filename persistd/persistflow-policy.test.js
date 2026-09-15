const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePolicy, decideAction } = require('./src/policy');

const base = {
  reversible: true,
  lowRisk: true,
  scopePreserving: true,
  logicallyDetermined: true,
};

test('allows ordinary reversible in-scope work', () => {
  assert.deepEqual(evaluatePolicy(base), {
    decision: 'ALLOW',
    reason: 'within_autonomy_envelope',
  });
});

test('requires a human for every hard gate', () => {
  const gates = [
    'financialCommitment',
    'credentialsOrIam',
    'irreversibleDataLoss',
    'publicSecurityBoundary',
    'destructiveSharedHistory',
    'materialScopeExpansion',
    'presetElevation',
  ];
  for (const gate of gates) {
    const result = evaluatePolicy({ ...base, [gate]: true });
    assert.equal(result.decision, 'HUMAN', gate);
  }
});

test('denies automatic incremental spend', () => {
  assert.deepEqual(evaluatePolicy({ ...base, automaticSpend: true }), {
    decision: 'DENY',
    reason: 'no_incremental_spend',
  });
});

test('keeps the legacy decideAction wrapper contract', () => {
  assert.equal(decideAction(base).decision, 'AUTO_EXECUTE');
  assert.equal(decideAction({ ...base, lowRisk: false }).decision, 'REQUIRE_USER');
});

test('requires a human for a production release', () => {
  assert.equal(
    evaluatePolicy({ ...base, productionRelease: true }).decision,
    'HUMAN',
  );
});

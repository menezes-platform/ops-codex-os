const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateQuotaPressure, applyQuotaGuardToState } = require('./src/quota-guard');

test('keeps normal operation when quota and context are healthy', () => {
  const result = evaluateQuotaPressure({
    quotaUsedPercent: 32,
    contextTokens: 60000,
    contextWindow: 258400,
  });
  assert.equal(result.level, 'NORMAL');
  assert.equal(result.shouldSetContextRisk, false);
  assert.equal(result.preserveQualityGates, true);
});

test('enters conserve mode before quota becomes dangerous', () => {
  const result = evaluateQuotaPressure({
    quotaUsedPercent: 52,
    contextTokens: 80000,
    contextWindow: 258400,
  });
  assert.equal(result.level, 'CONSERVE');
  assert.equal(result.rootMode, 'TARGETED');
  assert.equal(result.maxNewHeavyAgents, 2);
  assert.equal(result.actions.targetedReadsOnly, true);
});

test('large controller context independently raises pressure', () => {
  const result = evaluateQuotaPressure({
    quotaUsedPercent: 25,
    contextTokens: 170000,
    contextWindow: 258400,
  });
  assert.equal(result.level, 'PRESSURE');
  assert.equal(result.maxNewHeavyAgents, 1);
  assert.equal(result.actions.blockModelPolling, true);
});

test('fast burn triggers preventive rollover before absolute quota threshold', () => {
  const result = evaluateQuotaPressure({
    quotaUsedPercent: 58,
    previousQuotaUsedPercent: 46,
    sampleMinutes: 5,
    contextTokens: 90000,
    contextWindow: 258400,
  });
  assert.equal(result.level, 'ROLLOVER');
  assert.equal(result.shouldSetContextRisk, true);
  assert.equal(result.maxNewHeavyAgents, 0);
  assert.ok(result.reasons.includes('burn>=2pp/min'));
});

test('today-style burn spike becomes emergency immediately', () => {
  const result = evaluateQuotaPressure({
    quotaUsedPercent: 59,
    previousQuotaUsedPercent: 39,
    sampleMinutes: 4,
    contextTokens: 135000,
    contextWindow: 258400,
  });
  assert.equal(result.level, 'EMERGENCY');
  assert.equal(result.actions.stopNewHeavyModelWork, true);
  assert.equal(result.actions.checkpointDurableState, true);
  assert.equal(result.preserveQualityGates, true);
});

test('absolute quota emergency wins even without previous sample', () => {
  const result = evaluateQuotaPressure({ quotaUsedPercent: 98 });
  assert.equal(result.level, 'EMERGENCY');
  assert.equal(result.shouldSetContextRisk, true);
});

test('rollover pressure promotes active durable run to CONTEXT_RISK', () => {
  const now = new Date('2026-09-19T15:00:00Z');
  const result = applyQuotaGuardToState({
    RUN_ID: 'ttk',
    STATUS: 'ACTIVE',
    MODEL_QUOTA_USED_PERCENT: '78',
    MODEL_CONTEXT_TOKENS: '150000',
    MODEL_CONTEXT_WINDOW: '258400',
  }, now);
  assert.equal(result.changed, true);
  assert.equal(result.state.STATUS, 'CONTEXT_RISK');
  assert.equal(result.state.CONTEXT_RISK_REASON, 'quota_guard:rollover');
  assert.equal(result.state.QUOTA_GUARD_MAX_NEW_HEAVY_AGENTS, '0');
  assert.equal(result.state.QUOTA_GUARD_PRESERVE_QUALITY_GATES, 'true');
});

test('guard never overwrites terminal or explicit wait states', () => {
  for (const status of ['DONE', 'BLOCKED', 'AUTH_REQUIRED', 'WAITING_TOOL', 'WAITING_BROWSER']) {
    const result = applyQuotaGuardToState({
      STATUS: status,
      MODEL_QUOTA_USED_PERCENT: '99',
    }, new Date('2026-09-19T15:00:00Z'));
    assert.equal(result.state.STATUS, status);
    assert.equal(result.state.QUOTA_GUARD_LEVEL, 'EMERGENCY');
  }
});

test('missing telemetry is a no-op instead of guessing', () => {
  const original = { STATUS: 'ACTIVE', RUN_ID: 'no-telemetry' };
  const result = applyQuotaGuardToState(original);
  assert.equal(result.changed, false);
  assert.equal(result.evaluation, null);
  assert.deepEqual(result.state, original);
});

test('quality gates are invariant across every pressure level', () => {
  for (const quotaUsedPercent of [10, 55, 68, 78, 90]) {
    const result = evaluateQuotaPressure({ quotaUsedPercent });
    assert.equal(result.preserveQualityGates, true);
  }
});

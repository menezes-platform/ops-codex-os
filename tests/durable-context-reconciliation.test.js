'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const globalRules = readFileSync(join(root, 'global/AGENTS.md'), 'utf8');
const durableSkill = readFileSync(join(root, 'skills/durable-execution-memory/SKILL.md'), 'utf8');

test('global rules route project-status requests through cross-source reconciliation', () => {
  assert.match(globalRules, /## Cross-source status reconciliation/);
  assert.match(globalRules, /\$durable-execution-memory/);
  assert.match(globalRules, /non-default branches/);
  assert.match(globalRules, /worktrees/);
  assert.match(globalRules, /Drive/);
  assert.match(globalRules, /PersistFlow/);
});

test('durable skill requires temporal reconciliation, not a single old handoff', () => {
  assert.match(durableSkill, /## Multi-source status reconciliation/);
  assert.match(durableSkill, /newest relevant evidence/);
  assert.match(durableSkill, /negative-claim coverage/);
  assert.match(durableSkill, /checkpoint/);
  assert.match(durableSkill, /non-default branches/);
  assert.match(durableSkill, /last verified/);
});

test('durable skill separates implementation reports, observed results, and production gates', () => {
  for (const classification of ['OBSERVED_REMOTE', 'OBSERVED_LOCAL', 'REPORTED_LOCAL', 'HISTORICAL', 'NOT_VERIFIED']) {
    assert.ok(durableSkill.includes(classification), classification);
  }
  assert.match(durableSkill, /runtime.*CI.*deployment/is);
  assert.match(durableSkill, /source unavailable/);
  assert.match(durableSkill, /DoD/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const head = () => readFileSync(join(root, 'CONTEXT_HEAD.md'), 'utf8');
const rules = () => readFileSync(join(root, 'global/AGENTS.md'), 'utf8');
const skill = () => readFileSync(join(root, 'skills/durable-execution-memory/SKILL.md'), 'utf8');
const headSkill = () => readFileSync(join(root, 'skills/context-head/SKILL.md'), 'utf8');

test('HEAD is referenced by agent entry and continuity skill', () => {
  assert.match(head(), /# Context HEAD/);
  assert.match(rules(), /## Context HEAD — pre-answer recovery gate/);
  assert.match(rules(), /CONTEXT_HEAD\.md/);
  assert.match(skill(), /CONTEXT_HEAD\.md/);
  assert.match(headSkill(), /name: context-head/);
});
test('HEAD preserves source authority and bounded project scope', () => {
  for (const name of ['Git', 'Memory', 'Engram', 'PersistFlow', 'Drive', 'Context Gateway']) {
    assert.ok(head().includes(name), name);
  }
  assert.match(head(), /BM25.*FAISS/s);
  assert.match(head(), /scope.*project/is);
  assert.match(head(), /source unavailable/);
});
test('HEAD rejects 50/50 cross-namespace leakage and false ChatGPT auto claims', () => {
  assert.match(head(), /50\/50/);
  assert.match(head(), /namespace_denied/);
  assert.match(head(), /ChatGPT nativo/i);
  assert.match(head(), /n[aã]o.*garant/i);
  assert.match(head(), /Windows desligado/);
  assert.match(head(), /R\$ 0/);
});

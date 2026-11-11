'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCandidate } = require('../scripts/capability-evidence-gate');

const NOW = '2026-11-11T19:45:00-03:00';
const live = (capability, status = 'supported', checkedAt = NOW) => ({
  capability, status, source: { kind: 'live-tool', ref: 'mcp://observed/capability', checkedAt },
});

// Regression: do not call a terminal-only tool a complete replacement
// for a ChatGPT-orchestrated desktop/browser/multi-worker stack.
test('terminal access is not equivalent to an entire autonomous desktop stack', () => {
  const result = evaluateCandidate({
    candidate: 'terminal bridge', now: NOW,
    required: ['chatgpt_subscription', 'terminal', 'desktop_gui', 'browser', 'multi_worker', 'resume'],
    claims: [live('terminal'), live('chatgpt_subscription')],
  });
  assert.equal(result.classification, 'partial');
  assert.deepEqual(result.supported, ['chatgpt_subscription', 'terminal']);
  assert.deepEqual(result.unknown, ['desktop_gui', 'browser', 'multi_worker', 'resume']);
  assert.equal(result.canClaimFullReplacement, false);
});

test('marketing, unsupported links, and missing evidence cannot verify a capability', () => {
  const result = evaluateCandidate({
    candidate: 'hypothetical', now: NOW,
    required: ['desktop_gui', 'multi_worker', 'resume'],
    claims: [
      { capability: 'desktop_gui', status: 'supported', source: { kind: 'blog', ref: 'https://example.com/blog', checkedAt: NOW } },
      { capability: 'multi_worker', status: 'supported', source: { kind: 'official-doc', ref: 'https://example.com', checkedAt: null } },
      { capability: 'resume', status: 'supported' },
    ],
  });
  assert.equal(result.classification, 'unverified');
  assert.deepEqual(result.unknown, ['desktop_gui', 'multi_worker', 'resume']);
});

test('expired evidence cannot establish current availability', () => {
  const result = evaluateCandidate({
    candidate: 'formerly available bridge', now: NOW, maxAgeDays: 30,
    required: ['desktop_gui'], claims: [live('desktop_gui', 'supported', '2026-08-01T12:00:00Z')],
  });
  assert.equal(result.classification, 'unverified');
  assert.deepEqual(result.unknown, ['desktop_gui']);
});

test('explicit verified negative evidence is not confused with absence of evidence', () => {
  const result = evaluateCandidate({
    candidate: 'API-only candidate', now: NOW,
    required: ['chatgpt_subscription', 'terminal'],
    claims: [
      { capability: 'chatgpt_subscription', status: 'unsupported', source: { kind: 'official-doc', ref: 'https://example.com/docs/pricing', checkedAt: NOW } },
      live('terminal'),
    ],
  });
  assert.equal(result.classification, 'partial');
  assert.deepEqual(result.unsupported, ['chatgpt_subscription']);
  assert.deepEqual(result.unknown, []);
});

test('conflicting verified evidence blocks an exact replacement claim', () => {
  const result = evaluateCandidate({
    candidate: 'conflicted', now: NOW, required: ['desktop_gui'],
    claims: [live('desktop_gui'), live('desktop_gui', 'unsupported')],
  });
  assert.equal(result.classification, 'unverified');
  assert.deepEqual(result.conflicted, ['desktop_gui']);
  assert.equal(result.canClaimFullReplacement, false);
});

test('all capabilities require independently grounded evidence before full equivalence', () => {
  const result = evaluateCandidate({
    candidate: 'complete', now: NOW,
    required: ['terminal', 'desktop_gui', 'browser', 'multi_worker', 'resume'],
    claims: ['terminal', 'desktop_gui', 'browser', 'multi_worker', 'resume'].map((c) => live(c)),
  });
  assert.equal(result.classification, 'full');
  assert.equal(result.canClaimFullReplacement, true);
  assert.deepEqual(result.unknown, []);
});

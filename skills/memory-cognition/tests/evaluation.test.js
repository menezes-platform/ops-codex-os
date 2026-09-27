const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreQuerySet, percentile, estimateTokens } = require('../src/evaluation');

test('retrieval metrics score hit, precision, recall, and reciprocal rank from evidence IDs', () => {
  const result = scoreQuerySet([
    { answerable: true, expected: ['README.md#Stack'], retrieved: ['wrong', 'README.md#Stack', 'AUDIT.md'] },
    { answerable: false, expected: [], retrieved: [] },
  ], 3);
  assert.equal(result.hitRate, 1);
  assert.equal(result.precisionAtK, 1 / 3);
  assert.equal(result.recallAtK, 1);
  assert.equal(result.mrr, 0.5);
  assert.equal(result.correctAbstentionRate, 1);
});

test('metric helpers handle empty samples and count tokens deterministically', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(estimateTokens('12345678'), 2);
});

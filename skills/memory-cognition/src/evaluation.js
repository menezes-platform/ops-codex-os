'use strict';

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function estimateTokens(value) {
  return Math.ceil(Buffer.byteLength(String(value ?? ''), 'utf8') / 4);
}

function scoreQuerySet(rows, k = 5) {
  const answerable = rows.filter((row) => row.answerable);
  const unanswerable = rows.filter((row) => !row.answerable);
  const hits = answerable.filter((row) => row.retrieved.slice(0, k).some((id) => row.expected.includes(id)));
  const precisionAtK = answerable.length
    ? answerable.reduce((sum, row) => sum + row.retrieved.slice(0, k).filter((id) => row.expected.includes(id)).length / k, 0) / answerable.length
    : null;
  const recallAtK = answerable.length
    ? answerable.reduce((sum, row) => sum + new Set(row.retrieved.slice(0, k).filter((id) => row.expected.includes(id))).size / row.expected.length, 0) / answerable.length
    : null;
  const mrr = answerable.length
    ? answerable.reduce((sum, row) => {
      const rank = row.retrieved.slice(0, k).findIndex((id) => row.expected.includes(id));
      return sum + (rank < 0 ? 0 : 1 / (rank + 1));
    }, 0) / answerable.length
    : null;
  const correctAbstentions = unanswerable.filter((row) => row.retrieved.length === 0).length;
  return {
    queryCount: rows.length,
    answerableCount: answerable.length,
    unanswerableCount: unanswerable.length,
    hitRate: answerable.length ? hits.length / answerable.length : null,
    precisionAtK,
    recallAtK,
    mrr,
    correctAbstentionRate: unanswerable.length ? correctAbstentions / unanswerable.length : null,
  };
}

module.exports = { percentile, estimateTokens, scoreQuerySet };

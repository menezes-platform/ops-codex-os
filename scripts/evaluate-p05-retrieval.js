'use strict';

/**
 * Offline P05 retrieval TRACE evaluator. It never calls a retriever, does not
 * infer model usage, and can NEVER grant a production phase gate. Its input
 * must be a separate pinned question set and a separately recorded run.
 */
const fs = require('node:fs');
const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PROFILE = /(?:-v\d+|@v\d+)$/;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v) => typeof v === 'string' && v.length > 0 && v.trim() === v;
const unique = (xs) => new Set(xs).size === xs.length;
const invalidFixture = () => { throw new Error('RETRIEVAL_FIXTURE_INVALID'); };
const invalidTrace = () => { throw new Error('RETRIEVAL_TRACE_INVALID'); };
const safeDocumentPath = (v) => nonempty(v) && !v.startsWith('/') && !v.includes('\\')
  && !v.split('/').some((part) => !part || part === '.' || part === '..');

function validateFixture(fixture) {
  if (!isRecord(fixture) || fixture.schema_version !== 1
    || !nonempty(fixture.fixture_id) || !nonempty(fixture.source_commit)
    || !Number.isSafeInteger(fixture.corpus_count) || fixture.corpus_count < 0
    || !isRecord(fixture.profiles)
    || !['lexical_profile', 'vector_profile', 'embedding_profile'].every(
      (key) => nonempty(fixture.profiles[key]) && PROFILE.test(fixture.profiles[key]))
    || !Array.isArray(fixture.questions) || fixture.questions.length === 0
    || fixture.questions.length > 500 || !unique(fixture.questions.map((q) => q?.question_id))) invalidFixture();

  for (const question of fixture.questions) {
    if (!isRecord(question) || !nonempty(question.question_id)
      || !PROJECT_SCOPE.test(question.scope) || !nonempty(question.revision)
      || !Array.isArray(question.relevant_ids) || !Array.isArray(question.stale_ids)
      || !question.relevant_ids.every(nonempty) || !question.stale_ids.every(nonempty)
      || !unique(question.relevant_ids) || !unique(question.stale_ids)
      || question.relevant_ids.some((id) => question.stale_ids.includes(id))) invalidFixture();
  }
}

function validateTrace(fixture, trace) {
  if (!isRecord(trace) || trace.fixture_id !== fixture.fixture_id
    || !['synthetic_fixture', 'offline_observed'].includes(trace.lane)
    || !nonempty(trace.algorithm) || trace.actual_model_tokens !== undefined
    || !Array.isArray(trace.cases)) invalidTrace();
  if (trace.cases.length !== fixture.questions.length
    || !unique(trace.cases.map((c) => c?.question_id))) {
    throw new Error('QUESTION_SET_MISMATCH');
  }
  if (fixture.corpus_count === 0 && trace.cases.some((item) => Array.isArray(item.hits) && item.hits.length > 0)) invalidTrace();
  const questionIds = new Set(fixture.questions.map((q) => q.question_id));
  if (!trace.cases.every((c) => questionIds.has(c?.question_id))) {
    throw new Error('QUESTION_SET_MISMATCH');
  }
  for (const item of trace.cases) {
    if (!isRecord(item) || !Array.isArray(item.hits) || item.hits.length > 1000
      || !unique(item.hits.map((h) => h?.evidence_id))
      || (trace.lane === 'synthetic_fixture' && item.latency_ms != null)
      || (trace.lane === 'offline_observed' && (!Number.isFinite(item.latency_ms)
        || item.latency_ms < 0))) invalidTrace();
    for (const hit of item.hits) {
      if (!isRecord(hit) || !nonempty(hit.evidence_id)
        || !PROJECT_SCOPE.test(hit.scope) || !nonempty(hit.revision)
        || !nonempty(hit.source_ref) || !safeDocumentPath(hit.path)
        || typeof hit.content !== 'string'
        || hit.source_ref !== hit.scope.slice('project/'.length) + '@' + hit.revision) invalidTrace();
    }
  }
}

function percentile(values, probability) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const rank = probability * (ordered.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return Number((ordered[low] + (ordered[high] - ordered[low]) * (rank - low)).toFixed(3));
}

function evaluateReplay(fixture, trace) {
  validateFixture(fixture);
  validateTrace(fixture, trace);
  if (trace.lane === 'offline_observed' && !/^[a-f0-9]{40}$/.test(fixture.source_commit)) {
    throw new Error('RETRIEVAL_SOURCE_COMMIT_UNPINNED');
  }
  const observed = new Map(trace.cases.map((c) => [c.question_id, c]));
  let matchingQueries = 0;
  let precisionTotal = 0;
  let recallTotal = 0;
  let reciprocalTotal = 0;
  let temporalCorrect = 0;
  let temporalCases = 0;
  let leakage = 0;
  let contextChars = 0;

  for (const question of fixture.questions) {
    const result = observed.get(question.question_id);
    const validHits = [];
    for (const hit of result.hits) {
      if (hit.scope !== question.scope) {
        leakage++;
      } else {
        validHits.push(hit);
        contextChars += hit.content.length;
      }
    }
    const relevant = new Set(question.relevant_ids);
    const isCurrentRelevant = (hit) => relevant.has(hit.evidence_id) && hit.revision === question.revision;
    const topFive = validHits.slice(0, 5);
    const matches = topFive.filter(isCurrentRelevant);
    if (matches.length > 0) matchingQueries++;
    precisionTotal += matches.length / 5;
    // Zero-gold questions count as 0 recall, never perfect recall.
    recallTotal += relevant.size ? matches.length / relevant.size : 0;
    const first = validHits.findIndex(isCurrentRelevant);
    if (first >= 0) reciprocalTotal += 1 / (first + 1);

    if (question.stale_ids.length) {
      temporalCases++;
      const stale = new Set(question.stale_ids);
      const firstCurrent = validHits.findIndex(isCurrentRelevant);
      const firstStale = validHits.findIndex((hit) => stale.has(hit.evidence_id) || (relevant.has(hit.evidence_id) && hit.revision !== question.revision));
      if (firstCurrent >= 0 && (firstStale < 0 || firstCurrent < firstStale)) temporalCorrect++;
    }
  }

  const n = fixture.questions.length;
  const latency = trace.lane === 'offline_observed' ? trace.cases.map((c) => c.latency_ms) : [];
  const temporal = temporalCases ? temporalCorrect / temporalCases : null;
  return {
    fixture_id: fixture.fixture_id,
    source_commit: fixture.source_commit,
    corpus_count: fixture.corpus_count,
    profiles: {...fixture.profiles},
    lane: trace.lane,
    algorithm: trace.algorithm,
    query_count: n,
    metrics: {
      hit_rate: matchingQueries / n,
      precision_at_5: Number((precisionTotal / n).toFixed(6)),
      recall_at_5: recallTotal / n,
      mrr: reciprocalTotal / n,
      temporal_accuracy: temporal,
      contradiction_ordering: temporal,
      latency_p50_ms: percentile(latency, 0.5),
      latency_p95_ms: percentile(latency, 0.95),
      estimated_context_chars: contextChars,
    },
    cross_project_leakage_count: leakage,
    actual_model_tokens: null,
    p05_runtime_qualified: false,
    gates: {
      zero_cross_project_leakage: leakage === 0,
      temporal_ordering: temporal === null || temporal === 1,
      // This script has no authenticated runtime receipts or phase proof.
      ready_for_release: false,
    },
  };
}

function compareReplayReports(baseline, candidate) {
  if (!isRecord(baseline) || !isRecord(candidate)
    || baseline.fixture_id !== candidate.fixture_id
    || baseline.source_commit !== candidate.source_commit
    || baseline.corpus_count !== candidate.corpus_count
    || baseline.query_count !== candidate.query_count
    || baseline.lane !== candidate.lane
    || JSON.stringify(baseline.profiles) !== JSON.stringify(candidate.profiles)
    || !isRecord(baseline.metrics) || !isRecord(candidate.metrics)
    || !Number.isFinite(baseline.metrics.recall_at_5)
    || !Number.isFinite(candidate.metrics.recall_at_5)) {
    throw new Error('BENCHMARK_COMPARISON_INVALID');
  }
  const delta = Number((candidate.metrics.recall_at_5 - baseline.metrics.recall_at_5).toFixed(6));
  return {
    fixture_id: baseline.fixture_id,
    delta_recall_at_5: delta,
    quality_regression: delta < 0,
    zero_cross_project_leakage: candidate.cross_project_leakage_count === 0,
    ready_for_release: false,
  };
}

function main(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--fixture', '--trace'].includes(argv[i]) || !argv[i + 1] || values[argv[i]]) {
      throw new Error('BENCHMARK_ARGUMENTS_INVALID');
    }
    values[argv[i]] = argv[i + 1];
  }
  if (!values['--fixture']) throw new Error('FIXTURE_REQUIRED');
  if (!values['--trace']) throw new Error('TRACE_REQUIRED');
  const fixture = JSON.parse(fs.readFileSync(values['--fixture'], 'utf8'));
  const trace = JSON.parse(fs.readFileSync(values['--trace'], 'utf8'));
  process.stdout.write(JSON.stringify(evaluateReplay(fixture, trace), null, 2) + '\n');
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(String(error.message) + "\n"); process.exitCode = 1; }
}

module.exports = { evaluateReplay, compareReplayReports };

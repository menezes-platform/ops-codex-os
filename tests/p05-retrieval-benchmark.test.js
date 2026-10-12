'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { evaluateReplay, compareReplayReports } = require('../scripts/evaluate-p05-retrieval');
const fixture = require('./fixtures/p05-retrieval/pinned-questions.json');
const trace = require('./fixtures/p05-retrieval/synthetic-trace.json');
const fresh = (id, project='alpha', revision='rev-b') => ({
  evidence_id:id, scope:"project/demo/" + project, revision,
  source_ref:"demo/" + project + "@" + revision, path:"docs/" + id + ".md", content:'evidence text',
});
const copy = (v) => JSON.parse(JSON.stringify(v));

// Regression contract: an implementation that always returns a fixed report fails these tests.
test('synthetic replay computes relevance metrics from hits, not hardcoded prior pilot numbers', () => {
  const result = evaluateReplay(fixture, trace);
  assert.equal(result.fixture_id, 'p05-offline-adversarial-v1');
  assert.equal(result.lane, 'synthetic_fixture');
  assert.equal(result.query_count, 4);
  assert.equal(result.metrics.hit_rate, 0.75);
  assert.equal(result.metrics.precision_at_5, 0.15);
  assert.equal(result.metrics.recall_at_5, 0.75);
  assert.equal(result.metrics.mrr, 0.75);
  assert.equal(result.metrics.temporal_accuracy, 1);
  assert.equal(result.metrics.contradiction_ordering, 1);
  assert.equal(result.cross_project_leakage_count, 0);
  assert.equal(result.p05_runtime_qualified, false);
});

test('empty corpus cannot report positive quality metrics', () => {
  const emptyFixture = {...copy(fixture), corpus_count:0};
  const emptyTrace = {...copy(trace), cases:trace.cases.map(c=>({...c,hits:[]}))};
  const result = evaluateReplay(emptyFixture, emptyTrace);
  for (const k of ['hit_rate','precision_at_5','recall_at_5','mrr']) assert.equal(result.metrics[k],0);
  assert.equal(result.cross_project_leakage_count,0);
});

test('foreign-project hit cannot count for quality and trips strict leakage gate', () => {
  const t=copy(trace);
  t.cases[0].hits.unshift(fresh('wrong-project-hit','beta','rev-b'));
  const result=evaluateReplay(fixture,t);
  assert.equal(result.cross_project_leakage_count,1);
  assert.equal(result.gates.zero_cross_project_leakage,false);
  assert.equal(result.gates.ready_for_release,false);
  assert.equal(result.metrics.precision_at_5,0.15);
});

test('old contradictory revision ahead of current source fails temporal ordering', () => {
  const t=copy(trace);
  t.cases[0].hits.unshift(fresh('alpha/gate/old','alpha','rev-a'));
  const result=evaluateReplay(fixture,t);
  assert.equal(result.metrics.temporal_accuracy,0);
  assert.equal(result.metrics.contradiction_ordering,0);
  assert.equal(result.gates.temporal_ordering,false);
});

test('older contradictory source after current source is acceptable', () => {
  const t=copy(trace);
  t.cases[0].hits.push(fresh('alpha/gate/old','alpha','rev-a'));
  const result=evaluateReplay(fixture,t);
  assert.equal(result.metrics.temporal_accuracy,1);
  assert.equal(result.metrics.contradiction_ordering,1);
  assert.equal(result.gates.temporal_ordering,true);
});

test('synthetic fixture has no fabricated latency, tokens, or runtime proof', () => {
  const result=evaluateReplay(fixture,trace);
  assert.equal(result.metrics.latency_p50_ms,null);
  assert.equal(result.metrics.latency_p95_ms,null);
  assert.equal(result.actual_model_tokens,null);
  assert.equal(result.p05_runtime_qualified,false);
  assert.equal(result.source_commit,'synthetic-fixture-not-a-commit');
});

test('observed bounded latency records p50/p95 independently of evaluation runtime', () => {
  const t=copy(trace);
  t.lane='offline_observed';
  t.algorithm='bm25-v1';
  t.cases.forEach((c,i)=>{c.latency_ms=[2,4,6,8][i];});
  const result=evaluateReplay(fixture,t);
  assert.equal(result.metrics.latency_p50_ms,5);
  assert.equal(result.metrics.latency_p95_ms,7.7);
  assert.equal(result.p05_runtime_qualified,false);
});

test('refuses missing, extra, or repeated question IDs instead of quietly skewing denominator', () => {
  const missing=copy(trace); missing.cases.pop();
  assert.throws(()=>evaluateReplay(fixture,missing),/QUESTION_SET_MISMATCH/);
  const duplicated=copy(trace); duplicated.cases[1].question_id=duplicated.cases[0].question_id;
  assert.throws(()=>evaluateReplay(fixture,duplicated),/QUESTION_SET_MISMATCH/);
  const extra=copy(trace); extra.cases.push({...copy(trace.cases[0]),question_id:'foreign-q'});
  assert.throws(()=>evaluateReplay(fixture,extra),/QUESTION_SET_MISMATCH/);
});

test('rejects invalid provenance rather than fabricating source citations', () => {
  const t=copy(trace);
  delete t.cases[0].hits[0].revision;
  assert.throws(()=>evaluateReplay(fixture,t),/RETRIEVAL_TRACE_INVALID/);
});

test('rejects unpinned or contradictory fixture metadata', () => {
  assert.throws(()=>evaluateReplay({...fixture,profiles:{}},trace),/RETRIEVAL_FIXTURE_INVALID/);
  assert.throws(()=>evaluateReplay(fixture,{...trace,fixture_id:'other'}),/RETRIEVAL_TRACE_INVALID/);
  assert.throws(()=>evaluateReplay(fixture,{...trace,lane:'live_qualified'}),/RETRIEVAL_TRACE_INVALID/);
});

test('unobserved latency and user-supplied tokens cannot be misrepresented as actual usage', () => {
  const t=copy(trace); t.actual_model_tokens=12345; t.cases[0].latency_ms=-1;
  assert.throws(()=>evaluateReplay(fixture,t),/RETRIEVAL_TRACE_INVALID/);
});

test('comparison flags candidate regressions without changing measured baseline', () => {
  const baseline=evaluateReplay(fixture,trace);
  const slow=copy(trace); slow.algorithm='candidate'; slow.cases.forEach(c=>c.hits=[]);
  const candidate=evaluateReplay(fixture,slow);
  const comparison=compareReplayReports(baseline,candidate);
  assert.equal(comparison.quality_regression,true);
  assert.equal(comparison.ready_for_release,false);
  assert.equal(comparison.delta_recall_at_5,-0.75);
  assert.equal(baseline.metrics.recall_at_5,0.75);
});

test('comparison refuses different fixtures and synthetic results do not authorize promotion', () => {
  const a=evaluateReplay(fixture,trace),b={...a,fixture_id:'different'};
  assert.throws(()=>compareReplayReports(a,b),/BENCHMARK_COMPARISON_INVALID/);
  assert.equal(compareReplayReports(a,a).ready_for_release,false);
});

test('CLI refuses implicit trace, preventing invented retrieval outcomes', () => {
  const r=spawnSync(process.execPath,[path.join(__dirname,'../scripts/evaluate-p05-retrieval.js'),'--fixture',path.join(__dirname,'fixtures/p05-retrieval/pinned-questions.json')],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/TRACE_REQUIRED/);
});

test('CLI reports synthetic lane explicitly and exit success requires no runtime claim', () => {
  const r=spawnSync(process.execPath,[path.join(__dirname,'../scripts/evaluate-p05-retrieval.js'),'--fixture',path.join(__dirname,'fixtures/p05-retrieval/pinned-questions.json'),'--trace',path.join(__dirname,'fixtures/p05-retrieval/synthetic-trace.json')],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const report=JSON.parse(r.stdout);
  assert.equal(report.lane,'synthetic_fixture');
  assert.equal(report.p05_runtime_qualified,false);
  assert.equal(report.gates.ready_for_release,false);
});

test('zero declared corpus with nonempty results cannot manufacture positive recall', () => {
  const zero = {...copy(fixture), corpus_count:0};
  assert.throws(()=>evaluateReplay(zero,trace),/RETRIEVAL_TRACE_INVALID/);
});

test('a foreign hit with the exact relevant ID cannot inflate recall', () => {
  const t=copy(trace);
  t.cases[0].hits=[{...t.cases[0].hits[0],scope:'project/demo/beta',source_ref:'demo/beta@rev-b'}];
  const result=evaluateReplay(fixture,t);
  assert.equal(result.cross_project_leakage_count,1);
  assert.equal(result.metrics.recall_at_5,0.5);
  assert.equal(result.gates.zero_cross_project_leakage,false);
});

test('malformed parent path or conflicting citation scope is rejected', () => {
  const t=copy(trace);
  t.cases[0].hits[0].path='../secrets';
  assert.throws(()=>evaluateReplay(fixture,t),/RETRIEVAL_TRACE_INVALID/);
  t.cases[0].hits[0].path='docs/current.md';
  t.cases[0].hits[0].source_ref='demo/beta@rev-b';
  assert.throws(()=>evaluateReplay(fixture,t),/RETRIEVAL_TRACE_INVALID/);
});

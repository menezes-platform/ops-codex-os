'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { estimateTokens, percentile, scoreQuerySet } = require('../src/evaluation');
const { HindsightAdapter, createProvider, parseFeatureFlags } = require('../src');

const SECRET_PATTERNS = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|token|credential|secret)\s*[:=]\s*\S+/i,
  /\b(?:cookie|set-cookie|session[_ -]?token|auth[_ -]?token)\s*[:=]\s*\S+/i,
  /\b(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/]+:[^\s@]+@/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

function runGit(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function safeRelativePath(value) {
  return typeof value === 'string' && !value.startsWith('/') && !value.split(/[\\/]/).includes('..') && !/\.(?:pdf|pem|key|env)$/i.test(value);
}

function scanSecrets(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function sectionName(heading) {
  return heading.replace(/^#+\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'intro';
}

function markdownChunks(text, source) {
  const chunks = [];
  const lines = text.split(/\r?\n/);
  let title = 'intro';
  let start = 1;
  let body = [];
  const push = (end) => {
    const content = body.join('\n').trim();
    if (content) chunks.push({ id: `${source.path}@${source.ref.slice(0, 7)}#${title}`, text: content, kind: source.kind, provenance: { repo: source.repo, ref: source.ref, path: source.path, line: start, section: title, timestamp: source.timestamp ?? null }, stale: source.stale === true });
    body = [];
    start = end + 1;
  };
  lines.forEach((line, index) => {
    if (/^#{1,6}\s/.test(line)) {
      push(index);
      title = sectionName(line);
    } else body.push(line);
  });
  push(lines.length);
  return chunks;
}

function buildCorpus(repo, manifest) {
  const docs = [];
  const [, owner, name] = manifest.scope.split('/');
  const repoName = `${owner}/${name}`;
  const head = runGit(repo, ['rev-parse', 'HEAD']);
  if (head !== manifest.current_ref) throw new Error('pilot checkout does not match the pinned current_ref');
  for (const source of manifest.sources) {
    if (!safeRelativePath(source.path)) throw new Error('corpus manifest contains a disallowed path');
    if (source.ref !== manifest.current_ref && !/^[a-f0-9]{7,40}$/i.test(source.ref)) throw new Error('corpus manifest contains an invalid historical ref');
    const text = runGit(repo, ['show', `${source.ref}:${source.path}`]);
    if (scanSecrets(text)) throw new Error('secret-like content found; corpus preparation stopped');
    const timestamp = runGit(repo, ['show', '-s', '--format=%cI', source.ref]);
    const descriptor = { ...source, repo: repoName, timestamp, stale: source.ref !== manifest.current_ref };
    const chunks = source.path.endsWith('.md') ? markdownChunks(text, descriptor) : [{ id: `${source.path}@${source.ref.slice(0, 7)}#file`, text, kind: source.kind, provenance: { repo: repoName, ref: source.ref, path: source.path, line: 1, timestamp }, stale: descriptor.stale }];
    docs.push(...chunks);
  }
  const commits = runGit(repo, ['log', `--max-count=${manifest.history.max_count}`, '--format=%H%x09%ad%x09%s', '--date=iso-strict', manifest.history.ref]);
  for (const row of commits.split('\n').filter(Boolean)) {
    const [ref, timestamp, subject] = row.split('\t');
    if (scanSecrets(subject)) throw new Error('secret-like content found in Git history; corpus preparation stopped');
    docs.push({ id: `commit:${ref.slice(0, 7)}`, text: `${timestamp} ${subject}`, provenance: { repo: repoName, ref, path: null, timestamp }, stale: false });
  }
  return docs;
}

function tokenize(text) {
  const stop = new Set(['which', 'what', 'when', 'where', 'who', 'does', 'did', 'was', 'were', 'is', 'are', 'the', 'a', 'an', 'of', 'in', 'to', 'and', 'or', 'for', 'how', 'can', 'this', 'that', 'at', 'on', 'with', 'do', 'before', 'after', 'current', 'currently', 'initial', 'project', 'version', 'use', 'used', 'uses', 'page', 'public', 'qual', 'quais', 'está', 'esta', 'no', 'na', 'do', 'da', 'de', 'um', 'uma', 'que', 'com', 'foi', 'existiam', 'versão']);
  return (String(text).toLowerCase().match(/[\p{L}\p{N}_./-]+/gu) ?? []).filter((term) => !stop.has(term));
}

function buildIndex(docs) {
  const prepared = docs.map((doc) => ({ ...doc, terms: tokenize(`${doc.provenance.path ?? ''} ${doc.provenance.section ?? ''} ${doc.text}`) }));
  const documentFrequency = new Map();
  for (const doc of prepared) for (const term of new Set(doc.terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = prepared.reduce((sum, doc) => sum + doc.terms.length, 0) / Math.max(1, prepared.length);
  const serializedBytes = Buffer.byteLength(JSON.stringify({ docs: prepared.map(({ id, terms }) => ({ id, terms })), documentFrequency: [...documentFrequency], averageLength }));
  return { docs: prepared, documentFrequency, averageLength, serializedBytes };
}

function search(index, query, limit = 5, minScore = 0.12) {
  const queryTerms = [...new Set(tokenize(query))];
  const count = index.docs.length;
  const ranked = index.docs.map((doc) => {
    const tf = new Map();
    for (const term of doc.terms) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const frequency = tf.get(term) ?? 0;
      if (!frequency) continue;
      const df = index.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5));
      const kindWeight = doc.kind === 'runtime_config' ? 1.35 : doc.kind === 'source' ? 1.15 : doc.kind?.startsWith('historical') ? 0.95 : doc.id.startsWith('commit:') ? 0.18 : 1;
      score += kindWeight * idf * (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * doc.terms.length / index.averageLength));
    }
    return { ...doc, score };
  }).filter((doc) => doc.score >= minScore);
  ranked.sort((a, b) => b.score - a.score || Number(a.stale) - Number(b.stale) || a.id.localeCompare(b.id));
  return ranked.slice(0, limit);
}

function evaluateQueries(index, questions, k = 5) {
  const latencies = [];
  const scoredRows = [];
  const queryDetails = [];
  let contextChars = 0;
  let estimatedQueryTokens = 0;
  let estimatedContextTokens = 0;
  let queryBytes = 0;
  let temporalCorrect = 0;
  let temporalCount = 0;
  let contradictionsDetected = 0;
  let contradictoryCount = 0;
  let staleReturned = 0;
  let staleOpportunities = 0;
  for (const question of questions) {
    const start = performance.now();
    const hits = search(index, question.query, k);
    latencies.push(performance.now() - start);
    estimatedQueryTokens += estimateTokens(question.query);
    queryBytes += Buffer.byteLength(question.query, 'utf8');
    let budget = 1200 * 4;
    let context = '';
    for (const hit of hits) {
      if (budget <= 0) break;
      const excerpt = hit.text.slice(0, budget);
      context += excerpt;
      budget -= Buffer.byteLength(excerpt, 'utf8');
    }
    estimatedContextTokens += estimateTokens(context);
    contextChars += Buffer.byteLength(context, 'utf8');
    scoredRows.push({ answerable: question.answerable, expected: question.expected, retrieved: hits.map((hit) => hit.id) });
    queryDetails.push({ id: question.id, category: question.category, resultIds: hits.map((hit) => hit.id), scores: hits.map((hit) => Number(hit.score.toFixed(4))), retrievedCount: hits.length, estimatedContextTokens: estimateTokens(context) });
    if (question.category === 'temporal') {
      temporalCount += 1;
      if (hits.some((hit) => question.expected.includes(hit.id))) temporalCorrect += 1;
    }
    if (question.stale_evidence?.length) {
      contradictoryCount += 1;
      const currentRank = hits.findIndex((hit) => question.expected.includes(hit.id));
      const staleRank = hits.findIndex((hit) => question.stale_evidence.includes(hit.id));
      if (currentRank >= 0 && (staleRank < 0 || currentRank < staleRank)) contradictionsDetected += 1;
      if (staleRank >= 0) {
        staleOpportunities += 1;
        if (currentRank < 0 || staleRank < currentRank) staleReturned += 1;
      }
    }
  }
  const core = scoreQuerySet(scoredRows, k);
  return {
    metrics: {
      ...core,
      correctAbstentionRate: null,
      relevanceAtK: core.precisionAtK,
      unsupportedAnswers: null,
      abstentionMeasurement: 'not measured: retrieval-only benchmark has no answer generator or semantic no-answer judgment',
      contradictionsDetected,
      contradictionCases: contradictoryCount,
      staleMemoryRate: staleOpportunities ? staleReturned / staleOpportunities : 0,
      temporalRetrievalAccuracy: temporalCount ? temporalCorrect / temporalCount : null,
      recallLatencyP50Ms: percentile(latencies, 0.5),
      recallLatencyP95Ms: percentile(latencies, 0.95),
      queryBytes,
      estimatedQueryTokens,
      estimatedContextTokens,
      averageEstimatedContextTokens: questions.length ? estimatedContextTokens / questions.length : null,
      llmInputTokens: null,
      llmOutputTokens: null,
      llmCalls: 0,
      estimatedCostUsd: 0,
      contextBytes: contextChars,
    },
    queryDetails,
  };
}

function matchEvidenceId(item, docs) {
  const provenance = item.provenance ?? {};
  const ref = String(provenance.ref ?? '');
  const pathName = provenance.path;
  const section = String(provenance.section ?? '').split('#').at(-1);
  const doc = docs.find((candidate) => candidate.provenance.path === pathName
    && String(candidate.provenance.ref).startsWith(ref.slice(0, 7))
    && (!section || candidate.provenance.section === section || candidate.id.endsWith(`#${section}`)));
  return doc?.id ?? `unmapped:${item.id}`;
}

async function evaluateHindsightShadow(index, docs, questions, manifest) {
  const url = process.env.HINDSIGHT_API_URL;
  if (!url || String(process.env.COGNITION_ENABLED).toLowerCase() !== 'true' || String(process.env.HINDSIGHT_SHADOW_ENABLED).toLowerCase() !== 'true') {
    return { status: 'unavailable', reason: 'Shadow flags are off or no Hindsight URL is configured.', metrics: null };
  }
  const adapter = new HindsightAdapter({ baseUrl: url, token: process.env.HINDSIGHT_API_TOKEN, projectScopes: [manifest.scope] });
  let shadow = [];
  let summary = null;
  const coordinator = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async ({ query, limit }) => search(index, query, limit).map((item) => ({ ...item, scope: manifest.scope, provider: 'git-docs', derived: false })) },
    hindsight: adapter,
    evaluate: (evaluation) => { shadow = evaluation.shadow; summary = evaluation.metrics; },
  });
  const latency = [];
  const rows = [];
  const details = [];
  let contextBytes = 0;
  let contextTokens = 0;
  for (const question of questions) {
    const started = performance.now();
    await coordinator.recall({ scope: manifest.scope, query: question.query, limit: 5, maxTokens: 1200 });
    latency.push(performance.now() - started);
    const results = shadow.map((item) => ({ ...item, evidenceId: matchEvidenceId(item, docs) }));
    const ids = results.map((item) => item.evidenceId);
    rows.push({ answerable: question.answerable, expected: question.expected, retrieved: ids });
    const context = results.map((item) => item.text).join('\n').slice(0, 1200 * 4);
    contextBytes += Buffer.byteLength(context, 'utf8');
    contextTokens += estimateTokens(context);
    details.push({ id: question.id, category: question.category, resultIds: ids, retrievedCount: ids.length, estimatedContextTokens: estimateTokens(context) });
    shadow = [];
  }
  const quality = scoreQuerySet(rows, 5);
  let contradictionsDetected = 0;
  let staleCount = 0;
  let staleWrongOrder = 0;
  let contradictionCases = 0;
  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    if (!question.stale_evidence?.length) continue;
    contradictionCases += 1;
    const ids = rows[i].retrieved;
    const current = ids.findIndex((id) => question.expected.includes(id));
    const stale = ids.findIndex((id) => question.stale_evidence.includes(id));
    if (current >= 0 && (stale < 0 || current < stale)) contradictionsDetected += 1;
    if (stale >= 0) { staleCount += 1; if (current < 0 || stale < current) staleWrongOrder += 1; }
  }
  const raw = adapter.metrics.snapshot();
  return {
    status: raw.failures ? 'partial_or_failed' : 'completed',
    metrics: {
      ...quality,
      relevanceAtK: quality.precisionAtK,
      unsupportedAnswers: null,
      correctAbstentionRate: null,
      abstentionMeasurement: 'not measured: retrieval-only benchmark has no answer generator or semantic no-answer judgment',
      contradictionsDetected,
      contradictionCases,
      staleMemoryRate: staleCount ? staleWrongOrder / staleCount : 0,
      temporalRetrievalAccuracy: (() => {
        const temporal = questions.map((question, index) => ({ question, ids: rows[index].retrieved })).filter(({ question }) => question.category === 'temporal');
        return temporal.length ? temporal.filter(({ question, ids }) => ids.some((id) => question.expected.includes(id))).length / temporal.length : null;
      })(),
      recallLatencyP50Ms: percentile(latency, 0.5),
      recallLatencyP95Ms: percentile(latency, 0.95),
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      llmCalls: raw.llmCalls,
      estimatedCostUsd: raw.estimatedCostUsd,
      contextBytes,
      estimatedContextTokens: contextTokens,
      indexSizeBytes: null,
      requests: raw.requests ?? 0,
      successes: raw.successes ?? 0,
      failures: raw.failures ?? 0,
      timeouts: raw.timeouts ?? 0,
      rateLimits: raw.rateLimits ?? 0,
      retries: raw.retries ?? 0,
      noResultQueries: raw.noResults ?? 0,
      unscopedOrUnmappedResults: details.reduce((sum, detail) => sum + detail.resultIds.filter((id) => id.startsWith('unmapped:')).length, 0),
      shadowDelta: summary,
    },
    questions: details,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
    else throw new Error('unsupported argument');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.resolve(args.repo ?? process.env.PILOT_REPO ?? '');
  if (!args.repo && !process.env.PILOT_REPO) throw new Error('pass --repo <pilot-checkout>');
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pilot/manifest.json'), 'utf8'));
  const questions = JSON.parse(fs.readFileSync(path.join(root, 'pilot/questions.json'), 'utf8'));
  const ingestStart = performance.now();
  const docs = buildCorpus(repo, manifest);
  const index = buildIndex(docs);
  const ingestLatencyMs = performance.now() - ingestStart;
  const baseline = evaluateQueries(index, questions);
  const hindsightShadow = await evaluateHindsightShadow(index, docs, questions, manifest);
  const flags = parseFeatureFlags();
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    scope: manifest.scope,
    repo: manifest.repository,
    current_ref: manifest.current_ref,
    corpus: { manifest_sources: manifest.sources.length, indexed_passages: docs.length, corpusTextBytes: Buffer.byteLength(docs.map((doc) => doc.text).join('\n')), serializedIndexBytes: index.serializedBytes, ingestLatencyMs, secret_scan: manifest.secret_scan, engramResults: manifest.engram.results },
    baseline: { provider: 'Git/docs BM25; Engram project probe measured separately', metrics: baseline.metrics, questions: baseline.queryDetails },
    hindsight_shadow: hindsightShadow,
    flags: { COGNITION_ENABLED: flags.cognitionEnabled, HINDSIGHT_SHADOW_ENABLED: flags.hindsightShadowEnabled, HINDSIGHT_SERVING_ENABLED: false },
  };
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) fs.writeFileSync(path.resolve(args.output), rendered, { mode: 0o600 });
  process.stdout.write(rendered);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildCorpus, buildIndex, evaluateQueries, evaluateHindsightShadow, search, tokenize };

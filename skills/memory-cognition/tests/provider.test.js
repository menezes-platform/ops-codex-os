const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EngramAdapter,
  HindsightAdapter,
  MemoryCognitionProvider,
  createProvider,
  createMcpHandlers,
  MCP_TOOL_DEFINITIONS,
  parseFeatureFlags,
} = require('../src');
const { isPrivateEndpoint } = require('../scripts/ingest-pilot');

const scope = 'project/menezesx2k26-byte/edu-trigonometria-pretemporada';
const provenance = {
  repo: 'menezesx2k26-byte/edu-trigonometria-pretemporada',
  ref: 'd95a196a07036e21e09e1e08cfdff9baaa2200ea',
  path: 'README.md',
  section: 'Stack',
};

test('provider contract requires explicit scope, source, time, and derived status', () => {
  const provider = new MemoryCognitionProvider({ provider: 'test' });
  assert.throws(() => provider.normalizeRecall([], { query: 'runtime' }), /scope/i);
  const [item] = provider.normalizeRecall([{
    id: 'fact-1', text: 'Astro 7', occurredAt: '2026-09-20T00:00:00Z', provenance,
  }], { scope, query: 'runtime' });
  assert.equal(item.scope, scope);
  assert.equal(item.provider, 'test');
  assert.equal(item.derived, true);
  assert.equal(item.temporal.occurredAt, '2026-09-20T00:00:00Z');
  assert.equal(item.temporal.status, 'event-time-known');
  assert.equal(item.provenance.path, 'README.md');
});

test('EngramAdapter normalizes real hybrid search results and drops mismatched project titles', async () => {
  let call;
  const adapter = new EngramAdapter({ search: async (args) => {
    call = args;
    return { results: [
      { chunk_id: 'chunk-1', conversation_id: 'conv-1', conversation_title: 'edu-trigonometria-pretemporada: architecture', chunk_text: 'Astro 7 and React 19', score: 0.91, start_sequence: 4, tags: ['project:edu-trigonometria-pretemporada'] },
      { chunk_id: 'chunk-2', conversation_id: 'conv-2', conversation_title: 'another-project: architecture', chunk_text: 'private unrelated text', score: 0.99, tags: ['other'] },
    ] };
  } });
  const items = await adapter.recall({ scope, query: 'What runtime?', limit: 5 });
  assert.equal(call.project, 'edu-trigonometria-pretemporada');
  assert.equal(items.length, 1);
  assert.equal(items[0].provenance.conversationId, 'conv-1');
  assert.equal(items[0].provenance.messageId, 'chunk-1');
  assert.equal(items[0].provenance.retrievalMethod, 'engram-hybrid');
  assert.equal(items[0].retrieval.rank, 1);
  assert.equal(adapter.isolation.securityBoundary, false);
});

test('HindsightAdapter derives bank only from the explicit project allowlist', async () => {
  let request;
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888',
    projectScopes: [scope],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ results: [{
        id: 'fact-7', text: 'Astro 7 is the runtime', type: 'world',
        context: 'README.md#Stack', metadata: { repo: 'menezesx2k26-byte/edu-trigonometria-pretemporada', commit: provenance.ref, path: 'README.md' },
        tags: ['derived'], mentionedAt: '2026-09-27T00:00:00Z', entities: ['Astro'],
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const items = await adapter.recall({ scope, query: 'Which runtime?', limit: 3 });
  assert.match(request.url, /\/v1\/default\/banks\/project--menezesx2k26-byte--edu-trigonometria-pretemporada\/memories\/recall$/);
  assert.equal(JSON.parse(request.init.body).query, 'Which runtime?');
  assert.equal(items[0].provider, 'hindsight');
  assert.equal(items[0].provenance.itemId, 'fact-7');
  assert.equal(items[0].provenance.repo, provenance.repo);
  assert.equal(items[0].provenance.path, 'README.md');
  assert.deepEqual(items[0].entities, ['Astro']);
});

test('HindsightAdapter rejects account, unknown, and model-invented scopes before network calls', async () => {
  let calls = 0;
  const adapter = new HindsightAdapter({ baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], fetchImpl: async () => { calls++; } });
  await assert.rejects(adapter.recall({ scope: 'account/gabriel', query: 'x' }), /scope|allowlist/i);
  await assert.rejects(adapter.recall({ scope: 'project/unknown/repo', query: 'x' }), /allowlist/i);
  assert.equal(calls, 0);
});

test('HindsightAdapter filters cross-project payloads and returns empty results safely', async () => {
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope],
    fetchImpl: async () => new Response(JSON.stringify({ results: [
      { id: 'foreign', text: 'another project', metadata: { repo: 'elsewhere/private' } },
      { id: 'blank', text: '  ', metadata: { repo: provenance.repo } },
    ] }), { status: 200 }),
  });
  assert.deepEqual(await adapter.recall({ scope, query: 'private' }), []);
  assert.equal(adapter.metrics.snapshot().noResults, 1);
});

test('Hindsight malformed responses and database failures retry only within the configured bound', async () => {
  let calls = 0;
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], attempts: 2,
    sleep: async () => {}, random: () => 0,
    fetchImpl: async () => { calls++; return new Response('not-json', { status: 503 }); },
  });
  await assert.rejects(adapter.recall({ scope, query: 'database' }), /request failed/);
  assert.equal(calls, 2);
  assert.equal(adapter.metrics.snapshot().failures, 1);
  assert.equal(adapter.metrics.snapshot().retries, 1);
});

test('Hindsight malformed JSON response fails closed after the bounded retry count', async () => {
  let calls = 0;
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], attempts: 2,
    sleep: async () => {}, random: () => 0,
    fetchImpl: async () => { calls++; return new Response('not-json', { status: 200 }); },
  });
  await assert.rejects(adapter.recall({ scope, query: 'runtime' }), /request failed/);
  assert.equal(calls, 2);
});

test('Hindsight corpus ingestion is scope-bound, idempotent, and reports partial failures without content', async () => {
  let calls = 0;
  const requestBodies = [];
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], attempts: 1,
    fetchImpl: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      requestBodies.push(body);
      const items = body.items.map((item) => ({ document_id: item.document_id, success: item.metadata.source_id !== 'doc-fails' }));
      return new Response(JSON.stringify({ success: true, items }), { status: 200 });
    },
  });
  const event = { eventId: 'git:d95a196:README.md#Stack', content: 'Astro 7', observedAt: '2026-09-20T00:00:00Z', provenance };
  const failed = { ...event, eventId: 'doc-fails', content: 'safe text', provenance: { ...provenance, path: 'README.md' } };
  const result = await adapter.ingest({ scope, events: [event, event, failed] });
  assert.equal(result.ingested, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rejected, 1);
  assert.equal(calls, 1);
  const replay = await adapter.ingest({ scope, events: [event] });
  assert.equal(replay.ingested, 1);
  assert.equal(calls, 2);
  assert.equal(requestBodies[0].items[0].document_id, requestBodies[1].items[0].document_id);
  assert.equal(JSON.stringify(result).includes('Astro'), false);
});

test('Hindsight corpus ingestion rejects common credentials before sending any request', async () => {
  const secrets = [
    'api_key=synthetic-value',
    'sk-' + 'C'.repeat(24),
    'token=synthetic-value',
    'cookie=session-synthetic-value',
    'Bearer ' + 'A'.repeat(24),
    'postgres://user:password@127.0.0.1/db',
    'eyJaaaaaaaaaa.eyJbbbbbbbbbb.cccccccccccc',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
  ];
  let calls = 0;
  const adapter = new HindsightAdapter({ baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], fetchImpl: async () => { calls++; return new Response('{}'); } });
  for (const content of secrets) {
    await assert.rejects(adapter.ingest({ scope, events: [{ eventId: 'secret-fixture', content, observedAt: '2026-09-20T00:00:00Z', provenance }] }), /secret-like/);
  }
  assert.equal(calls, 0);
});

test('pilot ingestion allows local/private endpoints and rejects public endpoints', () => {
  assert.equal(isPrivateEndpoint('http://127.0.0.1:8888'), true);
  assert.equal(isPrivateEndpoint('https://hindsight.railway.internal'), true);
  assert.equal(isPrivateEndpoint('https://api.hindsight.vectorize.io'), false);
});

test('feature flags default off and serving cannot be enabled before an explicit acceptance record', () => {
  assert.deepEqual(parseFeatureFlags({}), {
    cognitionEnabled: false, hindsightShadowEnabled: false,
    hindsightServingEnabled: false, servingAllowed: false,
  });
  assert.equal(parseFeatureFlags({ HINDSIGHT_SERVING_ENABLED: 'true' }).hindsightServingEnabled, false);
});

test('shadow results are evaluated but never replace baseline context', async () => {
  const baseline = [{ id: 'git-1', text: 'Astro 7', scope, provider: 'project-index' }];
  const shadow = [{ id: 'h-1', text: 'incorrect inferred runtime', scope, provider: 'hindsight', derived: true }];
  let evaluation;
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => baseline },
    hindsight: { recall: async () => shadow },
    evaluate: (entry) => { evaluation = entry; },
  });
  const result = await provider.recall({ scope, query: 'runtime' });
  assert.deepEqual(result, baseline);
  assert.deepEqual(evaluation.baseline, baseline);
  assert.deepEqual(evaluation.shadow, shadow);
  assert.equal(evaluation.shadowServed, false);
});

test('cognition disabled leaves baseline behavior unchanged even with an available Hindsight provider', async () => {
  const baseline = [{ id: 'authoritative-git', text: 'current source' }];
  let shadowCalls = 0;
  const provider = createProvider({
    flags: { cognitionEnabled: false, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => baseline },
    hindsight: { recall: async () => { shadowCalls++; return [{ id: 'stale', text: 'old' }]; } },
  });
  assert.deepEqual(await provider.recall({ scope, query: 'current' }), baseline);
  assert.equal(shadowCalls, 0);
});

test('derive does not ingest when Hindsight shadow mode is off', async () => {
  let deriveCalls = 0;
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: false, hindsightServingEnabled: false },
    baseline: { recall: async () => [] },
    hindsight: { derive: async () => { deriveCalls++; return []; } },
  });
  assert.deepEqual(await provider.derive({ scope, events: [] }), []);
  assert.equal(deriveCalls, 0);
});

test('three consecutive Hindsight failures open the circuit without delaying later baseline reads', async () => {
  const baseline = [{ id: 'current-git' }];
  let shadowCalls = 0;
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => baseline },
    hindsight: { recall: async () => { shadowCalls++; throw new Error('private failure'); } },
  });
  for (let index = 0; index < 4; index += 1) assert.deepEqual(await provider.recall({ scope, query: 'runtime' }), baseline);
  assert.equal(shadowCalls, 3);
  assert.equal(provider.metrics.snapshot().circuitOpen, 1);
});

test('stale derived observations never replace the current Git baseline', async () => {
  const baseline = [{ id: 'current-git', text: 'Astro 7', scope, provider: 'project-index', derived: false }];
  const stale = [{ id: 'old-observation', text: 'Astro 6', scope, provider: 'hindsight', derived: true, stale: true, conflicts: ['current-git'] }];
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => baseline },
    hindsight: { recall: async () => stale },
  });
  assert.deepEqual(await provider.recall({ scope, query: 'runtime' }), baseline);
});

test('Hindsight timeout has a bounded deadline and leaves baseline operational', async () => {
  const baseline = [{ id: 'current-git' }];
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], timeoutMs: 5, attempts: 1,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))),
  });
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => baseline }, hindsight: adapter,
  });
  assert.deepEqual(await provider.recall({ scope, query: 'runtime' }), baseline);
  assert.equal(adapter.metrics.snapshot().timeouts, 1);
});

test('Hindsight timeouts and malformed results fail closed without affecting baseline', async () => {
  const baseline = [{ id: 'git-2', text: 'React 19' }];
  let calls = 0;
  const hindsight = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope], attempts: 2,
    sleep: async () => {}, random: () => 0,
    fetchImpl: async () => { calls++; return new Response('{}', { status: 429 }); },
  });
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => baseline },
    hindsight,
  });
  assert.deepEqual(await provider.recall({ scope, query: 'runtime' }), baseline);
  assert.equal(calls, 2);
  assert.equal(provider.metrics.snapshot().failures, 1);
});

test('derive emits review-only project candidates with evidence and cannot write canonical stores', async () => {
  let retained;
  let retainedUrl;
  const replies = [
    { success: true },
    { results: [{ id: 'fact-2', text: 'Astro 7 is used', type: 'world', context: 'README.md#Stack', metadata: { repo: provenance.repo, commit: provenance.ref, path: 'README.md' }, mentionedAt: '2026-09-27T00:00:00Z' }] },
  ];
  const adapter = new HindsightAdapter({
    baseUrl: 'http://127.0.0.1:8888', projectScopes: [scope],
    fetchImpl: async (url, init) => {
      if (url.endsWith('/memories/retain')) {
        retained = JSON.parse(init.body);
        retainedUrl = url;
      }
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    },
  });
  const result = await adapter.derive({ scope, events: [{
    eventId: 'git:d95a196:README.md#Stack', content: 'Astro 7; React 19; TypeScript',
    observedAt: '2026-09-20T00:00:00Z', provenance,
  }] });
  assert.equal(retained.items[0].document_id.length, 40);
  assert.match(retainedUrl, /project--menezesx2k26-byte--edu-trigonometria-pretemporada/);
  assert.equal(result[0].promotion_status, 'ready_for_review');
  assert.equal(result[0].scope, scope);
  assert.deepEqual(result[0].derived_from, ['git:d95a196:README.md#Stack', 'fact-2']);
  assert.equal(result[0].provenance.ref, provenance.ref);
  assert.equal(result[0].canonical_write, false);
});

test('metrics are sanitized and do not contain query, secret, or returned text', async () => {
  const secret = 'ghp_' + 'A'.repeat(36);
  let serializedMetrics;
  const provider = createProvider({
    flags: { cognitionEnabled: true, hindsightShadowEnabled: true, hindsightServingEnabled: false },
    baseline: { recall: async () => [] },
    hindsight: { recall: async () => [{ text: secret, scope, provider: 'hindsight' }] },
    evaluate: (entry) => { serializedMetrics = JSON.stringify(entry.metrics); },
  });
  await provider.recall({ scope, query: `secret ${secret}` });
  assert.equal(serializedMetrics.includes(secret), false);
  assert.equal(serializedMetrics.includes('secret'), false);
});

test('agent-facing MCP handlers expose only neutral recall, derive, and explain calls', async () => {
  const calls = [];
  const handlers = createMcpHandlers({
    recall: async (args) => { calls.push(['recall', args]); return [{ id: 'git-1', scope, provider: 'project-index', derived: true, provenance }]; },
    derive: async (args) => { calls.push(['derive', args]); return [{ candidate_id: 'cand-1', scope, provider: 'hindsight', canonical_write: false }]; },
    explain: async (args) => { calls.push(['explain', args]); return { itemId: args.itemId, scope, derived: true }; },
  });
  const recall = await handlers.memory_recall({ scope, query: 'runtime', limit: 99 });
  const candidates = await handlers.memory_derive({ scope, events: [] });
  const explanation = await handlers.memory_explain({ scope, itemId: 'git-1' });
  assert.equal(calls[0][1].limit, 20);
  assert.equal(recall[0].provider, 'project-index');
  assert.equal(candidates[0].canonical_write, false);
  assert.equal(explanation.itemId, 'git-1');
  assert.deepEqual(Object.keys(handlers).sort(), ['memory_derive', 'memory_explain', 'memory_recall']);
  assert.deepEqual(MCP_TOOL_DEFINITIONS.map((tool) => tool.name).sort(), Object.keys(handlers).sort());
  assert.equal(MCP_TOOL_DEFINITIONS.every((tool) => tool.inputSchema.additionalProperties === false), true);
});

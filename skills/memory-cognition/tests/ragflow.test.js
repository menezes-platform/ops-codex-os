const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RAGFlowAdapter,
  createProvider,
  parseFeatureFlags,
} = require('../src');

const scope = 'project/menezesx2k26-byte/edu-trigonometria-pretemporada';
const repo = 'menezesx2k26-byte/edu-trigonometria-pretemporada';
const datasetId = 'dataset-trig-001';

test('RAGFlowAdapter keeps project scope mapped to an explicit dataset allowlist', async () => {
  let calls = 0;
  const adapter = new RAGFlowAdapter({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'synthetic-test-key',
    datasetsByScope: { [scope]: [datasetId] },
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });

  await assert.rejects(adapter.recall({ scope: 'project/unknown/repo', query: 'runtime' }), /dataset|scope|allowlist/i);
  await assert.rejects(adapter.recall({ scope: 'account/gabriel', query: 'runtime' }), /scope/i);
  assert.equal(calls, 0);
});

test('RAGFlowAdapter sends hybrid retrieval and normalizes provenance without serving foreign chunks', async () => {
  let request;
  const adapter = new RAGFlowAdapter({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'synthetic-test-key',
    datasetsByScope: { [scope]: [datasetId] },
    vectorSimilarityWeight: 0.55,
    similarityThreshold: 0.2,
    rerankId: 'reranker-1',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        code: 0,
        data: {
          chunks: [
            {
              id: 'chunk-current',
              content: 'Astro 7 and React 19',
              similarity: 0.93,
              vector_similarity: 0.88,
              term_similarity: 0.76,
              dataset_id: datasetId,
              document_id: 'doc-readme',
              document_name: 'README.md',
              document_metadata: {
                repo,
                ref: 'd95a196a07036e21e09e1e08cfdff9baaa2200ea',
                path: 'README.md',
                section: 'Stack',
                observed_at: '2026-09-27T00:00:00Z',
              },
            },
            {
              id: 'chunk-foreign-dataset',
              content: 'must not leak',
              similarity: 0.99,
              dataset_id: 'dataset-other',
              document_metadata: { repo },
            },
            {
              id: 'chunk-foreign-repo',
              content: 'must not leak either',
              similarity: 0.98,
              dataset_id: datasetId,
              document_metadata: { repo: 'other/project' },
            },
          ],
          total: 3,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const items = await adapter.recall({ scope, query: 'Which runtime?', limit: 5 });
  const body = JSON.parse(request.init.body);

  assert.match(request.url, /\/api\/v1\/retrieval$/);
  assert.equal(request.init.headers.authorization, 'Bearer synthetic-test-key');
  assert.equal(body.keyword, true);
  assert.equal(body.vector_similarity_weight, 0.55);
  assert.equal(body.rerank_id, 'reranker-1');
  assert.deepEqual(body.dataset_ids, [datasetId]);
  assert.equal(body.metadata_condition.conditions[0].name, 'repo');
  assert.equal(body.metadata_condition.conditions[0].value, repo);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'chunk-current');
  assert.equal(items[0].provider, 'ragflow');
  assert.equal(items[0].retrieval.method, 'ragflow-hybrid-rerank');
  assert.equal(items[0].retrieval.score, 0.93);
  assert.equal(items[0].provenance.repo, repo);
  assert.equal(items[0].provenance.path, 'README.md');
  assert.equal(items[0].provenance.datasetId, datasetId);
  assert.equal(items[0].provenance.documentId, 'doc-readme');
});

test('RAGFlowAdapter retries transient failures within a strict bound and exposes sanitized metrics', async () => {
  let calls = 0;
  const adapter = new RAGFlowAdapter({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'synthetic-test-key',
    datasetsByScope: { [scope]: [datasetId] },
    attempts: 2,
    sleep: async () => {},
    random: () => 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 503 });
    },
  });

  await assert.rejects(adapter.recall({ scope, query: 'runtime' }), /RAGFlow request failed/);
  assert.equal(calls, 2);
  const metrics = adapter.metrics.snapshot();
  assert.equal(metrics.requests, 2);
  assert.equal(metrics.retries, 1);
  assert.equal(metrics.failures, 1);
  assert.equal(JSON.stringify(metrics).includes('runtime'), false);
  assert.equal(JSON.stringify(metrics).includes('synthetic-test-key'), false);
});

test('RAGFlow shadow is evaluated independently and never replaces the baseline', async () => {
  const baseline = [{ id: 'git-current', text: 'Astro 7', scope, provider: 'project-index', derived: false }];
  const ragflow = [{ id: 'rag-1', text: 'Astro 7', scope, provider: 'ragflow', derived: true }];
  const evaluations = [];

  const provider = createProvider({
    flags: {
      cognitionEnabled: true,
      hindsightShadowEnabled: false,
      hindsightServingEnabled: false,
      ragflowShadowEnabled: true,
      ragflowServingEnabled: false,
      servingAllowed: false,
    },
    baseline: { recall: async () => baseline },
    ragflow: { recall: async () => ragflow },
    evaluate: (entry) => evaluations.push(entry),
  });

  assert.deepEqual(await provider.recall({ scope, query: 'runtime' }), baseline);
  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].shadowProvider, 'ragflow');
  assert.deepEqual(evaluations[0].shadow, ragflow);
  assert.equal(evaluations[0].shadowServed, false);
});

test('RAGFlow flags default off and serving cannot be enabled by environment alone', () => {
  const flags = parseFeatureFlags({ RAGFLOW_SHADOW_ENABLED: 'true', RAGFLOW_SERVING_ENABLED: 'true' });
  assert.equal(flags.ragflowShadowEnabled, true);
  assert.equal(flags.ragflowServingEnabled, false);
  assert.equal(flags.servingAllowed, false);
});

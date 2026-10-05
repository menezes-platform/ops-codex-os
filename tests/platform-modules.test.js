const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createAgentOS } = require('../modules/agent-os/src');
const { createContextGateway } = require('../modules/context-gateway/src');
const { createContextStore } = require('../modules/context-store/src');
const { createProviderGateway } = require('../modules/provider-gateway/src');

const root = path.join(__dirname, '..');
const scope = 'project/menezes-platform/ops-codex-os';
const secondScope = 'project/menezesx2k26-byte/resident-node';

test('Context Gateway resolves trusted project scope and retrieves only one project', async () => {
  const calls = [];
  const gateway = createContextGateway({
    resolveProjectScope: async () => scope,
    allowlistedMultiProjectScopes: [scope, secondScope],
    executionPlaneClient: {
      retrieve: async (request) => { calls.push(request); return { evidence: [] }; },
      indexProject: async (request) => request,
    },
  });

  assert.deepEqual(await gateway.recall({ query: 'lease fencing' }), { evidence: [] });
  assert.deepEqual(calls, [{ scope, query: 'lease fencing', filters: {} }]);
  await assert.rejects(gateway.recall({ scope: secondScope, query: 'lease fencing' }), /REQUEST_FIELD_INVALID/);
});

test('Context Gateway requires explicit configured allowlist for multi-project recall', async () => {
  const calls = [];
  const gateway = createContextGateway({
    resolveProjectScope: () => scope,
    allowlistedMultiProjectScopes: [scope, secondScope],
    executionPlaneClient: {
      retrieve: async (request) => { calls.push(request); return { evidence: [] }; },
      indexProject: async (request) => request,
    },
  });

  await gateway.recallAcrossProjects({ query: 'shared interface', allowlisted_scopes: [scope, secondScope] });
  assert.deepEqual(calls[0], { allowlisted_scopes: [scope, secondScope], query: 'shared interface', filters: {} });
  await assert.rejects(
    gateway.recallAcrossProjects({ query: 'shared interface', allowlisted_scopes: [scope, 'project/other/repo'] }),
    /PROJECT_SCOPE_NOT_ALLOWLISTED/,
  );
  await assert.rejects(
    gateway.recallAcrossProjects({ query: 'shared interface' }),
    /ALLOWLIST_REQUIRED/,
  );
});

test('Context Gateway reindex command uses trusted scope and requires idempotency', async () => {
  const calls = [];
  const gateway = createContextGateway({
    resolveProjectScope: () => scope,
    executionPlaneClient: {
      retrieve: async () => ({ evidence: [] }),
      indexProject: async (request) => { calls.push(request); return { status: 'queued' }; },
    },
  });
  await gateway.requestReindex({ revision: 'git:abc123', idempotency_key: 'index-1' });
  assert.deepEqual(calls[0], { scope, revision: 'git:abc123', idempotency_key: 'index-1' });
  await assert.rejects(gateway.requestReindex({ revision: 'git:abc123' }), /IDEMPOTENCY_KEY_REQUIRED/);
});

test('Context Store delegates project projections with scope and idempotency and has no Git write surface', async () => {
  const calls = [];
  const store = createContextStore({
    driver: {
      readManifest: async (input) => { calls.push(['read', input]); return { generation: 1 }; },
      putCorpusProjection: async (input) => { calls.push(['write', input]); return { revision: input.source_revision }; },
    },
  });
  const input = {
    scope,
    idempotency_key: 'corpus-1',
    source_revision: 'git:abc123',
    documents: [{ source_ref: 'git:abc123', path: 'README.md', content: 'projection' }],
  };

  assert.deepEqual(await store.getIndexManifest({ scope }), { generation: 1 });
  assert.deepEqual(await store.putCorpusProjection(input), { revision: 'git:abc123' });
  assert.deepEqual(calls[1], ['write', input]);
  assert.deepEqual(Object.keys(store).sort(), ['getIndexManifest', 'publishIndexGeneration', 'putCorpusProjection', 'rollbackIndexGeneration']);
  await assert.rejects(store.putCorpusProjection({ ...input, scope: 'global' }), /INVALID_PROJECT_SCOPE/);
  await assert.rejects(store.putCorpusProjection({ ...input, idempotency_key: '' }), /IDEMPOTENCY_KEY_REQUIRED/);
});

test('Provider Gateway selects internal route and normalizes a provider-neutral budgeted response', async () => {
  const routed = [];
  const adapterRequests = [];
  const gateway = createProviderGateway({
    resolveRoute: async (policy) => {
      routed.push(policy);
      return {
        route_id: 'route-v1',
        adapter_id: 'local-test',
        max_output_tokens: policy.task_class === 'tiny' ? 1 : 120,
        max_cost_usd: 0.05,
      };
    },
    adapters: {
      'local-test': {
        infer: async (request) => {
          adapterRequests.push(request);
          return {
            output: [{ role: 'assistant', content: 'done' }],
            usage: { input_tokens: 3, output_tokens: 2 },
            provider_response_id: 'private-adapter-detail',
          };
        },
      },
    },
  });
  const request = {
    policy_profile: 'default',
    task_class: 'summarization',
    input: [{ role: 'user', content: 'summarize' }],
    budget: { max_output_tokens: 200, max_cost_usd: 1 },
  };

  assert.deepEqual(await gateway.infer(request), {
    output: [{ role: 'assistant', content: 'done' }],
    route_id: 'route-v1',
    usage: { input_tokens: 3, output_tokens: 2 },
  });
  assert.deepEqual(routed[0], { policy_profile: 'default', task_class: 'summarization', budget: request.budget });
  assert.deepEqual(adapterRequests[0].budget, { max_output_tokens: 120, max_cost_usd: 0.05 });
  await assert.rejects(gateway.infer({ ...request, provider: 'raw-provider' }), /REQUEST_FIELD_INVALID/);
  await assert.rejects(gateway.infer({ ...request, task_class: 'tiny' }), /PROVIDER_RESULT_OVER_BUDGET/);
});

test('Agent OS is a stateless facade over owned interfaces', async () => {
  const calls = [];
  const os = createAgentOS({
    contextGateway: { recall: async (request) => { calls.push(['recall', request]); return { evidence: [] }; } },
    providerGateway: { infer: async (request) => { calls.push(['infer', request]); return { output: [] }; } },
    executionPlaneClient: { submitTask: async (request) => { calls.push(['submit', request]); return { task_id: 't-1' }; } },
  });

  assert.deepEqual(Object.keys(os).sort(), ['infer', 'recall', 'submitTask']);
  await os.recall({ query: 'context' });
  await os.infer({ task_class: 'summary' });
  await os.submitTask({ task_id: 't-1' });
  assert.deepEqual(calls.map(([name]) => name), ['recall', 'infer', 'submit']);
});

test('P03 module source has no PersistFlow storage, database, or external provider bypass import', () => {
  const modulePaths = [
    'modules/agent-os/src/index.js',
    'modules/context-gateway/src/index.js',
    'modules/context-store/src/index.js',
    'modules/provider-gateway/src/index.js',
  ];
  const forbidden = /persistd\/src\/persistflow|authority-store|node:sqlite|better-sqlite3|api\.(?:openai|anthropic)\.com|generativelanguage\.googleapis\.com/i;
  for (const relativePath of modulePaths) {
    const absolutePath = path.join(root, relativePath);
    assert.equal(fs.existsSync(absolutePath), true, `${relativePath} exists`);
    assert.equal(forbidden.test(fs.readFileSync(absolutePath, 'utf8')), false, `${relativePath} has no forbidden edge`);
  }
});

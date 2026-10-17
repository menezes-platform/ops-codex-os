const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const { createExecutionPlaneClient } = require('../clients/execution-plane/v1/client');

const root = path.join(__dirname, '..');
const contractPath = (relativePath) => path.join(root, relativePath);
const readContract = (relativePath) => JSON.parse(fs.readFileSync(contractPath(relativePath), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const contextSchema = readContract('modules/context-gateway/contracts/v1/context.schema.json');
const contextStoreSchema = readContract('modules/context-store/contracts/v1/manifest.schema.json');
const corpusManifestSchema = readContract('modules/context-store/contracts/v1/corpus-manifest.schema.json');
const providerSchema = readContract('modules/provider-gateway/contracts/v1/inference.schema.json');
for (const schema of [contextSchema, contextStoreSchema, corpusManifestSchema, providerSchema]) ajv.addSchema(schema);

function valid(schemaId, definition, value) {
  return ajv.validate({ $ref: `${schemaId}#/$defs/${definition}` }, value);
}

test('Context Gateway accepts deterministic single-project recall and provenance evidence', () => {
  const request = {
    scope: 'project/menezes-platform/ops-codex-os',
    query: 'lease fencing',
    filters: {},
  };
  assert.equal(valid(contextSchema.$id, 'recallRequest', request), true);

  const response = {
    evidence: [{
      evidence_id: 'ev-1',
      source: 'git',
      source_ref: 'menezes-platform/ops-codex-os@f4e31b4',
      content: 'A stale authority epoch is rejected.',
      provenance: { path: 'docs/architecture/spec-kit/05-dependency-graph.md', revision: 'f4e31b4' },
    }],
  };
  assert.equal(valid(contextSchema.$id, 'recallResult', response), true);
});

test('normal recall rejects global or multi-project scope; multi-project recall requires an explicit allowlist', () => {
  assert.equal(valid(contextSchema.$id, 'recallRequest', { scope: 'global', query: 'x', filters: {} }), false);
  assert.equal(valid(contextSchema.$id, 'recallRequest', {
    scope: 'project/menezes-platform/ops-codex-os',
    scopes: ['project/menezes-platform/ops-codex-os', 'project/menezesx2k26-byte/resident-node'],
    query: 'x',
    filters: {},
  }), false);
  assert.equal(valid(contextSchema.$id, 'multiProjectRecallRequest', {
    allowlisted_scopes: ['project/menezes-platform/ops-codex-os', 'project/menezesx2k26-byte/resident-node'],
    query: 'x',
    filters: {},
  }), true);
  assert.equal(valid(contextSchema.$id, 'multiProjectRecallRequest', {
    allowlisted_scopes: [], query: 'x', filters: {},
  }), false);
});

test('durable context changes require idempotency keys and keep provenance in project scope', () => {
  const scope = 'project/menezes-platform/ops-codex-os';
  const ingest = {
    scope,
    idempotency_key: 'ingest-1',
    source: { kind: 'git', ref: 'f4e31b4', path: 'README.md' },
    classification: 'project-docs',
    content: 'normalized projection',
  };
  const reindex = { scope, revision: 'f4e31b4', idempotency_key: 'reindex-1' };
  assert.equal(valid(contextSchema.$id, 'ingestRequest', ingest), true);
  assert.equal(valid(contextSchema.$id, 'ingestRequest', { ...ingest, idempotency_key: undefined }), false);
  assert.equal(valid(contextSchema.$id, 'ingestRequest', { ...ingest, classification: undefined }), false);
  assert.equal(valid(contextSchema.$id, 'requestReindexRequest', reindex), true);
  assert.equal(valid(contextSchema.$id, 'requestReindexRequest', { scope, revision: 'f4e31b4' }), false);
});

test('Context Store manifest identifies rebuildable current/previous project generations and versioned profiles', () => {
  const validManifest = {
    scope: 'project/menezes-platform/ops-codex-os',
    revision: 'f4e31b4',
    generation: 2,
    role: 'current',
    corpus_manifest_ref: 'sha256:' + 'a'.repeat(64),
    lexical_profile: 'bm25-v1',
    vector_profile: 'vector-v1',
    embedding_profile: 'local-embed-v1',
    chunking_profile: 'structural-v1',
    created_at: '2026-10-02T00:00:00Z',
  };
  assert.equal(valid(contextStoreSchema.$id, 'indexManifest', validManifest), true);
  assert.equal(valid(contextStoreSchema.$id, 'indexManifest', { ...validManifest, role: 'latest' }), false);
  assert.equal(valid(contextStoreSchema.$id, 'indexManifest', { ...validManifest, scope: 'global' }), false);
  assert.equal(valid(contextStoreSchema.$id, 'indexManifest', { ...validManifest, embedding_profile: 'local-embed' }), false);
});

test('Context Store corpus manifest is project-scoped, content-free, and closed', () => {
  const corpusManifest = {
    schema_version: 1,
    scope: 'project/menezes-platform/ops-codex-os',
    source_revision: 'f4e31b4',
    documents: [{
      source_ref: 'git:f4e31b4:README.md',
      path: 'README.md',
      content_sha256: `sha256:${'b'.repeat(64)}`,
    }],
    corpus_manifest_ref: `sha256:${'a'.repeat(64)}`,
  };
  assert.equal(valid(corpusManifestSchema.$id, 'corpusManifest', corpusManifest), true);
  assert.equal(valid(corpusManifestSchema.$id, 'corpusManifest', { ...corpusManifest, scope: 'global' }), false);
  assert.equal(valid(corpusManifestSchema.$id, 'corpusManifest', {
    ...corpusManifest,
    documents: [{ ...corpusManifest.documents[0], content: 'source text' }],
  }), false);
  for (const unsafePath of ['/private/README.md', '../README.md', 'docs/../../secret.md', 'C:/private/README.md', 'docs\\README.md', 'docs//README.md']) {
    assert.equal(valid(corpusManifestSchema.$id, 'corpusManifest', {
      ...corpusManifest,
      documents: [{ ...corpusManifest.documents[0], path: unsafePath }],
    }), false);
  }
});

test('Provider Gateway contract is provider-neutral and excludes conversation/run/project authority', () => {
  const request = {
    policy_profile: 'default',
    task_class: 'summarization',
    input: [{ role: 'user', content: 'Summarize the change.' }],
    budget: { max_output_tokens: 300 },
  };
  const result = {
    output: [{ role: 'assistant', content: 'A short summary.' }],
    route_id: 'route-v1',
    usage: { input_tokens: 8, output_tokens: 5 },
  };
  assert.equal(valid(providerSchema.$id, 'inferenceRequest', request), true);
  assert.equal(valid(providerSchema.$id, 'inferenceResult', result), true);
  assert.equal(valid(providerSchema.$id, 'inferenceRequest', { ...request, provider: 'raw-provider' }), false);
  assert.equal(valid(providerSchema.$id, 'inferenceRequest', { ...request, conversation_id: 'authority' }), false);
});

test('Execution Plane client is versioned, uses JSON, and refuses a mutation without an idempotency key', async () => {
  const calls = [];
  const client = createExecutionPlaneClient({
    baseUrl: 'https://execution-plane.internal',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 202, json: async () => ({ run_id: 'run-1', task_id: 'task-1', status: 'accepted' }) };
    },
  });
  const request = {
    idempotency_key: 'submit-1',
    task_id: 'task-1',
    scope: 'project/menezes-platform/ops-codex-os',
    intent: { kind: 'test', payload: {} },
  };
  const response = await client.submitTask(request);
  assert.deepEqual(response, { run_id: 'run-1', task_id: 'task-1', status: 'accepted' });
  assert.equal(calls[0].url, 'https://execution-plane.internal/v1/tasks');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(calls[0].options.body).idempotency_key, 'submit-1');
  assert.throws(() => client.submitTask({ ...request, idempotency_key: '' }), /IDEMPOTENCY_KEY_REQUIRED/);
});

test('new Agent Platform contracts contain no vendor/framework-specific public types or legacy storage imports', () => {
  const schemaPaths = [
    'modules/context-gateway/contracts/v1/context.schema.json',
    'modules/context-store/contracts/v1/manifest.schema.json',
    'modules/context-store/contracts/v1/corpus-manifest.schema.json',
    'modules/provider-gateway/contracts/v1/inference.schema.json',
  ];
  const forbidden = /langchain|faiss|mcp|openai|anthropic|google\.generative|sqlite|\bwal\b/i;
  for (const relativePath of schemaPaths) {
    const source = fs.readFileSync(contractPath(relativePath), 'utf8');
    assert.equal(forbidden.test(source), false, `${relativePath} exposes a framework/vendor-specific term`);
  }
  const clientSource = fs.readFileSync(contractPath('clients/execution-plane/v1/client.js'), 'utf8');
  assert.equal(/(?:from|require\().*persistd\//i.test(clientSource), false);
});

test('forbidden-edge architecture checks guard only the new producer modules and preserve legacy paths for migration', () => {
  const architecture = fs.readFileSync(contractPath('docs/architecture/spec-kit/05-dependency-graph.md'), 'utf8');
  const authority = fs.readFileSync(contractPath('docs/architecture/spec-kit/03-authority-matrix.md'), 'utf8');
  const shimRegistry = fs.readFileSync(contractPath('docs/architecture/compatibility-shims.md'), 'utf8');
  assert.match(architecture, /INV-001/);
  assert.match(architecture, /INV-013/);
  assert.match(architecture, /INV-014/);
  assert.match(architecture, /INV-018/);
  assert.match(authority, /run-continuity.*PersistFlow/);
  assert.match(authority, /model-routing-policy.*Provider Gateway/);
  assert.match(shimRegistry, /No migration shim has been introduced/);

  const sourceRoots = [
    'modules/context-gateway/src',
    'modules/context-store/src',
    'modules/provider-gateway/src',
  ].map(contractPath);
  const sourceFiles = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:c|m)?js$|\.tsx?$/.test(entry.name)) sourceFiles.push(target);
    }
  }
  sourceRoots.forEach(visit);

  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    const relative = path.relative(root, sourceFile).replaceAll(path.sep, '/');
    if (relative.startsWith('modules/context-gateway/')) {
      assert.doesNotMatch(source, /persistd\/src\/persistflow|authority-store|node:sqlite|better-sqlite3|@langchain/i, relative);
    }
    if (!relative.startsWith('modules/provider-gateway/')) {
      assert.doesNotMatch(source, /api\.(?:openai|anthropic)\.com|generativelanguage\.googleapis\.com/i, relative);
    }
  }

  const authorityRows = authority.split('\n').filter((line) => /^\| `[^`]+` \| [^|]+ \|/.test(line));
  for (const line of authorityRows) {
    const columns = line.split('|').map((column) => column.trim());
    assert.ok(columns[2], `authority row has one writer: ${line}`);
  }
});

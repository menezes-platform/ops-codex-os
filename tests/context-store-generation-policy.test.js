const assert = require('node:assert/strict');
const test = require('node:test');
const schema = require('../modules/context-store/contracts/v1/manifest.schema.json');
const {
  assertIndexManifest,
  createContextStore,
  planGenerationPublication,
  planGenerationRollback,
} = require('../modules/context-store/src');

const scope = 'project/menezes-platform/ops-codex-os';

function manifest(generation, role = 'current', overrides = {}) {
  return {
    scope,
    revision: `git:${generation}`,
    generation,
    role,
    corpus_manifest_ref: `sha256:${String(generation).padStart(64, '0')}`,
    lexical_profile: 'bm25-v1',
    vector_profile: 'faiss-v1',
    embedding_profile: 'local-embed-v1',
    chunking_profile: 'structural-v1',
    created_at: '2026-10-05T02:17:27Z',
    ...overrides,
  };
}

test('manifest schema is a closed root contract for one complete index manifest', () => {
  assert.equal(schema.$ref, '#/$defs/indexManifest');
  assert.equal(schema.$defs.indexManifest.type, 'object');
  assert.equal(schema.$defs.indexManifest.additionalProperties, false);
  assert.deepEqual([...schema.$defs.indexManifest.required].sort(), Object.keys(manifest(1)).sort());
});

test('index manifest validation is strict, project-bound, and immutable', () => {
  const input = manifest(1);
  const checked = assertIndexManifest(input);
  assert.deepEqual(checked, input);
  assert.notEqual(checked, input);
  assert.equal(Object.isFrozen(checked), true);

  assert.throws(() => assertIndexManifest({ ...input, unexpected: true }), /INDEX_MANIFEST_FIELD_INVALID/);
  assert.throws(() => assertIndexManifest({ ...input, scope: 'global' }), /INVALID_PROJECT_SCOPE/);
  assert.throws(() => assertIndexManifest({ ...input, corpus_manifest_ref: 'sha256:not-a-digest' }), /INDEX_MANIFEST_INVALID/);
  assert.throws(() => assertIndexManifest({ ...input, generation: 0 }), /INDEX_MANIFEST_INVALID/);
  assert.throws(() => assertIndexManifest({ ...input, embedding_profile: 'local-embed' }), /INDEX_MANIFEST_INVALID/);
  assert.throws(() => assertIndexManifest({ ...input, created_at: '2026-02-30T12:00:00Z' }), /INDEX_MANIFEST_INVALID/);
  assert.throws(() => assertIndexManifest({ ...input, created_at: 'yesterday' }), /INDEX_MANIFEST_INVALID/);
});

test('first publication plan selects one current generation and no fabricated previous', () => {
  const plan = planGenerationPublication({
    scope,
    current: null,
    candidate: manifest(1),
    expected_current_generation: null,
    idempotency_key: 'publish-1',
  });

  assert.equal(plan.current.generation, 1);
  assert.equal(plan.current.role, 'current');
  assert.equal(plan.previous, null);
  assert.equal(plan.superseded, null);
  assert.equal(plan.expected_current_generation, null);
  assert.equal(plan.expected_previous_generation, null);
});

test('publication promotes candidate and keeps the former current as previous', () => {
  const current = manifest(4);
  const previous = manifest(3, 'previous');
  const plan = planGenerationPublication({
    scope,
    current,
    previous,
    candidate: manifest(5),
    expected_current_generation: 4,
    idempotency_key: 'publish-5',
  });

  assert.deepEqual(plan.current, manifest(5));
  assert.deepEqual(plan.previous, manifest(4, 'previous'));
  assert.deepEqual(plan.superseded, manifest(3, 'previous'));
  assert.equal(plan.expected_current_generation, 4);
  assert.equal(plan.expected_previous_generation, 3);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.previous), true);
});

test('publication rejects another project, stale writers, non-advancing generations, and ambiguous keys', () => {
  const current = manifest(4);
  assert.throws(() => planGenerationPublication({
    scope,
    current,
    candidate: manifest(5),
    expected_current_generation: 3,
    idempotency_key: 'publish-stale',
  }), /CURRENT_GENERATION_CHANGED/);

  assert.throws(() => planGenerationPublication({
    scope,
    current,
    candidate: manifest(4),
    expected_current_generation: 4,
    idempotency_key: 'publish-same',
  }), /INDEX_GENERATION_NOT_ADVANCED/);

  assert.throws(() => planGenerationPublication({
    scope,
    current,
    candidate: manifest(5, 'current', { scope: 'project/another/repository' }),
    expected_current_generation: 4,
    idempotency_key: 'publish-foreign',
  }), /INDEX_MANIFEST_SCOPE_MISMATCH/);

  assert.throws(() => planGenerationPublication({
    scope,
    current,
    candidate: manifest(5, 'previous'),
    expected_current_generation: 4,
    idempotency_key: 'publish-wrong-role',
  }), /CANDIDATE_MANIFEST_ROLE_INVALID/);

  assert.throws(() => planGenerationPublication({
    scope,
    current,
    candidate: manifest(5),
    expected_current_generation: 4,
    idempotency_key: ' publish-5 ',
  }), /IDEMPOTENCY_KEY_INVALID/);
});

test('rollback swaps current and previous only for the expected current generation', () => {
  const current = manifest(8);
  const previous = manifest(7, 'previous');
  const plan = planGenerationRollback({
    scope,
    current,
    previous,
    expected_current_generation: 8,
    idempotency_key: 'rollback-8',
  });

  assert.deepEqual(plan.current, manifest(7));
  assert.deepEqual(plan.previous, manifest(8, 'previous'));
  assert.equal(plan.expected_current_generation, 8);
  assert.equal(plan.expected_previous_generation, 7);
  assert.throws(() => planGenerationRollback({
    scope,
    current,
    previous,
    expected_current_generation: 7,
    idempotency_key: 'rollback-stale',
  }), /CURRENT_GENERATION_CHANGED/);
});

test('rollback fails closed without a previous generation or with malformed pairs', () => {
  assert.throws(() => planGenerationRollback({
    scope,
    current: manifest(1),
    previous: null,
    expected_current_generation: 1,
    idempotency_key: 'rollback-first',
  }), /PREVIOUS_GENERATION_REQUIRED/);

  assert.throws(() => planGenerationPublication({
    scope,
    current: null,
    previous: manifest(1, 'previous'),
    candidate: manifest(2),
    expected_current_generation: null,
    idempotency_key: 'invalid-pair',
  }), /PREVIOUS_WITHOUT_CURRENT/);

  assert.throws(() => planGenerationPublication({
    scope,
    current: manifest(2),
    previous: manifest(2, 'previous'),
    candidate: manifest(3),
    expected_current_generation: 2,
    idempotency_key: 'duplicate-pair',
  }), /INDEX_GENERATION_DUPLICATE/);
});

test('publication after rollback still advances beyond every retained generation', () => {
  const rolledBackCurrent = manifest(7);
  const rolledBackPrevious = manifest(8, 'previous');
  assert.throws(() => planGenerationPublication({
    scope,
    current: rolledBackCurrent,
    previous: rolledBackPrevious,
    candidate: manifest(8),
    expected_current_generation: 7,
    idempotency_key: 'publish-8-again',
  }), /INDEX_GENERATION_NOT_ADVANCED/);

  const plan = planGenerationPublication({
    scope,
    current: rolledBackCurrent,
    previous: rolledBackPrevious,
    candidate: manifest(9),
    expected_current_generation: 7,
    idempotency_key: 'publish-9',
  });
  assert.equal(plan.current.generation, 9);
  assert.equal(plan.previous.generation, 7);
  assert.equal(plan.superseded.generation, 8);
  assert.equal(plan.expected_previous_generation, 8);
});

test('Context Store submits validated publication and rollback plans to an injected driver', async () => {
  const calls = [];
  let state = { current: manifest(1), previous: null };
  const store = createContextStore({
    driver: {
      readManifest: async () => null,
      putCorpusProjection: async () => null,
      readGenerationPair: async (request) => {
        calls.push(['read', request]);
        return state;
      },
      applyGenerationPlan: async (plan) => {
        calls.push(['apply', plan]);
        state = { current: plan.current, previous: plan.previous };
        return { scope: plan.scope, generation: plan.current.generation, status: 'planned' };
      },
    },
  });

  const published = await store.publishIndexGeneration({
    scope,
    candidate: manifest(2),
    expected_current_generation: 1,
    idempotency_key: 'publish-2',
  });
  assert.deepEqual(published, { scope, generation: 2, status: 'planned' });
  assert.deepEqual(calls[1][1], {
    operation: 'publish',
    scope,
    idempotency_key: 'publish-2',
    expected_current_generation: 1,
    expected_previous_generation: null,
    current: manifest(2),
    previous: manifest(1, 'previous'),
    superseded: null,
  });

  const rolledBack = await store.rollbackIndexGeneration({
    scope,
    expected_current_generation: 2,
    idempotency_key: 'rollback-2',
  });
  assert.deepEqual(rolledBack, { scope, generation: 1, status: 'planned' });
  assert.equal(calls[3][1].operation, 'rollback');
  assert.equal(calls[3][1].expected_previous_generation, 1);
  assert.deepEqual(calls[3][1].current, manifest(1));
  assert.deepEqual(calls[3][1].previous, manifest(2, 'previous'));
});

test('Context Store generation writes fail closed when driver methods are absent', async () => {
  const store = createContextStore({ driver: {
    readManifest: async () => null,
    putCorpusProjection: async () => null,
  } });

  await assert.rejects(store.publishIndexGeneration({
    scope,
    candidate: manifest(1),
    expected_current_generation: null,
    idempotency_key: 'publish-1',
  }), /GENERATION_DRIVER_REQUIRED/);
  await assert.rejects(store.rollbackIndexGeneration({
    scope,
    expected_current_generation: 1,
    idempotency_key: 'rollback-1',
  }), /GENERATION_DRIVER_REQUIRED/);
});

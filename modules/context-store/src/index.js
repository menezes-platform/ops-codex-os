const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const generationPolicy = require('./generation-policy');
const corpusManifest = require('./corpus-manifest');
const { assertDocumentPath } = corpusManifest;

function assertProjectScope(scope) {
  if (typeof scope !== 'string' || !PROJECT_SCOPE.test(scope)) throw new Error('INVALID_PROJECT_SCOPE');
  return scope;
}

function assertText(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
}

function assertOnlyFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('REQUEST_INVALID');
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('REQUEST_FIELD_INVALID');
}

function assertGenerationState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GENERATION_STATE_INVALID');
  const fields = Object.keys(value);
  if (fields.some((field) => field !== 'current' && field !== 'previous')) throw new Error('GENERATION_STATE_INVALID');
  if (!Object.hasOwn(value, 'current') || !Object.hasOwn(value, 'previous')) throw new Error('GENERATION_STATE_INVALID');
  for (const field of ['current', 'previous']) {
    const manifest = value[field];
    if (manifest !== null && (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))) {
      throw new Error('GENERATION_STATE_INVALID');
    }
  }
  return value;
}

async function applyGenerationPlan(driver, plan) {
  // The adapter must atomically compare both expected slots and persist the idempotency key.
  return driver.applyGenerationPlan(plan);
}

function createContextStore({ driver } = {}) {
  if (!driver || typeof driver.readManifest !== 'function' || typeof driver.putCorpusProjection !== 'function') {
    throw new Error('CONTEXT_STORE_DRIVER_REQUIRED');
  }

  return Object.freeze({
    async getIndexManifest(request) {
      assertOnlyFields(request, new Set(['scope']));
      const scope = assertProjectScope(request.scope);
      return driver.readManifest({ scope });
    },

    async putCorpusProjection(request) {
      assertOnlyFields(request, new Set(['scope', 'idempotency_key', 'source_revision', 'documents']));
      const scope = assertProjectScope(request.scope);
      assertText(request.idempotency_key, 'IDEMPOTENCY_KEY_REQUIRED');
      assertText(request.source_revision, 'SOURCE_REVISION_REQUIRED');
      if (!Array.isArray(request.documents) || request.documents.length === 0) throw new Error('DOCUMENTS_REQUIRED');
      const documents = request.documents.map((document) => {
        assertOnlyFields(document, new Set(['source_ref', 'path', 'content']));
        assertText(document.source_ref, 'SOURCE_REF_REQUIRED');
        assertDocumentPath(document.path, 'SOURCE_PATH_INVALID');
        if (typeof document.content !== 'string') throw new Error('DOCUMENT_CONTENT_REQUIRED');
        return { source_ref: document.source_ref, path: document.path, content: document.content };
      });
      return driver.putCorpusProjection({
        scope,
        idempotency_key: request.idempotency_key,
        source_revision: request.source_revision,
        documents,
      });
    },

    async publishIndexGeneration(request) {
      assertOnlyFields(request, new Set(['scope', 'candidate', 'expected_current_generation', 'idempotency_key']));
      const scope = assertProjectScope(request.scope);
      if (typeof driver.readGenerationPair !== 'function' || typeof driver.applyGenerationPlan !== 'function') {
        throw new Error('GENERATION_DRIVER_REQUIRED');
      }
      const state = assertGenerationState(await driver.readGenerationPair({ scope }));
      const plan = generationPolicy.planGenerationPublication({
        scope,
        current: state.current,
        previous: state.previous,
        candidate: request.candidate,
        expected_current_generation: request.expected_current_generation,
        idempotency_key: request.idempotency_key,
      });
      return applyGenerationPlan(driver, plan);
    },

    async rollbackIndexGeneration(request) {
      assertOnlyFields(request, new Set(['scope', 'expected_current_generation', 'idempotency_key']));
      const scope = assertProjectScope(request.scope);
      if (typeof driver.readGenerationPair !== 'function' || typeof driver.applyGenerationPlan !== 'function') {
        throw new Error('GENERATION_DRIVER_REQUIRED');
      }
      const state = assertGenerationState(await driver.readGenerationPair({ scope }));
      const plan = generationPolicy.planGenerationRollback({
        scope,
        current: state.current,
        previous: state.previous,
        expected_current_generation: request.expected_current_generation,
        idempotency_key: request.idempotency_key,
      });
      return applyGenerationPlan(driver, plan);
    },
  });
}

module.exports = { createContextStore, assertProjectScope, ...generationPolicy, ...corpusManifest };

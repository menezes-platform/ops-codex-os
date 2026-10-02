const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

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
        assertText(document.path, 'SOURCE_PATH_REQUIRED');
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
  });
}

module.exports = { createContextStore, assertProjectScope };

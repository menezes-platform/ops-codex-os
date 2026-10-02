const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FILTER_FIELDS = new Set(['source_types', 'revision', 'after', 'before']);

function assertRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function assertOnlyFields(value, allowed, code = 'REQUEST_FIELD_INVALID') {
  assertRecord(value, code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(code);
}

function assertProjectScope(value) {
  if (typeof value !== 'string' || !PROJECT_SCOPE.test(value)) throw new Error('INVALID_PROJECT_SCOPE');
  return value;
}

function normalizeQuery(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('QUERY_REQUIRED');
  return value;
}

function normalizeFilters(value = {}) {
  assertOnlyFields(value, FILTER_FIELDS);
  if (value.source_types !== undefined && (!Array.isArray(value.source_types) || value.source_types.some((item) => typeof item !== 'string' || !item.trim()))) {
    throw new Error('FILTERS_INVALID');
  }
  for (const field of ['revision', 'after', 'before']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim())) throw new Error('FILTERS_INVALID');
  }
  return { ...value };
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
}

function createContextGateway({ executionPlaneClient, resolveProjectScope, allowlistedMultiProjectScopes = [] } = {}) {
  if (!executionPlaneClient || typeof executionPlaneClient.retrieve !== 'function' || typeof executionPlaneClient.indexProject !== 'function') {
    throw new Error('EXECUTION_PLANE_CLIENT_REQUIRED');
  }
  if (typeof resolveProjectScope !== 'function') throw new Error('PROJECT_SCOPE_RESOLVER_REQUIRED');
  if (!Array.isArray(allowlistedMultiProjectScopes)) throw new Error('MULTI_PROJECT_ALLOWLIST_INVALID');

  const configuredScopes = new Set(allowlistedMultiProjectScopes.map(assertProjectScope));
  if (configuredScopes.size !== allowlistedMultiProjectScopes.length) throw new Error('MULTI_PROJECT_ALLOWLIST_INVALID');

  async function currentScope() {
    return assertProjectScope(await resolveProjectScope());
  }

  return Object.freeze({
    async recall(request) {
      assertOnlyFields(request, new Set(['query', 'filters']));
      const query = normalizeQuery(request.query);
      const filters = normalizeFilters(request.filters);
      const scope = await currentScope();
      return executionPlaneClient.retrieve({ scope, query, filters });
    },

    async recallAcrossProjects(request) {
      assertOnlyFields(request, new Set(['query', 'filters', 'allowlisted_scopes']));
      const query = normalizeQuery(request.query);
      const filters = normalizeFilters(request.filters);
      const scopes = request.allowlisted_scopes;
      if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 20) throw new Error('ALLOWLIST_REQUIRED');
      const checkedScopes = scopes.map(assertProjectScope);
      if (new Set(checkedScopes).size !== checkedScopes.length) throw new Error('ALLOWLIST_DUPLICATE_SCOPE');
      if (checkedScopes.some((scope) => !configuredScopes.has(scope))) throw new Error('PROJECT_SCOPE_NOT_ALLOWLISTED');
      return executionPlaneClient.retrieve({ allowlisted_scopes: checkedScopes, query, filters });
    },

    async requestReindex(request) {
      assertOnlyFields(request, new Set(['revision', 'idempotency_key']));
      if (typeof request.revision !== 'string' || !request.revision.trim()) throw new Error('REVISION_REQUIRED');
      assertIdempotencyKey(request.idempotency_key);
      const scope = await currentScope();
      return executionPlaneClient.indexProject({ scope, revision: request.revision, idempotency_key: request.idempotency_key });
    },
  });
}

module.exports = { createContextGateway, assertProjectScope };

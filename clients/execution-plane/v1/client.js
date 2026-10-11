function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw new Error('EXECUTION_PLANE_BASE_URL_REQUIRED');
  return text;
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
}

const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function assertProjectScopes(input) {
  const single = typeof input?.scope === 'string' && PROJECT_SCOPE.test(input.scope);
  const multiple = Array.isArray(input?.allowlisted_scopes)
    && input.allowlisted_scopes.length >= 1 && input.allowlisted_scopes.length <= 20
    && input.allowlisted_scopes.every((scope) => typeof scope === 'string' && PROJECT_SCOPE.test(scope))
    && new Set(input.allowlisted_scopes).size === input.allowlisted_scopes.length;
  if (single === multiple || (input?.scope !== undefined && input?.allowlisted_scopes !== undefined)) {
    throw new Error('INVALID_PROJECT_SCOPE');
  }
  return single ? [input.scope] : input.allowlisted_scopes;
}

function assertRetrievalRequest(input) {
  const scopes = assertProjectScopes(input);
  if (typeof input.query !== 'string' || !input.query.trim()) throw new Error('QUERY_REQUIRED');
  if (!input.filters || typeof input.filters !== 'object' || Array.isArray(input.filters)) {
    throw new Error('FILTERS_INVALID');
  }
  return scopes;
}

function validateRetrievalResult(value, scopes, filters) {
  const invalid = () => { throw new Error('EXECUTION_PLANE_RETRIEVAL_INVALID'); };
  if (!value || typeof value !== 'object' || !Array.isArray(value.evidence)) invalid();
  if (value.scope !== undefined && !scopes.includes(value.scope)) invalid();
  const evidence = value.evidence.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.evidence_id !== 'string' || !item.evidence_id.trim()
      || !['git', 'memory', 'engram'].includes(item.source)
      || typeof item.source_ref !== 'string' || !item.source_ref.trim()
      || typeof item.content !== 'string'
      || !item.provenance || typeof item.provenance !== 'object'
      || typeof item.provenance.revision !== 'string' || !item.provenance.revision.trim()
      || (item.scope !== undefined && !scopes.includes(item.scope))
      || (filters.revision !== undefined && item.provenance.revision !== filters.revision)) invalid();
    return {
      evidence_id: item.evidence_id,
      source: item.source,
      source_ref: item.source_ref,
      content: item.content,
      provenance: {
        ...(typeof item.provenance.path === 'string' ? { path: item.provenance.path } : {}),
        revision: item.provenance.revision,
        ...(typeof item.provenance.observed_at === 'string' ? { observed_at: item.provenance.observed_at } : {}),
      },
    };
  });
  return { evidence };
}

function validateIndexReceipt(value, scope, revision) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.receipt_id !== 'string' || !value.receipt_id.trim()
    || value.scope !== scope || value.revision !== revision
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || !['queued', 'completed', 'failed'].includes(value.status)) {
    throw new Error('EXECUTION_PLANE_RECEIPT_INVALID');
  }
  return {
    receipt_id: value.receipt_id,
    scope: value.scope,
    revision: value.revision,
    generation: value.generation,
    status: value.status,
  };
}

function createExecutionPlaneClient({ baseUrl, fetchImpl = globalThis.fetch, capabilityProvider = null } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new Error('EXECUTION_PLANE_FETCH_REQUIRED');

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (capabilityProvider) {
      const capability = await capabilityProvider();
      if (capability) headers.authorization = `Bearer ${capability}`;
    }
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`EXECUTION_PLANE_HTTP_${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  return Object.freeze({
    submitTask(input) {
      assertIdempotencyKey(input?.idempotency_key);
      return request('/v1/tasks', { method: 'POST', body: input });
    },
    getRunState(runId) {
      const id = String(runId || '').trim();
      if (!id) throw new Error('RUN_ID_REQUIRED');
      return request(`/v1/runs/${encodeURIComponent(id)}`);
    },
    cancelTask(input) {
      assertIdempotencyKey(input?.idempotency_key);
      const runId = String(input?.run_id || '').trim();
      const taskId = String(input?.task_id || '').trim();
      if (!runId || !taskId) throw new Error('RUN_AND_TASK_ID_REQUIRED');
      return request(`/v1/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST', body: input,
      });
    },
    async retrieve(input) {
      const scopes = assertRetrievalRequest(input);
      const response = await request('/v1/indexing/retrieve', { method: 'POST', body: input });
      return validateRetrievalResult(response, scopes, input.filters);
    },
    async indexProject(input) {
      const scopes = assertProjectScopes(input);
      if (scopes.length !== 1) throw new Error('INVALID_PROJECT_SCOPE');
      if (typeof input.revision !== 'string' || !input.revision.trim()) throw new Error('REVISION_REQUIRED');
      assertIdempotencyKey(input?.idempotency_key);
      const response = await request('/v1/indexing/projects', { method: 'POST', body: input });
      return validateIndexReceipt(response, scopes[0], input.revision);
    },
  });
}

module.exports = { createExecutionPlaneClient, normalizeBaseUrl };

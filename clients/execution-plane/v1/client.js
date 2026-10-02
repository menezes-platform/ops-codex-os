function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw new Error('EXECUTION_PLANE_BASE_URL_REQUIRED');
  return text;
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
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
    retrieve(input) {
      return request('/v1/indexing/retrieve', { method: 'POST', body: input });
    },
    indexProject(input) {
      assertIdempotencyKey(input?.idempotency_key);
      return request('/v1/indexing/projects', { method: 'POST', body: input });
    },
  });
}

module.exports = { createExecutionPlaneClient, normalizeBaseUrl };

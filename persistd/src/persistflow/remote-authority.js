function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('REMOTE_AUTHORITY_URL_REQUIRED');
  return text;
}

function createRemoteAuthorityClient({ baseUrl, token = '', fetchImpl = fetch } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new Error('REMOTE_FETCH_REQUIRED');

  async function request(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(`${base}${path}`, { ...options, headers });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || `REMOTE_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (!payload?.run) throw new Error('REMOTE_RUN_PAYLOAD_INVALID');
    return payload.run;
  }

  return {
    async inspectRun(runId) {
      const id = encodeURIComponent(String(runId || '').trim());
      if (!id) throw new Error('REMOTE_RUN_ID_REQUIRED');
      return request(`/v1/runs/${id}`);
    },
    async syncGeneration(runId, input = {}) {
      const id = encodeURIComponent(String(runId || '').trim());
      if (!id) throw new Error('REMOTE_RUN_ID_REQUIRED');
      return request(`/v1/runs/${id}/bridge/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
  };
}

module.exports = { createRemoteAuthorityClient, normalizeBaseUrl };

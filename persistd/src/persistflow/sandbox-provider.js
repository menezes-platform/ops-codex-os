const crypto = require('node:crypto');

const OPERATION_KINDS = Object.freeze({
  exec: 'shell.exec',
  read: 'fs.read',
  write: 'fs.write',
  'git.status': 'git.status',
  'git.diff': 'git.diff',
  'browser.run': 'browser.run',
  'artifact.list': 'artifact.list',
});

function encodeId(value) {
  return encodeURIComponent(String(value || ''));
}

class SandboxProvider {
  constructor({
    baseUrl,
    keyId,
    secret,
    fetchImpl = globalThis.fetch,
    clock = () => Date.now(),
    nonceFactory = () => crypto.randomBytes(16).toString('hex'),
  } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.keyId = String(keyId || '');
    this.secret = String(secret || '');
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.nonceFactory = nonceFactory;
    if (!this.baseUrl) throw new Error('SANDBOX_URL_REQUIRED');
    if (!this.keyId) throw new Error('SANDBOX_KEY_ID_REQUIRED');
    if (!this.secret) throw new Error('SANDBOX_SECRET_REQUIRED');
    if (typeof this.fetchImpl !== 'function') throw new Error('SANDBOX_FETCH_REQUIRED');
  }

  async request(method, path, bodyValue) {
    const body = bodyValue === undefined ? '' : JSON.stringify(bodyValue);
    const timestamp = String(Math.floor(Number(this.clock()) / 1000));
    const nonce = String(this.nonceFactory());
    const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = [String(method).toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
    const signature = crypto.createHmac('sha256', this.secret).update(canonical, 'utf8').digest('hex');
    const headers = {
      'x-persistflow-key-id': this.keyId,
      'x-persistflow-timestamp': timestamp,
      'x-persistflow-nonce': nonce,
      'x-persistflow-signature': signature,
    };
    if (bodyValue !== undefined) headers['content-type'] = 'application/json';

    const response = await this.fetchImpl(this.baseUrl + path, {
      method: String(method).toUpperCase(),
      headers,
      ...(bodyValue === undefined ? {} : { body }),
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { raw: text.slice(0, 2048) }; }
    }
    if (!response.ok) {
      const error = new Error('SANDBOX_HTTP_' + response.status);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async create({ runId, repo, ref, providerHint, policyTier = 'standard', ttlSeconds } = {}) {
    const payload = {
      run_id: String(runId || ''),
      repo: String(repo || ''),
      ref: String(ref || ''),
      policy_tier: String(policyTier || 'standard'),
    };
    if (providerHint) payload.provider_hint = providerHint;
    if (ttlSeconds !== undefined) payload.ttl_seconds = Number(ttlSeconds);
    const result = await this.request('POST', '/api/v1/workspaces', payload);
    return result.workspace;
  }

  async inspect(workspaceId) {
    const result = await this.request('GET', '/api/v1/workspaces/' + encodeId(workspaceId));
    return result.workspace;
  }

  async destroy(workspaceId) {
    const result = await this.request('POST', '/api/v1/workspaces/' + encodeId(workspaceId) + '/destroy');
    return result.workspace;
  }

  async exec({
    workspaceId,
    operationId,
    operation = 'exec',
    payload = {},
    priority = 0,
    maxAttempts = 3,
  } = {}) {
    const kind = OPERATION_KINDS[operation];
    if (!kind) throw new Error('SANDBOX_OPERATION_UNSUPPORTED');
    const result = await this.request('POST', '/api/v1/jobs', {
      workspace_id: String(workspaceId || ''),
      operation_id: String(operationId || ''),
      kind,
      payload,
      priority: Number(priority || 0),
      max_attempts: Number(maxAttempts || 3),
    });
    return result.job;
  }

  async inspectJob(jobId) {
    const result = await this.request('GET', '/api/v1/jobs/' + encodeId(jobId));
    return result.job;
  }

  async receipt(jobId) {
    const result = await this.request('GET', '/api/v1/jobs/' + encodeId(jobId) + '/receipt');
    return result.receipt;
  }
}

function createSandboxProviderFromEnv(env = process.env, options = {}) {
  const baseUrl = String(env.PERSISTFLOW_SANDBOX_URL || '').trim();
  const keyId = String(env.PERSISTFLOW_SANDBOX_KEY_ID || '').trim();
  const secret = String(env.PERSISTFLOW_SANDBOX_HMAC_SECRET || '').trim();
  if (!baseUrl && !keyId && !secret) return null;
  return new SandboxProvider({ baseUrl, keyId, secret, ...options });
}

module.exports = { SandboxProvider, createSandboxProviderFromEnv, OPERATION_KINDS };

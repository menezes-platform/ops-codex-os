const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function tokenDigest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function randomToken(prefix) {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function pkceS256(verifier) {
  return crypto.createHash('sha256').update(String(verifier || ''), 'utf8').digest('base64url');
}

function isAllowedRedirectUri(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch { return false; }
}
function defaultState() {
  return { version: 1, clients: {}, codes: {}, accessTokens: {}, refreshTokens: {} };
}

function issuePairIntoState(state, { clientId, resource, scope, now }) {
  const accessToken = randomToken('pf_at_');
  const refreshToken = randomToken('pf_rt_');
  state.accessTokens[tokenDigest(accessToken)] = {
    clientId,
    resource,
    scope,
    expiresAt: now + ACCESS_TTL_MS,
  };
  state.refreshTokens[tokenDigest(refreshToken)] = {
    clientId,
    resource,
    scope,
    expiresAt: now + REFRESH_TTL_MS,
  };
  return {
    token_type: 'Bearer',
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope,
  };
}

class FileOAuthStore {
  constructor(directory, { clock = () => Date.now() } = {}) {
    this.directory = String(directory || '').trim();
    if (!this.directory) throw new Error('OAUTH_STORE_DIR_REQUIRED');
    this.clock = clock;
    this.file = path.join(this.directory, 'oauth-state.json');
  }
  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...defaultState(), ...parsed };
    } catch (error) {
      if (error?.code === 'ENOENT') return defaultState();
      throw error;
    }
  }

  write(state) {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  mutate(fn) {
    const state = this.read();
    const result = fn(state);
    this.write(state);
    return result;
  }

  registerClient(metadata = {}) {
    const redirects = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.map(String) : [];
    if (!redirects.length || redirects.some((uri) => !isAllowedRedirectUri(uri))) {
      throw new Error('OAUTH_INVALID_REDIRECT_URI');
    }
    const client = {
      client_id: randomToken('pf_client_'),
      client_name: String(metadata.client_name || 'MCP client'),
      redirect_uris: redirects,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    return this.mutate((state) => {
      state.clients[client.client_id] = client;
      return clone(client);
    });
  }

  getClient(clientId) {
    return clone(this.read().clients[String(clientId)] || null);
  }
  issueAuthorizationCode({ clientId, redirectUri, codeChallenge, resource, scope = '' }) {
    const client = this.getClient(clientId);
    if (!client || !client.redirect_uris.includes(String(redirectUri))) throw new Error('OAUTH_INVALID_CLIENT');
    const code = randomToken('pf_code_');
    const record = {
      clientId: String(clientId),
      redirectUri: String(redirectUri),
      codeChallenge: String(codeChallenge || ''),
      resource: String(resource || ''),
      scope: String(scope || ''),
      expiresAt: this.clock() + CODE_TTL_MS,
    };
    return this.mutate((state) => {
      state.codes[tokenDigest(code)] = record;
      return code;
    });
  }

  redeemAuthorizationCode({ code, clientId, redirectUri, codeVerifier, resource }) {
    const state = this.read();
    const key = tokenDigest(code);
    const record = state.codes[key];
    const valid = record
      && record.expiresAt >= this.clock()
      && record.clientId === String(clientId)
      && record.redirectUri === String(redirectUri)
      && record.resource === String(resource)
      && record.codeChallenge === pkceS256(codeVerifier);
    if (!valid) throw new Error('OAUTH_INVALID_GRANT');
    delete state.codes[key];
    this.write(state);
    return clone(record);
  }

  issueTokenPair({ clientId, resource, scope = '' }) {
    return this.mutate((state) => issuePairIntoState(state, {
      clientId: String(clientId), resource: String(resource), scope: String(scope || ''), now: this.clock(),
    }));
  }
  validateAccessToken(token, resource) {
    const state = this.read();
    const record = state.accessTokens[tokenDigest(token)];
    if (!record) return null;
    if (record.expiresAt < this.clock()) return null;
    if (record.resource !== String(resource)) return null;
    return clone(record);
  }

  rotateRefreshToken({ refreshToken, clientId, resource }) {
    const state = this.read();
    const key = tokenDigest(refreshToken);
    const record = state.refreshTokens[key];
    const valid = record
      && record.expiresAt >= this.clock()
      && record.clientId === String(clientId)
      && record.resource === String(resource);
    if (!valid) throw new Error('OAUTH_INVALID_GRANT');
    delete state.refreshTokens[key];
    const pair = issuePairIntoState(state, {
      clientId: record.clientId,
      resource: record.resource,
      scope: record.scope,
      now: this.clock(),
    });
    this.write(state);
    return pair;
  }
}

module.exports = {
  FileOAuthStore,
  pkceS256,
  isAllowedRedirectUri,
  tokenDigest,
};
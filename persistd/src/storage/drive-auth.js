const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

class DriveTokenProvider {
  constructor({
    clientId,
    clientSecret,
    refreshToken,
    rootId,
    fetchImpl = globalThis.fetch,
    clock = Date.now,
  } = {}) {
    if (!clientId || !clientSecret || !refreshToken || !rootId) throw new Error('DRIVE_AUTH_CONFIG_INCOMPLETE');
    if (typeof fetchImpl !== 'function') throw new Error('DRIVE_FETCH_REQUIRED');
    Object.defineProperties(this, {
      clientId: { value: String(clientId), enumerable: false },
      clientSecret: { value: String(clientSecret), enumerable: false },
      refreshToken: { value: String(refreshToken), enumerable: false },
      fetchImpl: { value: fetchImpl, enumerable: false },
      clock: { value: clock, enumerable: false },
      cached: { value: null, writable: true, enumerable: false },
    });
    this.rootId = String(rootId);
  }

  cachedAccess(nowMs) {
    if (!this.cached) return null;
    if (this.cached.expiresAtMs - 60_000 <= nowMs) return null;
    return {
      accessToken: this.cached.accessToken,
      expiresAt: new Date(this.cached.expiresAtMs).toISOString(),
      scope: this.cached.scope,
      rootId: this.rootId,
    };
  }

  async getAccess() {
    const nowMs = Number(this.clock());
    const cached = this.cachedAccess(nowMs);
    if (cached) return cached;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      const error = new Error('DRIVE_TOKEN_HTTP_' + response.status);
      throw error;
    }
    const payload = await response.json();
    const accessToken = String(payload.access_token || '');
    const expiresIn = Number(payload.expires_in);
    const scope = String(payload.scope || '');
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('DRIVE_TOKEN_INVALID');
    const scopes = new Set(scope.split(/\s+/).filter(Boolean));
    if (!scopes.has(DRIVE_FILE_SCOPE)) throw new Error('DRIVE_SCOPE_MISMATCH');
    const expiresAtMs = nowMs + Math.floor(expiresIn * 1000);
    this.cached = { accessToken, expiresAtMs, scope };
    return {
      accessToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      scope,
      rootId: this.rootId,
    };
  }
}

function createDriveTokenProviderFromEnv(env = process.env, options = {}) {
  const clientId = String(env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  const rootId = String(env.GABRIEL_DRIVE_ROOT_ID || '').trim();
  const present = [clientId, clientSecret, refreshToken, rootId].filter(Boolean).length;
  if (present === 0) return null;
  if (present !== 4) throw new Error('DRIVE_AUTH_CONFIG_INCOMPLETE');
  return new DriveTokenProvider({ clientId, clientSecret, refreshToken, rootId, ...options });
}

module.exports = {
  DriveTokenProvider,
  createDriveTokenProviderFromEnv,
  DRIVE_FILE_SCOPE,
  TOKEN_URL,
};

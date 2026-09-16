const crypto = require('node:crypto');

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req, maxBytes = 64 * 1024) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > maxBytes) throw new Error('BODY_TOO_LARGE');
  }
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error('INVALID_JSON'); }
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function requestOrigin(req) {
  const forwarded = firstHeader(req.headers['x-forwarded-proto']);
  const protocol = ['http', 'https'].includes(forwarded)
    ? forwarded
    : (req.socket.encrypted ? 'https' : 'http');
  const host = firstHeader(req.headers['x-forwarded-host']) || String(req.headers.host || '');
  if (!host) throw new Error('OAUTH_HOST_REQUIRED');
  return `${protocol}://${host}`;
}
async function readForm(req, maxBytes = 64 * 1024) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > maxBytes) throw new Error('BODY_TOO_LARGE');
  }
  return new URLSearchParams(text);
}

function sameOwnerSecret(secret, expectedDigest) {
  if (!/^[0-9a-f]{64}$/i.test(String(expectedDigest || ''))) return false;
  const actual = crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expectedDigest, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateAuthorization(params, store, origin) {
  if (params.get('response_type') !== 'code') throw new Error('OAUTH_UNSUPPORTED_RESPONSE_TYPE');
  const client = store.getClient(params.get('client_id'));
  if (!client) throw new Error('OAUTH_INVALID_CLIENT');
  const redirectUri = String(params.get('redirect_uri') || '');
  if (!client.redirect_uris.includes(redirectUri)) throw new Error('OAUTH_INVALID_REDIRECT_URI');
  if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) throw new Error('OAUTH_PKCE_REQUIRED');
  const resource = String(params.get('resource') || '');
  if (resource !== `${origin}/mcp`) throw new Error('OAUTH_INVALID_RESOURCE');
  const scope = String(params.get('scope') || 'persistflow');
  if (scope.split(/\s+/).filter(Boolean).some((item) => item !== 'persistflow')) throw new Error('OAUTH_INVALID_SCOPE');
  return { client, redirectUri, resource, scope };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}

function authorizationPage(params, client) {
  const hidden = [...params.entries()].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar PersistFlow</title></head><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>Autorizar PersistFlow</h1><p><strong>${escapeHtml(client.client_name)}</strong> quer acessar seu controlador durável.</p><p style="word-break:break-all">Retorno: ${escapeHtml(params.get('redirect_uri'))}</p><form method="post" action="/oauth/authorize">${hidden}<label>Chave do proprietário<br><input name="owner_secret" type="password" autocomplete="current-password" required style="width:100%;padding:10px;margin:8px 0 16px"></label><button type="submit" style="padding:10px 18px">Autorizar</button></form></body></html>`;
}

function protectedResourceMetadata(origin) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['persistflow'],
    bearer_methods_supported: ['header'],
  };
}

function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['persistflow'],
  };
}

function validateRegistration(body = {}) {
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
    throw new Error('OAUTH_INVALID_CLIENT_METADATA');
  }
  if (Array.isArray(body.response_types) && body.response_types.some((value) => value !== 'code')) {
    throw new Error('OAUTH_INVALID_CLIENT_METADATA');
  }
  if (Array.isArray(body.grant_types)
    && body.grant_types.some((value) => !['authorization_code', 'refresh_token'].includes(value))) {
    throw new Error('OAUTH_INVALID_CLIENT_METADATA');
  }
}
function createOAuthHttpHandler({ store, ownerTokenDigest = '' } = {}) {
  if (!store) throw new Error('OAUTH_STORE_REQUIRED');
  return async (req, res, url) => {
    const origin = requestOrigin(req);
    if (req.method === 'GET'
      && (url.pathname === '/.well-known/oauth-protected-resource'
        || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      sendJson(res, 200, protectedResourceMetadata(origin));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      sendJson(res, 200, authorizationServerMetadata(origin));
      return true;
    }
    if (url.pathname === '/oauth/authorize' && req.method === 'GET') {
      try {
        const params = url.searchParams;
        const { client } = validateAuthorization(params, store, origin);
        const body = authorizationPage(params, client);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      } catch (error) {
        sendJson(res, 400, { error: String(error.message || 'invalid_request').toLowerCase() });
      }
      return true;
    }
    if (url.pathname === '/oauth/authorize' && req.method === 'POST') {
      try {
        const params = await readForm(req);
        const grant = validateAuthorization(params, store, origin);
        if (!sameOwnerSecret(params.get('owner_secret'), ownerTokenDigest)) {
          res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end('<h1>Não autorizado</h1>');
          return true;
        }
        const code = store.issueAuthorizationCode({ clientId: grant.client.client_id, redirectUri: grant.redirectUri, codeChallenge: params.get('code_challenge'), resource: grant.resource, scope: grant.scope });
        const redirect = new URL(grant.redirectUri);
        redirect.searchParams.set('code', code);
        if (params.get('state')) redirect.searchParams.set('state', params.get('state'));
        res.writeHead(302, { location: redirect.href, 'cache-control': 'no-store' });
        res.end();
      } catch (error) {
        sendJson(res, 400, { error: String(error.message || 'invalid_request').toLowerCase() });
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/oauth/register') {
      try {
        const body = await readJson(req);
        validateRegistration(body);
        const client = store.registerClient(body);
        sendJson(res, 201, client);
      } catch (error) {
        sendJson(res, 400, {
          error: 'invalid_client_metadata',
          error_description: String(error.message || 'invalid client metadata'),
        });
      }
      return true;
    }
    return false;
  };
}

module.exports = {
  createOAuthHttpHandler,
  requestOrigin,
  protectedResourceMetadata,
  authorizationServerMetadata,
};
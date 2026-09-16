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
function createOAuthHttpHandler({ store } = {}) {
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
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./src/persistflow/http-server');
const { FileOAuthStore } = require('./src/persistflow/oauth-store');

async function withServer(run, { ownerTokenDigest = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-oauth-http-'));
  const oauthStore = new FileOAuthStore(dir);
  const server = createServer({ oauthStore, ownerTokenDigest });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  try { return await run({ origin, oauthStore }); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('publishes MCP protected-resource and OAuth authorization-server metadata', async () => {
  await withServer(async ({ origin }) => {
    for (const pathname of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await fetch(origin + pathname);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.resource, origin + '/mcp');
      assert.deepEqual(body.authorization_servers, [origin]);
    }

    const metadata = await fetch(origin + '/.well-known/oauth-authorization-server');
    assert.equal(metadata.status, 200);
    const body = await metadata.json();
    assert.equal(body.issuer, origin);
    assert.equal(body.authorization_endpoint, origin + '/oauth/authorize');
    assert.equal(body.token_endpoint, origin + '/oauth/token');
    assert.equal(body.registration_endpoint, origin + '/oauth/register');
    assert.deepEqual(body.code_challenge_methods_supported, ['S256']);
    assert.ok(body.grant_types_supported.includes('refresh_token'));
  });
});
test('dynamically registers a public OAuth client and persists exact redirect URIs', async () => {
  await withServer(async ({ origin, oauthStore }) => {
    const registration = await fetch(origin + '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/aip/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    assert.equal(registration.status, 201);
    const client = await registration.json();
    assert.ok(client.client_id.startsWith('pf_client_'));
    assert.equal(client.token_endpoint_auth_method, 'none');
    assert.deepEqual(oauthStore.getClient(client.client_id).redirect_uris, ['https://chatgpt.com/aip/oauth/callback']);

    const bad = await fetch(origin + '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.test/callback'] }),
    });
    assert.equal(bad.status, 400);
  });
});
test('authorization endpoint enforces PKCE/resource and owner approval', async () => {
  const crypto = require('node:crypto');
  const ownerSecret = 'owner-secret';
  const ownerTokenDigest = crypto.createHash('sha256').update(ownerSecret).digest('hex');
  await withServer(async ({ origin, oauthStore }) => {
    const redirectUri = 'https://chatgpt.com/aip/oauth/callback';
    const client = oauthStore.registerClient({ redirect_uris: [redirectUri], client_name: 'ChatGPT' });
    const verifier = 'x'.repeat(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({
      response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256', resource: origin + '/mcp',
      scope: 'persistflow', state: 'state-123',
    });

    const page = await fetch(origin + '/oauth/authorize?' + query);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Autorizar PersistFlow/);

    const wrong = await fetch(origin + '/oauth/authorize', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...Object.fromEntries(query), owner_secret: 'wrong' }),
      redirect: 'manual',
    });
    assert.equal(wrong.status, 401);

    const approved = await fetch(origin + '/oauth/authorize', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...Object.fromEntries(query), owner_secret: ownerSecret }),
      redirect: 'manual',
    });
    assert.equal(approved.status, 302);
    const location = new URL(approved.headers.get('location'));
    assert.equal(location.origin + location.pathname, redirectUri);
    assert.equal(location.searchParams.get('state'), 'state-123');
    assert.ok(location.searchParams.get('code').startsWith('pf_code_'));
  }, { ownerTokenDigest });
});
test('authorization code exchange authenticates MCP and refresh token rotates', async () => {
  const crypto = require('node:crypto');
  const ownerSecret = 'owner-secret';
  const ownerTokenDigest = crypto.createHash('sha256').update(ownerSecret).digest('hex');
  await withServer(async ({ origin, oauthStore }) => {
    const redirectUri = 'https://chatgpt.com/aip/oauth/callback';
    const clientReg = oauthStore.registerClient({ redirect_uris: [redirectUri], client_name: 'ChatGPT' });
    const verifier = 'z'.repeat(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const auth = new URLSearchParams({
      response_type: 'code', client_id: clientReg.client_id, redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256', resource: origin + '/mcp',
      scope: 'persistflow', state: 'token-state', owner_secret: ownerSecret,
    });
    const approved = await fetch(origin + '/oauth/authorize', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: auth, redirect: 'manual',
    });
    const code = new URL(approved.headers.get('location')).searchParams.get('code');

    const wrong = await fetch(origin + '/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientReg.client_id, redirect_uri: redirectUri, code_verifier: 'wrong', resource: origin + '/mcp' }),
    });
    assert.equal(wrong.status, 400);

    const exchanged = await fetch(origin + '/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientReg.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: origin + '/mcp' }),
    });
    assert.equal(exchanged.status, 200);
    const pair = await exchanged.json();
    assert.equal(pair.token_type, 'Bearer');
    assert.ok(pair.access_token);
    assert.ok(pair.refresh_token);
    const unauth = await fetch(origin + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get('www-authenticate') || '', /resource_metadata=/);

    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const mcpClient = new Client({ name: 'oauth-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(origin + '/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${pair.access_token}` } },
    });
    await mcpClient.connect(transport);
    try {
      const tools = await mcpClient.listTools();
      assert.ok(tools.tools.some((tool) => tool.name === 'persist_run_start'));
    } finally { await mcpClient.close(); }

    const refreshed = await fetch(origin + '/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: pair.refresh_token, client_id: clientReg.client_id, resource: origin + '/mcp' }),
    });
    assert.equal(refreshed.status, 200);
    const rotated = await refreshed.json();
    assert.ok(rotated.refresh_token);
    assert.notEqual(rotated.refresh_token, pair.refresh_token);

    const replay = await fetch(origin + '/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: pair.refresh_token, client_id: clientReg.client_id, resource: origin + '/mcp' }),
    });
    assert.equal(replay.status, 400);
  }, { ownerTokenDigest });
});
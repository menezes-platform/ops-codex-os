const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./src/persistflow/http-server');
const { FileOAuthStore } = require('./src/persistflow/oauth-store');

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-oauth-http-'));
  const oauthStore = new FileOAuthStore(dir);
  const server = createServer({ oauthStore });
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
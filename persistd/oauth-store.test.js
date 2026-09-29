const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { FileOAuthStore, pkceS256 } = require('./src/persistflow/oauth-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-oauth-'));
}

const resource = 'https://example.test/mcp';

test('OAuth client registration persists across store instances', () => {
  const dir = tempDir();
  try {
    const first = new FileOAuthStore(dir);
    const client = first.registerClient({ redirect_uris: ['https://chatgpt.com/callback'], client_name: 'ChatGPT' });
    const second = new FileOAuthStore(dir);
    assert.equal(second.getClient(client.client_id).client_name, 'ChatGPT');
    assert.deepEqual(second.getClient(client.client_id).redirect_uris, ['https://chatgpt.com/callback']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('authorization code requires matching PKCE and is one-time', () => {
  const dir = tempDir();
  try {
    const store = new FileOAuthStore(dir);
    const verifier = 'v'.repeat(64);
    const client = store.registerClient({ redirect_uris: ['https://chatgpt.com/callback'] });
    const code = store.issueAuthorizationCode({ clientId: client.client_id, redirectUri: client.redirect_uris[0], codeChallenge: pkceS256(verifier), resource, scope: 'persistflow' });
    assert.throws(() => store.redeemAuthorizationCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier: 'wrong', resource }), /OAUTH_INVALID_GRANT/);
    const grant = store.redeemAuthorizationCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier: verifier, resource });
    assert.equal(grant.resource, resource);
    assert.throws(() => store.redeemAuthorizationCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier: verifier, resource }), /OAUTH_INVALID_GRANT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('access token is resource-bound and refresh token rotates', () => {
  const dir = tempDir();
  try {
    let now = 1_700_000_000_000;
    const store = new FileOAuthStore(dir, { clock: () => now });
    const client = store.registerClient({ redirect_uris: ['https://chatgpt.com/callback'] });
    const pair = store.issueTokenPair({ clientId: client.client_id, resource, scope: 'persistflow' });
    assert.equal(store.validateAccessToken(pair.access_token, resource).clientId, client.client_id);
    assert.equal(store.validateAccessToken(pair.access_token, 'https://evil.test/mcp'), null);

    const rotated = store.rotateRefreshToken({ refreshToken: pair.refresh_token, clientId: client.client_id, resource });
    assert.ok(rotated.access_token);
    assert.ok(rotated.refresh_token);
    assert.notEqual(rotated.refresh_token, pair.refresh_token);
    assert.throws(() => store.rotateRefreshToken({ refreshToken: pair.refresh_token, clientId: client.client_id, resource }), /OAUTH_INVALID_GRANT/);

    now += 3_600_001;
    assert.equal(store.validateAccessToken(rotated.access_token, resource), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redirect URI validator allows HTTPS and loopback HTTP only', () => {
  const { isAllowedRedirectUri } = require('./src/persistflow/oauth-store');
  assert.equal(isAllowedRedirectUri('https://chatgpt.com/callback'), true);
  assert.equal(isAllowedRedirectUri('http://127.0.0.1:3939/callback'), true);
  assert.equal(isAllowedRedirectUri('http://localhost:3939/callback'), true);
  assert.equal(isAllowedRedirectUri('http://evil.test/callback'), false);
});

test('owner digest rotation preserves clients and revokes codes/access/refresh tokens', () => {
  const dir = tempDir();
  try {
    const store = new FileOAuthStore(dir);
    const redirectUri = 'https://chatgpt.com/callback';
    const client = store.registerClient({ redirect_uris: [redirectUri], client_name: 'ChatGPT' });
    const verifier = 'v'.repeat(64);
    const code = store.issueAuthorizationCode({
      clientId: client.client_id,
      redirectUri,
      codeChallenge: pkceS256(verifier),
      resource,
      scope: 'persistflow',
    });
    const pair = store.issueTokenPair({ clientId: client.client_id, resource, scope: 'persistflow' });

    const first = store.synchronizeOwnerTokenDigest('a'.repeat(64));
    assert.equal(first.changed, true);
    assert.equal(first.previousPresent, false);
    assert.equal(store.getClient(client.client_id).client_name, 'ChatGPT');
    assert.equal(store.validateAccessToken(pair.access_token, resource), null);
    assert.throws(
      () => store.rotateRefreshToken({ refreshToken: pair.refresh_token, clientId: client.client_id, resource }),
      /OAUTH_INVALID_GRANT/,
    );
    assert.throws(
      () => store.redeemAuthorizationCode({ code, clientId: client.client_id, redirectUri, codeVerifier: verifier, resource }),
      /OAUTH_INVALID_GRANT/,
    );

    const fresh = store.issueTokenPair({ clientId: client.client_id, resource, scope: 'persistflow' });
    const same = store.synchronizeOwnerTokenDigest('a'.repeat(64));
    assert.equal(same.changed, false);
    assert.equal(store.validateAccessToken(fresh.access_token, resource).clientId, client.client_id);

    const rotated = store.synchronizeOwnerTokenDigest('b'.repeat(64));
    assert.equal(rotated.changed, true);
    assert.equal(rotated.previousPresent, true);
    assert.equal(store.getClient(client.client_id).client_name, 'ChatGPT');
    assert.equal(store.validateAccessToken(fresh.access_token, resource), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

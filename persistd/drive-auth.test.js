const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DriveTokenProvider,
  createDriveTokenProviderFromEnv,
  resolveDriveAuthMaterial,
} = require('./src/storage/drive-auth');

test('DriveTokenProvider refreshes once and caches until sixty seconds before expiry', async () => {
  let calls = 0;
  const provider = new DriveTokenProvider({
    clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', rootId: 'root',
    clock: () => Date.parse('2026-09-24T17:00:00.000Z'),
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(init.method, 'POST');
      assert.match(String(init.body), /grant_type=refresh_token/);
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-1', expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file', token_type: 'Bearer',
        }),
      };
    },
  });
  const first = await provider.getAccess();
  const second = await provider.getAccess();
  assert.equal(calls, 1);
  assert.equal(first.accessToken, 'access-1');
  assert.equal(second.rootId, 'root');
  assert.equal(first.expiresAt, '2026-09-24T18:00:00.000Z');
});

test('DriveTokenProvider rejects a token response without drive.file scope', async () => {
  const provider = new DriveTokenProvider({
    clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', rootId: 'root',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ access_token: 'a', expires_in: 3600, scope: 'openid email' }),
    }),
  });
  await assert.rejects(() => provider.getAccess(), /DRIVE_SCOPE_MISMATCH/);
});

test('createDriveTokenProviderFromEnv stays disabled unless every central value exists', () => {
  assert.equal(createDriveTokenProviderFromEnv({}), null);
  const provider = createDriveTokenProviderFromEnv({
    GOOGLE_DRIVE_CLIENT_ID: 'id',
    GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
    GABRIEL_DRIVE_ROOT_ID: 'root',
  }, { fetchImpl: async () => { throw new Error('unused'); } });
  assert.ok(provider instanceof DriveTokenProvider);
  assert.equal(JSON.stringify(provider).includes('refresh'), false);
  assert.equal(JSON.stringify(provider).includes('secret'), false);
});

test('Drive auth material loads OAuth client, refresh token, and root id from secure files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-file-auth-'));
  fs.writeFileSync(path.join(dir, 'google-drive-oauth-client.json'), JSON.stringify({
    installed: { client_id: 'file-client', client_secret: 'file-secret' },
  }));
  fs.writeFileSync(path.join(dir, 'google-drive-refresh-token'), 'file-refresh\n');
  fs.writeFileSync(path.join(dir, 'drive-store.json'), JSON.stringify({ rootId: 'file-root' }));

  const material = resolveDriveAuthMaterial({ PERSISTFLOW_DATA_DIR: dir });
  assert.deepEqual(material, {
    clientId: 'file-client',
    clientSecret: 'file-secret',
    refreshToken: 'file-refresh',
    rootId: 'file-root',
  });

  const provider = createDriveTokenProviderFromEnv(
    { PERSISTFLOW_DATA_DIR: dir },
    { fetchImpl: async () => { throw new Error('unused'); } },
  );
  assert.ok(provider instanceof DriveTokenProvider);
  assert.equal(provider.rootId, 'file-root');
  assert.equal(JSON.stringify(provider).includes('file-secret'), false);
  assert.equal(JSON.stringify(provider).includes('file-refresh'), false);
});

test('explicit Drive env values override secure-file values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-file-override-'));
  fs.writeFileSync(path.join(dir, 'google-drive-oauth-client.json'), JSON.stringify({
    installed: { client_id: 'file-client', client_secret: 'file-secret' },
  }));
  fs.writeFileSync(path.join(dir, 'google-drive-refresh-token'), 'file-refresh\n');
  fs.writeFileSync(path.join(dir, 'drive-store.json'), JSON.stringify({ rootId: 'file-root' }));

  const material = resolveDriveAuthMaterial({
    PERSISTFLOW_DATA_DIR: dir,
    GOOGLE_DRIVE_CLIENT_ID: 'env-client',
    GOOGLE_DRIVE_CLIENT_SECRET: 'env-secret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'env-refresh',
    GABRIEL_DRIVE_ROOT_ID: 'env-root',
  });
  assert.deepEqual(material, {
    clientId: 'env-client',
    clientSecret: 'env-secret',
    refreshToken: 'env-refresh',
    rootId: 'env-root',
  });
});

test('invalid secure Drive JSON fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-file-invalid-'));
  fs.writeFileSync(path.join(dir, 'google-drive-oauth-client.json'), '{nope');
  assert.throws(
    () => resolveDriveAuthMaterial({ PERSISTFLOW_DATA_DIR: dir }),
    /DRIVE_OAUTH_CLIENT_FILE_INVALID/,
  );
});

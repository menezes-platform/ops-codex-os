const test = require('node:test');
const assert = require('node:assert/strict');
const { DriveTokenProvider, createDriveTokenProviderFromEnv } = require('./src/storage/drive-auth');

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

test('createDriveTokenProviderFromEnv stays disabled unless every central credential exists', () => {
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

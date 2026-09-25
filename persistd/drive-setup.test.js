const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildAuthorizationUrl,
  writeRefreshToken,
  oauthClientMaterial,
} = require('./scripts/authorize-drive');
const {
  bootstrapDriveStore,
  createBootstrapTokenProvider,
} = require('./scripts/bootstrap-drive-store');

test('authorization helper requests offline drive.file consent without embedding secrets in URL', () => {
  const url = new URL(buildAuthorizationUrl({
    clientId: 'client-id',
    redirectUri: 'http://127.0.0.1:4567/callback',
    state: 'state-1',
  }));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('client_secret'), null);
});

test('refresh token writer creates a mode-0600 file and never needs access token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-authz-'));
  const target = writeRefreshToken(dir, 'refresh-1');
  assert.equal(fs.readFileSync(target, 'utf8'), 'refresh-1\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});

test('authorization can load desktop OAuth client from secure local file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-auth-file-'));
  fs.writeFileSync(path.join(dir, 'google-drive-oauth-client.json'), JSON.stringify({
    installed: { client_id: 'client-file', client_secret: 'secret-file' },
  }));
  assert.deepEqual(oauthClientMaterial({ PERSISTFLOW_DATA_DIR: dir }), {
    clientId: 'client-file',
    clientSecret: 'secret-file',
  });
});

test('bootstrap token provider loads client and refresh token from secure files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-bootstrap-auth-'));
  fs.writeFileSync(path.join(dir, 'google-drive-oauth-client.json'), JSON.stringify({
    installed: { client_id: 'client-file', client_secret: 'secret-file' },
  }));
  fs.writeFileSync(path.join(dir, 'google-drive-refresh-token'), 'refresh-file\n');

  const provider = createBootstrapTokenProvider(
    { PERSISTFLOW_DATA_DIR: dir },
    { fetchImpl: async () => { throw new Error('unused'); } },
  );
  assert.equal(provider.rootId, 'root');
  assert.equal(JSON.stringify(provider).includes('secret-file'), false);
  assert.equal(JSON.stringify(provider).includes('refresh-file'), false);
});

test('bootstrap creates one dedicated Drive root and then reuses recorded id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-bootstrap-'));
  const calls = [];
  const client = {
    createFolder: async (name, parentId) => {
      calls.push({ name, parentId });
      return { id: 'root-created' };
    },
  };

  const first = await bootstrapDriveStore({ dataDir: dir, client });
  const second = await bootstrapDriveStore({ dataDir: dir, client });

  assert.deepEqual(calls, [{ name: 'Gabriel Object Store', parentId: 'root' }]);
  assert.equal(first.rootId, 'root-created');
  assert.equal(first.reused, false);
  assert.equal(second.rootId, 'root-created');
  assert.equal(second.reused, true);

  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'drive-store.json'), 'utf8'));
  assert.deepEqual(saved, { rootId: 'root-created' });
});

test('bootstrap fails closed on malformed recorded store config', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-bootstrap-invalid-'));
  fs.writeFileSync(path.join(dir, 'drive-store.json'), '{invalid');
  await assert.rejects(
    () => bootstrapDriveStore({
      dataDir: dir,
      client: { createFolder: async () => ({ id: 'should-not-run' }) },
    }),
    /DRIVE_STORE_CONFIG_INVALID/,
  );
});

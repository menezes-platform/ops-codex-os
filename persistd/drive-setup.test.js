const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildAuthorizationUrl, writeRefreshToken } = require('./scripts/authorize-drive');
const { bootstrapDriveStore } = require('./scripts/bootstrap-drive-store');

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

test('bootstrap creates exactly one dedicated Drive root and persists only its id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-bootstrap-'));
  const calls = [];
  const result = await bootstrapDriveStore({
    dataDir: dir,
    client: {
      createFolder: async (name, parentId) => {
        calls.push({ name, parentId });
        return { id: 'root-created' };
      },
    },
  });
  assert.deepEqual(calls, [{ name: 'Gabriel Object Store', parentId: 'root' }]);
  assert.equal(result.rootId, 'root-created');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'drive-store.json'), 'utf8'));
  assert.deepEqual(saved, { rootId: 'root-created' });
});

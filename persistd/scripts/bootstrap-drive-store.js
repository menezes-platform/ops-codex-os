const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DriveClient } = require('../src/storage/drive-client');
const { DriveTokenProvider } = require('../src/storage/drive-auth');

function dataDir(env = process.env) {
  return env.PERSISTFLOW_DATA_DIR || path.join(os.homedir(), '.persistflow-data');
}

async function bootstrapDriveStore({ client, dataDir: targetDir } = {}) {
  if (!client) throw new Error('DRIVE_CLIENT_REQUIRED');
  if (!targetDir) throw new Error('PERSISTFLOW_DATA_DIR_REQUIRED');
  const root = await client.createFolder('Gabriel Object Store', 'root');
  if (!root?.id) throw new Error('DRIVE_ROOT_CREATE_FAILED');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, 'drive-store.json');
  fs.writeFileSync(target, JSON.stringify({ rootId: String(root.id) }) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch {}
  return { rootId: String(root.id), path: target };
}

async function main(env = process.env) {
  const clientId = String(env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  if (!clientId || !clientSecret || !refreshToken) throw new Error('DRIVE_AUTH_CONFIG_INCOMPLETE');
  const provider = new DriveTokenProvider({ clientId, clientSecret, refreshToken, rootId: 'root' });
  const client = new DriveClient({ tokenProvider: () => provider.getAccess() });
  const result = await bootstrapDriveStore({ client, dataDir: dataDir(env) });
  process.stdout.write('Drive store root id recorded: ' + result.rootId + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { bootstrapDriveStore, dataDir };

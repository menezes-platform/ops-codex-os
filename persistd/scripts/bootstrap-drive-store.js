const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DriveClient } = require('../src/storage/drive-client');
const {
  DriveTokenProvider,
  resolveDriveAuthMaterial,
} = require('../src/storage/drive-auth');

function dataDir(env = process.env) {
  return env.PERSISTFLOW_DATA_DIR || path.join(os.homedir(), '.persistflow-data');
}

function existingStore(targetDir) {
  const target = path.join(targetDir, 'drive-store.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    const rootId = String(parsed?.rootId || '').trim();
    return rootId ? { rootId, path: target, reused: true } : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('DRIVE_STORE_CONFIG_INVALID');
    throw error;
  }
}

async function bootstrapDriveStore({ client, dataDir: targetDir } = {}) {
  if (!client) throw new Error('DRIVE_CLIENT_REQUIRED');
  if (!targetDir) throw new Error('PERSISTFLOW_DATA_DIR_REQUIRED');
  const existing = existingStore(targetDir);
  if (existing) return existing;

  const root = await client.createFolder('Gabriel Object Store', 'root');
  if (!root?.id) throw new Error('DRIVE_ROOT_CREATE_FAILED');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, 'drive-store.json');
  fs.writeFileSync(target, JSON.stringify({ rootId: String(root.id) }) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  try { fs.chmodSync(target, 0o600); } catch {}
  return { rootId: String(root.id), path: target, reused: false };
}

function createBootstrapTokenProvider(env = process.env, options = {}) {
  const { homedir, ...providerOptions } = options;
  const material = resolveDriveAuthMaterial(env, {
    homedir,
    rootIdOverride: 'root',
  });
  if (Object.values(material).filter(Boolean).length !== 4) {
    throw new Error('DRIVE_AUTH_CONFIG_INCOMPLETE');
  }
  return new DriveTokenProvider({ ...material, ...providerOptions });
}

async function main(env = process.env) {
  const provider = createBootstrapTokenProvider(env);
  const client = new DriveClient({ tokenProvider: () => provider.getAccess() });
  const result = await bootstrapDriveStore({ client, dataDir: dataDir(env) });
  process.stdout.write(
    (result.reused ? 'Drive store root reused: ' : 'Drive store root id recorded: ')
      + result.rootId + '\n',
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(String(error?.message || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  bootstrapDriveStore,
  createBootstrapTokenProvider,
  existingStore,
  dataDir,
};

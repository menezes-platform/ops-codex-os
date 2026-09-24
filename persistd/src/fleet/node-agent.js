const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signNodeRequest } = require('./auth');
const { normalizeHeartbeat } = require('./contracts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cpuTotals(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += Number(cpu.times.idle || 0);
    total += Object.values(cpu.times).reduce((sum, value) => sum + Number(value || 0), 0);
  }
  return { idle, total };
}

async function sampleCpuPercent({ cpus = () => os.cpus(), wait = sleep, intervalMs = 250 } = {}) {
  const before = cpuTotals(cpus());
  await wait(intervalMs);
  const after = cpuTotals(cpus());
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
}

function defaultCacheRoot() {
  if (process.env.GABRIEL_CACHE_DIR) return process.env.GABRIEL_CACHE_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Gabriel', 'object-cache');
  }
  return path.join(os.homedir(), '.cache', 'gabriel', 'object-cache');
}

async function readCacheInventory(cacheRoot = defaultCacheRoot()) {
  const indexPath = path.join(cacheRoot, 'index.json');
  try {
    const parsed = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'));
    const rows = Array.isArray(parsed.entries)
      ? parsed.entries
      : Object.values(parsed.entries || {});
    const sorted = rows
      .filter((row) => row && /^[0-9a-f]{64}$/i.test(String(row.sha256 || '')))
      .sort((a, b) => String(b.lastAccessAt || '').localeCompare(String(a.lastAccessAt || '')));
    return {
      cacheBytes: sorted.reduce((sum, row) => sum + Number(row.size || 0), 0),
      cachedObjectHashes: sorted.slice(0, 256).map((row) => String(row.sha256).toLowerCase()),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { cacheBytes: 0, cachedObjectHashes: [] };
    throw error;
  }
}

async function collectHeartbeat({
  cacheRoot = defaultCacheRoot(),
  statfs = fs.promises.statfs,
  memory = () => ({ freeMemoryBytes: os.freemem(), totalMemoryBytes: os.totalmem() }),
  cpuSampler = () => sampleCpuPercent(),
  hostname = () => os.hostname(),
  activeJobs = () => Number(process.env.PERSISTFLOW_FLEET_ACTIVE_JOBS || 0),
  cacheInventory = readCacheInventory,
  capabilities = String(process.env.PERSISTFLOW_FLEET_CAPABILITIES || '')
    .split(',').map((value) => value.trim()).filter(Boolean),
  runtimeVersion = process.env.npm_package_version || '2.0.0',
  now = () => new Date(),
} = {}) {
  const disk = await statfs(cacheRoot);
  const bsize = Number(disk.bsize);
  const totals = memory();
  const uniqueCapabilities = [...new Set(capabilities.map(String))].sort();
  const inventory = await cacheInventory(cacheRoot);
  return normalizeHeartbeat({
    observedAt: now().toISOString(),
    hostname: hostname(),
    freeDiskBytes: Math.floor(bsize * Number(disk.bavail)),
    totalDiskBytes: Math.floor(bsize * Number(disk.blocks)),
    freeMemoryBytes: Math.floor(Number(totals.freeMemoryBytes)),
    totalMemoryBytes: Math.floor(Number(totals.totalMemoryBytes)),
    cpuPercent: Number((await cpuSampler()).toFixed(2)),
    activeJobs: Math.floor(Number(activeJobs())),
    cacheBytes: Math.floor(Number(inventory.cacheBytes || 0)),
    cachedObjectHashes: [...new Set(inventory.cachedObjectHashes || [])],
    runtimeVersion: String(runtimeVersion || ''),
    capabilitiesHash: crypto.createHash('sha256')
      .update(JSON.stringify(uniqueCapabilities), 'utf8')
      .digest('hex'),
  });
}

async function postHeartbeat({
  baseUrl,
  nodeId,
  secret,
  heartbeat,
  timestamp = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('PERSISTFLOW_BASE_URL_REQUIRED');
  if (!nodeId) throw new Error('FLEET_NODE_ID_REQUIRED');
  if (!secret) throw new Error('NODE_SECRET_REQUIRED');
  const requestPath = '/v1/fleet/nodes/' + encodeURIComponent(nodeId) + '/heartbeat';
  const body = JSON.stringify(heartbeat);
  const signature = signNodeRequest({
    nodeId, secret, timestamp, method: 'POST', path: requestPath, body,
  });
  const response = await fetchImpl(base + requestPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-persistflow-node-id': nodeId,
      'x-persistflow-node-timestamp': timestamp,
      'x-persistflow-node-signature': signature,
    },
    body,
  });
  if (!response.ok) {
    const error = new Error('FLEET_HEARTBEAT_HTTP_' + response.status);
    error.body = String(await response.text()).slice(0, 2048);
    throw error;
  }
}

async function runAgent({ env = process.env, intervalMs = 30_000 } = {}) {
  const baseUrl = env.PERSISTFLOW_BASE_URL;
  const nodeId = env.PERSISTFLOW_FLEET_NODE_ID;
  const secret = env.PERSISTFLOW_FLEET_NODE_SECRET;
  for (;;) {
    try {
      const heartbeat = await collectHeartbeat();
      await postHeartbeat({ baseUrl, nodeId, secret, heartbeat });
    } catch (error) {
      process.stderr.write('[fleet-agent] ' + String(error?.message || error) + '\n');
    }
    await sleep(intervalMs);
  }
}

if (require.main === module) {
  runAgent().catch((error) => {
    process.stderr.write(String(error?.stack || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  collectHeartbeat,
  postHeartbeat,
  runAgent,
  sampleCpuPercent,
  readCacheInventory,
  defaultCacheRoot,
};

const SECRET_KEYS = /(?:secret|token|password|credential|private[_-]?key)/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function finiteInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error('INVALID_' + name);
  return n;
}

function finiteNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('INVALID_' + name);
  return n;
}

function uniqueStrings(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('INVALID_' + name);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function assertNoSecretFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEYS.test(key)) throw new Error('FLEET_SECRET_FIELD_FORBIDDEN');
  }
}

function loadFleetConfig(value = {}) {
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const seen = new Set();
  return { nodes: nodes.map((node) => {
    assertNoSecretFields(node);
    const id = String(node.id || '').trim();
    if (!id) throw new Error('FLEET_NODE_ID_REQUIRED');
    if (seen.has(id)) throw new Error('FLEET_NODE_DUPLICATE');
    seen.add(id);
    return {
      id,
      platform: String(node.platform || 'unknown'),
      arch: String(node.arch || 'unknown'),
      capabilities: uniqueStrings(node.capabilities, 'CAPABILITIES'),
      affinities: uniqueStrings(node.affinities, 'AFFINITIES'),
      concurrencyLimit: finiteInt(node.concurrencyLimit ?? 1, 'CONCURRENCY_LIMIT'),
      drained: node.drained === true,
    };
  }) };
}

function normalizeHeartbeat(value = {}) {
  const hashes = uniqueStrings(value.cachedObjectHashes, 'CACHED_HASHES');
  if (hashes.some((hash) => !SHA256.test(hash))) throw new Error('INVALID_CACHED_HASH');
  const observedAt = String(value.observedAt || '');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('INVALID_OBSERVED_AT');
  const freeDiskBytes = finiteInt(value.freeDiskBytes, 'FREE_DISK_BYTES');
  const totalDiskBytes = finiteInt(value.totalDiskBytes, 'TOTAL_DISK_BYTES');
  const freeMemoryBytes = finiteInt(value.freeMemoryBytes, 'FREE_MEMORY_BYTES');
  const totalMemoryBytes = finiteInt(value.totalMemoryBytes, 'TOTAL_MEMORY_BYTES');
  const cpuPercent = finiteNumber(value.cpuPercent, 'CPU_PERCENT');
  if (cpuPercent < 0 || cpuPercent > 100) throw new Error('INVALID_CPU_PERCENT');
  if (freeDiskBytes > totalDiskBytes) throw new Error('INVALID_DISK_RANGE');
  if (freeMemoryBytes > totalMemoryBytes) throw new Error('INVALID_MEMORY_RANGE');
  return {
    observedAt,
    hostname: String(value.hostname || ''),
    freeDiskBytes,
    totalDiskBytes,
    freeMemoryBytes,
    totalMemoryBytes,
    cpuPercent,
    activeJobs: finiteInt(value.activeJobs ?? 0, 'ACTIVE_JOBS'),
    cacheBytes: finiteInt(value.cacheBytes ?? 0, 'CACHE_BYTES'),
    cachedObjectHashes: hashes,
    runtimeVersion: String(value.runtimeVersion || ''),
    capabilitiesHash: String(value.capabilitiesHash || ''),
  };
}

function normalizeRouteIntent(value = {}) {
  const taskId = String(value.taskId || '').trim();
  const summary = String(value.summary || '').trim();
  if (!taskId) throw new Error('TASK_ID_REQUIRED');
  if (!summary || summary.length > 2000) throw new Error('TASK_SUMMARY_INVALID');
  const artifactRefs = uniqueStrings(value.artifactRefs, 'ARTIFACT_REFS');
  for (const ref of artifactRefs) {
    if (!/^sha256:[0-9a-f]{64}$/i.test(ref)) throw new Error('INVALID_ARTIFACT_REF');
  }
  return {
    taskId,
    summary,
    repo: value.repo ? String(value.repo) : null,
    ref: value.ref ? String(value.ref) : null,
    requiredCapabilities: uniqueStrings(value.requiredCapabilities, 'REQUIRED_CAPABILITIES'),
    preferredCapabilities: uniqueStrings(value.preferredCapabilities, 'PREFERRED_CAPABILITIES'),
    estimatedScratchBytes: finiteInt(value.estimatedScratchBytes ?? 0, 'ESTIMATED_SCRATCH_BYTES'),
    artifactRefs,
    requiresInteractiveUi: value.requiresInteractiveUi === true,
    requiresGpu: value.requiresGpu === true,
    parallelSafe: value.parallelSafe === true,
    pinnedNodeId: value.pinnedNodeId ? String(value.pinnedNodeId) : null,
  };
}

module.exports = { loadFleetConfig, normalizeHeartbeat, normalizeRouteIntent };

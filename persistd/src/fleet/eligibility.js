const { evictionReserves } = require('../storage/cache-manager');

function requiredCapabilities(intent) {
  const set = new Set(intent.requiredCapabilities || []);
  if (intent.requiresInteractiveUi) set.add('interactive-ui');
  if (intent.requiresGpu) set.add('gpu');
  return set;
}

function requestedHashes(intent) {
  return new Set((intent.artifactRefs || [])
    .map((ref) => /^sha256:([0-9a-f]{64})$/i.exec(String(ref))?.[1]?.toLowerCase())
    .filter(Boolean));
}

function eligibleNodes({ config, snapshot, intent } = {}) {
  const rows = new Map((snapshot?.nodes || []).map((row) => [row.nodeId, row]));
  const required = requiredCapabilities(intent || {});
  const wantedHashes = requestedHashes(intent || {});
  const candidates = [];

  for (const node of config?.nodes || []) {
    if (!node?.id || node.drained === true) continue;
    if (intent?.pinnedNodeId && node.id !== intent.pinnedNodeId) continue;

    const observed = rows.get(node.id);
    if (!observed || observed.fresh !== true || !observed.heartbeat) continue;
    const hb = observed.heartbeat;

    const caps = new Set(node.capabilities || []);
    if ([...required].some((capability) => !caps.has(capability))) continue;
    if (Number(hb.activeJobs || 0) >= Number(node.concurrencyLimit || 1)) continue;

    const freeDiskBytes = Number(hb.freeDiskBytes);
    const totalDiskBytes = Number(hb.totalDiskBytes);
    const scratch = Number(intent?.estimatedScratchBytes || 0);
    if (!Number.isFinite(freeDiskBytes) || !Number.isFinite(totalDiskBytes) || totalDiskBytes <= 0) continue;
    const { startReserve } = evictionReserves(totalDiskBytes);
    if (freeDiskBytes - scratch < startReserve) continue;

    const cached = new Set((hb.cachedObjectHashes || []).map((hash) => String(hash).toLowerCase()));
    let cachedArtifactCount = 0;
    for (const hash of wantedHashes) if (cached.has(hash)) cachedArtifactCount += 1;

    candidates.push({
      id: node.id,
      platform: node.platform || 'unknown',
      capabilities: [...(node.capabilities || [])],
      affinities: [...(node.affinities || [])],
      freeDiskBytes,
      totalDiskBytes,
      freeMemoryBytes: Number(hb.freeMemoryBytes),
      totalMemoryBytes: Number(hb.totalMemoryBytes),
      cpuPercent: Number(hb.cpuPercent),
      activeJobs: Number(hb.activeJobs || 0),
      cachedArtifactCount,
    });
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

function deterministicOrder(candidates, intent) {
  const scratch = Number(intent?.estimatedScratchBytes || 0);
  return [...candidates].sort((a, b) => {
    if (b.cachedArtifactCount !== a.cachedArtifactCount) return b.cachedArtifactCount - a.cachedArtifactCount;
    const aRatio = (a.freeDiskBytes - scratch) / a.totalDiskBytes;
    const bRatio = (b.freeDiskBytes - scratch) / b.totalDiskBytes;
    if (bRatio !== aRatio) return bRatio - aRatio;
    if (a.activeJobs !== b.activeJobs) return a.activeJobs - b.activeJobs;
    return a.id.localeCompare(b.id);
  });
}

module.exports = { eligibleNodes, deterministicOrder };

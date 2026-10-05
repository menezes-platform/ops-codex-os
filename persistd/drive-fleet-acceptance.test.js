const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');
const { PersistFlowService } = require('./src/persistflow/service');
const { MemoryFleetStore } = require('./src/fleet/store');
const { loadFleetConfig } = require('./src/fleet/contracts');
const { ProviderGatewayFleetRouter } = require('./src/fleet/provider-gateway-router');
const { FleetRouter } = require('./src/fleet/router');
const { DriveObjectStore } = require('./src/storage/object-store');
const { CacheManager } = require('./src/storage/cache-manager');
const { reconcileRemoteRun } = require('./src/persistflow/remote-bridge');
const { buildBatonV2 } = require('./src/persistflow/baton-v2');
const { DriveTokenProvider } = require('./src/storage/drive-auth');

const GiB = 1024 ** 3;
const NOW = '2026-09-24T17:00:30.000Z';

function heartbeat(freeDiskBytes, cachedObjectHashes = []) {
  return {
    observedAt: NOW, hostname: 'node',
    freeDiskBytes, totalDiskBytes: 500 * GiB,
    freeMemoryBytes: 32 * GiB, totalMemoryBytes: 64 * GiB,
    cpuPercent: 12, activeJobs: 0, cacheBytes: 0,
    cachedObjectHashes, runtimeVersion: 'acceptance', capabilitiesHash: '',
  };
}

test('end-to-end fake providers route work, persist evidence, store object, verify cache, and carry Baton node', async () => {
  const fleetConfig = loadFleetConfig({ nodes: [
    { id: 'desktop-primary', platform: 'win32', capabilities: ['git', 'node'], affinities: ['desktop'], concurrencyLimit: 1 },
    { id: 'ec2-primary', platform: 'win32', capabilities: ['git', 'node', 'remote-worker'], affinities: ['tests'], concurrencyLimit: 2 },
    { id: 'aws-vm', platform: 'linux', capabilities: ['git', 'node', 'remote-worker'], affinities: ['background'], concurrencyLimit: 1 },
  ] });
  const fleetStore = new MemoryFleetStore();
  fleetStore.putHeartbeat('desktop-primary', heartbeat(60 * GiB));
  fleetStore.putHeartbeat('ec2-primary', heartbeat(200 * GiB));
  fleetStore.putHeartbeat('aws-vm', heartbeat(180 * GiB));

  let providerGatewayRequest;
  const providerGatewayRouter = new ProviderGatewayFleetRouter({
    providerGateway: {
      infer: async (request) => {
        providerGatewayRequest = request;
        return {
          route_id: 'fleet-semantic-v1',
          usage: { input_tokens: 160, output_tokens: 12 },
          output: [{ role: 'assistant', content: JSON.stringify({ scores: { candidate_1: 1, candidate_2: 2 } }) }],
        };
      },
    },
  });
  const fleetRouter = new FleetRouter({
    fleetConfig, fleetStore, providerGatewayRouter,
    clock: () => new Date(NOW),
  });
  const authority = new MemoryAuthorityStore();
  const service = new PersistFlowService({
    store: authority, fleetStore, fleetConfig, fleetRouter,
    clock: () => new Date(NOW),
  });
  service.startRun({ runId: 'acceptance-run', generation: 1 });
  const routed = await service.routeTask('acceptance-run', {
    generation: 1,
    intent: {
      taskId: 'acceptance-task', summary: 'run bounded integration work',
      requiredCapabilities: ['git', 'node'], preferredCapabilities: [],
      estimatedScratchBytes: 20 * GiB, artifactRefs: [],
    },
  });
  assert.equal(routed.decision.nodeId, 'ec2-primary');
  assert.equal(routed.decision.decisionSource, 'provider-gateway');
  assert.deepEqual(routed.decision.eligibleNodeIds, ['aws-vm', 'ec2-primary']);
  assert.equal(routed.decision.providerRouteId, 'fleet-semantic-v1');
  assert.deepEqual(routed.decision.providerUsage, { input_tokens: 160, output_tokens: 12 });
  const gatewayPayload = JSON.parse(providerGatewayRequest.input[1].content);
  assert.deepEqual(gatewayPayload.candidates.map((row) => row.candidate_key), ['candidate_1', 'candidate_2']);
  assert.equal(providerGatewayRequest.freshness_required, true);
  assert.equal(routed.run.latestCheckpoint.evidence.type, 'fleet.route');

  const bytes = Buffer.from('durable acceptance payload');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-accept-input-'));
  const inputPath = path.join(inputDir, 'payload.bin');
  fs.writeFileSync(inputPath, bytes);
  const files = [];
  let pendingUpload;
  const fakeDriveClient = {
    async searchByHash(hash, { record } = {}) {
      return files.filter((file) =>
        file.appProperties?.gdb_sha256 === hash
        && (!record || file.appProperties?.gdb_record === record));
    },
    async startResumableUpload(input) {
      pendingUpload = input;
      return 'fake-session';
    },
    async uploadFileResumable() {
      const file = {
        id: 'blob-1', size: String(pendingUpload.size),
        md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
        name: pendingUpload.name, mimeType: pendingUpload.mimeType,
        appProperties: pendingUpload.appProperties,
      };
      files.push(file);
      return file;
    },
    async createJsonFile(input) {
      const file = { id: 'manifest-1', size: '1', name: input.name, appProperties: input.appProperties };
      files.push(file);
      return file;
    },
    async updateAppProperties() {},
  };
  const objectStore = new DriveObjectStore({
    client: fakeDriveClient, rootId: 'fake-root', clock: () => new Date(NOW),
  });
  const object = await objectStore.put(inputPath, { namespace: 'acceptance', kind: 'artifact' });
  assert.equal(object.ref, 'sha256:' + sha);
  assert.equal(object.durable, true);

  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-accept-cache-'));
  const cache = new CacheManager({
    cacheRoot, driveClient: fakeDriveClient,
    statfs: async () => ({ bsize: 1, bavail: 200 * GiB, blocks: 500 * GiB }),
    now: () => new Date(NOW),
  });
  const cachedPath = await cache.acquire(object.ref, async ({ targetPath }) => {
    const partialPath = targetPath + '.fake-download';
    fs.mkdirSync(path.dirname(partialPath), { recursive: true });
    fs.writeFileSync(partialPath, bytes);
    return { partialPath, fileId: object.fileId };
  });
  assert.deepEqual(fs.readFileSync(cachedPath), bytes);

  const reconciled = reconcileRemoteRun(
    { RUN_ID: 'acceptance-run', GENERATION: '1', DEVICE_ID: 'commander-device' },
    routed.run,
  );
  const baton = buildBatonV2(reconciled.state, 2);
  assert.equal(baton.machine.deviceId, 'commander-device');
  assert.equal(baton.machine.nodeId, 'ec2-primary');
});

test('Provider Gateway payload and persisted route evidence exclude configured secret sentinels', async () => {
  const sentinels = [
    'SHOULD_NOT_LEAK_CLIENT_SECRET',
    'SHOULD_NOT_LEAK_REFRESH',
    'SHOULD_NOT_LEAK_NODE_SECRET',
    'SHOULD_NOT_LEAK_TYPESAFE_KEY',
  ];
  let requestPayload;
  const scorer = new ProviderGatewayFleetRouter({
    providerGateway: {
      infer: async (request) => {
        requestPayload = request;
        return {
          route_id: 'fleet-semantic-v1',
          usage: { input_tokens: 200, output_tokens: 12 },
          output: [{ role: 'assistant', content: JSON.stringify({ scores: { candidate_1: 1, candidate_2: 2 } }) }],
        };
      },
    },
    env: {
      GOOGLE_DRIVE_CLIENT_SECRET: sentinels[0],
      GOOGLE_DRIVE_REFRESH_TOKEN: sentinels[1],
      PERSISTFLOW_FLEET_NODE_SECRETS_JSON: JSON.stringify({ 'desktop-primary': sentinels[2] }),
    },
    redactValues: [sentinels[3]],
  });
  const candidates = [
    {
      id: 'desktop-primary', platform: 'win32', capabilities: ['node'], affinities: [],
      freeDiskBytes: 200, totalDiskBytes: 500, freeMemoryBytes: 10, totalMemoryBytes: 20,
      cpuPercent: 10, activeJobs: 0, cachedArtifactCount: 0,
    },
    {
      id: 'ec2-primary', platform: 'win32', capabilities: ['node'], affinities: [],
      freeDiskBytes: 250, totalDiskBytes: 500, freeMemoryBytes: 10, totalMemoryBytes: 20,
      cpuPercent: 10, activeJobs: 0, cachedArtifactCount: 0,
    },
  ];
  const scores = await scorer.score({
    intent: {
      taskId: 'safe',
      summary: 'ordinary bounded task ' + sentinels.join(' '),
      requiredCapabilities: ['node'], preferredCapabilities: [],
      estimatedScratchBytes: 0, artifactRefs: [],
    },
    candidates,
  });
  assert.equal(scores.scores['ec2-primary'], 2);

  const serializedRequest = JSON.stringify(requestPayload);
  for (const sentinel of sentinels) assert.equal(serializedRequest.includes(sentinel), false);

  const provider = new DriveTokenProvider({
    clientId: 'id',
    clientSecret: sentinels[0],
    refreshToken: sentinels[1],
    rootId: 'root',
    fetchImpl: async () => { throw new Error('unused'); },
  });
  const serializedProvider = JSON.stringify(provider);
  assert.equal(serializedProvider.includes(sentinels[0]), false);
  assert.equal(serializedProvider.includes(sentinels[1]), false);

  const evidence = JSON.stringify({
    type: 'fleet.route',
    taskId: 'safe',
    nodeId: 'ec2-primary',
    decisionSource: 'provider-gateway',
    eligibleNodeIds: ['desktop-primary', 'ec2-primary'],
    evaluatedAt: NOW,
  });
  for (const sentinel of sentinels) assert.equal(evidence.includes(sentinel), false);
});

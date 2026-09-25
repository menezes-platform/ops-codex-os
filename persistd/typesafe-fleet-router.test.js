const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleNodes, deterministicOrder } = require('./src/fleet/eligibility');
const { TypeSafeFleetRouter } = require('./src/fleet/typesafe-router');
const { FleetRouter } = require('./src/fleet/router');

const GiB = 1024 ** 3;

function config() {
  return { nodes: [
    { id: 'desktop-primary', platform: 'win32', capabilities: ['git', 'node', 'interactive-ui'], affinities: ['desktop'], concurrencyLimit: 1, drained: false },
    { id: 'ec2-primary', platform: 'win32', capabilities: ['git', 'node', 'remote-worker'], affinities: ['tests'], concurrencyLimit: 2, drained: false },
    { id: 'drained', platform: 'linux', capabilities: ['git', 'node'], affinities: [], concurrencyLimit: 1, drained: true },
  ] };
}

function beat(nodeId, overrides = {}) {
  return {
    nodeId,
    fresh: true,
    heartbeat: {
      observedAt: '2026-09-24T17:00:00Z',
      hostname: nodeId,
      freeDiskBytes: 200 * GiB,
      totalDiskBytes: 500 * GiB,
      freeMemoryBytes: 20 * GiB,
      totalMemoryBytes: 64 * GiB,
      cpuPercent: 10,
      activeJobs: 0,
      cacheBytes: 0,
      cachedObjectHashes: [],
      runtimeVersion: '1',
      capabilitiesHash: '',
      ...overrides,
    },
  };
}

const baseIntent = {
  taskId: 'task-1',
  summary: 'run integration tests',
  repo: 'menezes-platform/ttk-live-dungeon',
  ref: 'abc',
  requiredCapabilities: ['git', 'node'],
  preferredCapabilities: [],
  estimatedScratchBytes: 10 * GiB,
  artifactRefs: [],
  requiresInteractiveUi: false,
  requiresGpu: false,
  parallelSafe: false,
  pinnedNodeId: null,
};

test('hard eligibility excludes stale, drained, missing capability, disk pressure, concurrency and pin mismatch', () => {
  let rows = eligibleNodes({
    config: config(),
    snapshot: { nodes: [
      beat('desktop-primary', { activeJobs: 1 }),
      { ...beat('ec2-primary'), fresh: false },
      beat('drained'),
    ] },
    intent: baseIntent,
  });
  assert.deepEqual(rows, []);

  rows = eligibleNodes({
    config: config(),
    snapshot: { nodes: [beat('desktop-primary'), beat('ec2-primary', { freeDiskBytes: 40 * GiB })] },
    intent: { ...baseIntent, requiresInteractiveUi: true, estimatedScratchBytes: 1 * GiB },
  });
  assert.deepEqual(rows.map((row) => row.id), ['desktop-primary']);

  rows = eligibleNodes({
    config: config(),
    snapshot: { nodes: [beat('desktop-primary'), beat('ec2-primary')] },
    intent: { ...baseIntent, requiredCapabilities: ['gpu'] },
  });
  assert.deepEqual(rows, []);

  rows = eligibleNodes({
    config: config(),
    snapshot: { nodes: [beat('desktop-primary'), beat('ec2-primary')] },
    intent: { ...baseIntent, pinnedNodeId: 'ec2-primary' },
  });
  assert.deepEqual(rows.map((row) => row.id), ['ec2-primary']);
});

test('deterministic order prefers locality then disk headroom then fewer jobs then node id', () => {
  const artifact = 'a'.repeat(64);
  const intent = { ...baseIntent, artifactRefs: ['sha256:' + artifact] };
  const rows = eligibleNodes({
    config: config(),
    snapshot: { nodes: [
      beat('desktop-primary', { cachedObjectHashes: [artifact], activeJobs: 0 }),
      beat('ec2-primary', { cachedObjectHashes: [], activeJobs: 0 }),
    ] },
    intent,
  });
  assert.equal(deterministicOrder(rows, intent)[0].id, 'desktop-primary');
});

test('TypeSafe receives only eligible bounded candidates and validates score answers', async () => {
  let requestBody;
  const scorer = new TypeSafeFleetRouter({
    apiKey: 'key',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          answers: {
            candidate__desktop_primary: { type: 'score', score: 1 },
            candidate__ec2_primary: { type: 'score', score: 2 },
            candidate__ghost: { type: 'score', score: 2 },
          },
        }),
      };
    },
  });
  const scores = await scorer.score({
    intent: baseIntent,
    candidates: eligibleNodes({
      config: config(),
      snapshot: { nodes: [beat('desktop-primary'), beat('ec2-primary')] },
      intent: baseIntent,
    }),
  });
  assert.deepEqual(scores, { 'desktop-primary': 1, 'ec2-primary': 2 });
  assert.deepEqual(requestBody.state.candidates.map((row) => row.id), ['desktop-primary', 'ec2-primary']);
  assert.equal(JSON.stringify(requestBody.state).includes('key'), false);
});

test('FleetRouter selects highest valid TypeSafe score and never selects an ineligible answer', async () => {
  const fleetRouter = new FleetRouter({
    fleetConfig: config(),
    fleetStore: {
      snapshot: () => ({ nodes: [
        beat('desktop-primary'),
        beat('ec2-primary'),
        beat('drained'),
      ] }),
    },
    typesafeRouter: {
      score: async () => ({ 'desktop-primary': 0, 'ec2-primary': 2, drained: 99 }),
    },
    clock: () => new Date('2026-09-24T17:01:00Z'),
  });
  const decision = await fleetRouter.route(baseIntent);
  assert.equal(decision.nodeId, 'ec2-primary');
  assert.equal(decision.decisionSource, 'typesafe');
  assert.deepEqual(decision.eligibleNodeIds, ['desktop-primary', 'ec2-primary']);
});

test('FleetRouter falls back deterministically when TypeSafe errors or returns malformed scores', async () => {
  for (const score of [
    async () => { throw new Error('typesafe_http_500'); },
    async () => ({ 'desktop-primary': NaN, 'ec2-primary': 2 }),
  ]) {
    const fleetRouter = new FleetRouter({
      fleetConfig: config(),
      fleetStore: { snapshot: () => ({ nodes: [beat('desktop-primary'), beat('ec2-primary')] }) },
      typesafeRouter: { score },
      clock: () => new Date('2026-09-24T17:01:00Z'),
    });
    const decision = await fleetRouter.route(baseIntent);
    assert.equal(decision.decisionSource, 'deterministic-fallback');
    assert.ok(['desktop-primary', 'ec2-primary'].includes(decision.nodeId));
    assert.match(decision.typesafeError, /typesafe/i);
  }
});

test('FleetRouter uses single-candidate fallback and blocks when no node is eligible', async () => {
  const one = new FleetRouter({
    fleetConfig: config(),
    fleetStore: { snapshot: () => ({ nodes: [beat('ec2-primary')] }) },
    typesafeRouter: { score: async () => { throw new Error('should not call'); } },
  });
  const decision = await one.route(baseIntent);
  assert.equal(decision.nodeId, 'ec2-primary');
  assert.equal(decision.decisionSource, 'single-candidate-fallback');

  const none = new FleetRouter({
    fleetConfig: config(),
    fleetStore: { snapshot: () => ({ nodes: [] }) },
  });
  await assert.rejects(() => none.route(baseIntent), /NO_ELIGIBLE_NODE/);
});

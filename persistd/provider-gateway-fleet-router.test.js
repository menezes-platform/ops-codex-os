const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleNodes, deterministicOrder } = require('./src/fleet/eligibility');
const { ProviderGatewayFleetRouter, collectSecretValues, redactText } = require('./src/fleet/provider-gateway-router');
const { FleetRouter } = require('./src/fleet/router');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');
const { PersistFlowService } = require('./src/persistflow/service');

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

test('short configured secrets are redacted as whole tokens without matching substrings', () => {
  const secrets = collectSecretValues({
    PERSISTFLOW_FLEET_NODE_SECRET: 'xy',
    PERSISTFLOW_FLEET_NODE_SECRETS_JSON: JSON.stringify({ node: 'a.b', empty: '  ' }),
  });

  assert.deepEqual(secrets, ['xy', 'a.b']);
  assert.equal(redactText('credentials=xy; node=a.b', secrets), 'credentials=[REDACTED]; node=[REDACTED]');
  assert.equal(redactText('word=xylo; token=a.bed', secrets), 'word=xylo; token=a.bed');
});

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

test('Provider Gateway receives bounded eligible metadata and returns validated score, route, and usage', async () => {
  let gatewayRequest;
  const candidates = eligibleNodes({
      config: config(),
      snapshot: { nodes: [beat('desktop-primary'), beat('ec2-primary')] },
      intent: baseIntent,
    });
  const scorer = new ProviderGatewayFleetRouter({
    providerGateway: {
      infer: async (request) => {
        gatewayRequest = request;
        return {
          route_id: 'fleet-semantic-v1',
          usage: { input_tokens: 128, output_tokens: 12 },
          output: [{ role: 'assistant', content: JSON.stringify({ scores: { candidate_1: 1, candidate_2: 2 } }) }],
        };
      },
    },
  });
  const result = await scorer.score({ intent: baseIntent, candidates });
  assert.deepEqual(result.scores, { 'desktop-primary': 1, 'ec2-primary': 2 });
  assert.equal(result.routeId, 'fleet-semantic-v1');
  assert.deepEqual(result.usage, { input_tokens: 128, output_tokens: 12 });
  assert.equal(gatewayRequest.policy_profile, 'fleet-routing-v1');
  assert.equal(gatewayRequest.task_class, 'fleet.node-ranking');
  assert.equal(gatewayRequest.freshness_required, true);
  assert.deepEqual(gatewayRequest.budget, { max_output_tokens: 64 });
  const userPayload = JSON.parse(gatewayRequest.input[1].content);
  assert.deepEqual(userPayload.candidates.map((row) => row.candidate_key), ['candidate_1', 'candidate_2']);
  assert.equal(gatewayRequest.input[1].content.includes('desktop-primary'), false);
  assert.equal(gatewayRequest.input[1].content.includes('ec2-primary'), false);
});

test('FleetRouter selects the highest Provider Gateway score and never selects an ineligible answer', async () => {
  const fleetRouter = new FleetRouter({
    fleetConfig: config(),
    fleetStore: {
      snapshot: () => ({ nodes: [
        beat('desktop-primary'),
        beat('ec2-primary'),
        beat('drained'),
      ] }),
    },
    providerGatewayRouter: {
      score: async () => ({
        scores: { 'desktop-primary': 0, 'ec2-primary': 2, drained: 99 },
        routeId: 'fleet-semantic-v1', usage: { input_tokens: 100, output_tokens: 8 },
      }),
    },
    clock: () => new Date('2026-09-24T17:01:00Z'),
  });
  const decision = await fleetRouter.route(baseIntent);
  assert.equal(decision.nodeId, 'ec2-primary');
  assert.equal(decision.decisionSource, 'provider-gateway');
  assert.equal(decision.providerRouteId, 'fleet-semantic-v1');
  assert.deepEqual(decision.providerUsage, { input_tokens: 100, output_tokens: 8 });
  assert.deepEqual(decision.eligibleNodeIds, ['desktop-primary', 'ec2-primary']);
});

test('Provider Gateway route identity and token usage reach the durable route checkpoint', async () => {
  const store = new MemoryAuthorityStore();
  const fleetRouter = new FleetRouter({
    fleetConfig: config(),
    fleetStore: { snapshot: () => ({ nodes: [beat('desktop-primary'), beat('ec2-primary')] }) },
    providerGatewayRouter: {
      score: async () => ({
        scores: { 'desktop-primary': 0, 'ec2-primary': 2 },
        routeId: 'fleet-semantic-v1', usage: { input_tokens: 144, output_tokens: 12 },
      }),
    },
    clock: () => new Date('2026-09-24T17:01:00Z'),
  });
  const service = new PersistFlowService({ store, fleetRouter });
  service.startRun({ runId: 'provider-gateway-checkpoint', generation: 1 });

  const result = await service.routeTask('provider-gateway-checkpoint', {
    generation: 1,
    intent: baseIntent,
  });
  const evidence = result.run.latestCheckpoint.evidence;
  assert.equal(result.decision.nodeId, 'ec2-primary');
  assert.equal(evidence.decisionSource, 'provider-gateway');
  assert.equal(evidence.providerRouteId, 'fleet-semantic-v1');
  assert.deepEqual(evidence.providerUsage, { input_tokens: 144, output_tokens: 12 });
});

test('FleetRouter falls back deterministically when Provider Gateway fails or returns malformed scores', async () => {
  for (const score of [
    async () => { throw new Error('PROVIDER_GATEWAY_REQUEST_FAILED'); },
    async () => ({ scores: { 'desktop-primary': NaN, 'ec2-primary': 2 } }),
  ]) {
    const fleetRouter = new FleetRouter({
      fleetConfig: config(),
      fleetStore: { snapshot: () => ({ nodes: [beat('desktop-primary'), beat('ec2-primary')] }) },
      providerGatewayRouter: { score },
      clock: () => new Date('2026-09-24T17:01:00Z'),
    });
    const decision = await fleetRouter.route(baseIntent);
    assert.equal(decision.decisionSource, 'deterministic-fallback');
    assert.ok(['desktop-primary', 'ec2-primary'].includes(decision.nodeId));
    assert.match(decision.providerGatewayError, /PROVIDER_GATEWAY/);
  }
});

test('FleetRouter uses single-candidate fallback and blocks when no node is eligible', async () => {
  const one = new FleetRouter({
    fleetConfig: config(),
    fleetStore: { snapshot: () => ({ nodes: [beat('ec2-primary')] }) },
    providerGatewayRouter: { score: async () => { throw new Error('should not call'); } },
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

test('equal Provider Gateway scores defer to artifact locality', async () => {
  const artifact = 'f'.repeat(64);
  const intent = { ...baseIntent, artifactRefs: ['sha256:' + artifact] };
  const fleetRouter = new FleetRouter({
    fleetConfig: config(),
    fleetStore: { snapshot: () => ({ nodes: [
      beat('desktop-primary', { cachedObjectHashes: [artifact] }),
      beat('ec2-primary', { cachedObjectHashes: [] }),
    ] }) },
    providerGatewayRouter: {
      score: async () => ({
        scores: { 'desktop-primary': 1, 'ec2-primary': 1 },
        routeId: 'fleet-semantic-v1', usage: { input_tokens: 100, output_tokens: 8 },
      }),
    },
    clock: () => new Date('2026-09-24T17:01:00Z'),
  });
  const decision = await fleetRouter.route(intent);
  assert.equal(decision.decisionSource, 'provider-gateway');
  assert.equal(decision.nodeId, 'desktop-primary');
});

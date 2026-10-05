const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseStartMode, createProductionFleetRouter } = require('./src/start-entrypoint');
const { MemoryFleetStore } = require('./src/fleet/store');

test('uses PersistFlow web mode when PORT is provided', () => {
  assert.equal(chooseStartMode({ PORT: '3000' }), 'web');
  assert.equal(chooseStartMode({ PORT: '0' }), 'web');
});

test('keeps Persistd daemon mode without PORT', () => {
  assert.equal(chooseStartMode({}), 'daemon');
});

test('production fleet router is feature-flagged off by default and constructible when enabled', () => {
  const fleetConfig = { nodes: [] };
  const fleetStore = { snapshot: () => ({ nodes: [] }) };
  assert.equal(createProductionFleetRouter({ env: {}, fleetConfig, fleetStore }), null);
  const router = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1' },
    fleetConfig,
    fleetStore,
  });
  assert.equal(typeof router.route, 'function');
  assert.equal(router.providerGatewayRouter, null);
});

test('production fleet composition uses only an injected Provider Gateway scorer', async () => {
  const now = new Date('2026-09-28T02:00:00.000Z');
  const fleetConfig = { nodes: [
    { id: 'desktop-primary', platform: 'win32', capabilities: ['git', 'node'], affinities: ['desktop'], concurrencyLimit: 1, drained: false },
    { id: 'ec2-primary', platform: 'win32', capabilities: ['git', 'node'], affinities: ['tests'], concurrencyLimit: 2, drained: false },
  ] };
  const fleetStore = new MemoryFleetStore();
  for (const nodeId of ['desktop-primary', 'ec2-primary']) {
    fleetStore.putHeartbeat(nodeId, {
      observedAt: now.toISOString(), hostname: nodeId,
      freeDiskBytes: 200_000_000_000, totalDiskBytes: 500_000_000_000,
      freeMemoryBytes: 20_000_000_000, totalMemoryBytes: 64_000_000_000,
      cpuPercent: 10, activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [],
      runtimeVersion: '1', capabilitiesHash: '',
    });
  }
  let request;
  const router = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1', TYPESAFE_API_KEY: 'must-not-be-read' },
    fleetConfig, fleetStore, clock: () => now,
    providerGateway: {
      infer: async (input) => {
        request = input;
        return {
          route_id: 'fleet-policy-v1',
          usage: { input_tokens: 100, output_tokens: 8 },
          output: [{ role: 'assistant', content: '{"scores":{"candidate_1":0,"candidate_2":2}}' }],
        };
      },
    },
  });
  const decision = await router.route({
    taskId: 'gateway-routing-test', summary: 'run repository tests',
    requiredCapabilities: ['git', 'node'], preferredCapabilities: [],
    estimatedScratchBytes: 1024, artifactRefs: [],
  });
  assert.equal(decision.nodeId, 'ec2-primary');
  assert.equal(decision.decisionSource, 'provider-gateway');
  assert.equal(decision.providerRouteId, 'fleet-policy-v1');
  assert.equal(request.policy_profile, 'fleet-routing-v1');
  assert.equal(request.freshness_required, true);
  assert.equal(Object.hasOwn(request, 'apiKey'), false);

  const withoutGateway = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1', TYPESAFE_API_KEY: 'must-not-be-read' },
    fleetConfig, fleetStore, clock: () => now,
  });
  const fallback = await withoutGateway.route({
    taskId: 'gateway-unavailable-test', summary: 'run repository tests',
    requiredCapabilities: ['git', 'node'], preferredCapabilities: [],
    estimatedScratchBytes: 1024, artifactRefs: [],
  });
  assert.equal(fallback.decisionSource, 'deterministic-fallback');
  assert.equal(fallback.providerGatewayError, 'PROVIDER_GATEWAY_UNAVAILABLE');
});

test('Railway ephemeral routing stays off unless its dedicated gate is enabled', async () => {
  const now = new Date('2026-09-28T02:00:00.000Z');
  const fleetConfig = { nodes: [
    { id: 'desktop-primary', platform: 'win32', capabilities: ['node', 'remote-worker'], concurrencyLimit: 1, drained: false },
  ] };
  const fleetStore = new MemoryFleetStore();
  fleetStore.putHeartbeat('desktop-primary', {
    observedAt: now.toISOString(), freeDiskBytes: 80_000_000_000, totalDiskBytes: 100_000_000_000,
    freeMemoryBytes: 8_000_000_000, totalMemoryBytes: 10_000_000_000, cpuPercent: 5,
    activeJobs: 0, cacheBytes: 0, cachedObjectHashes: [], runtimeVersion: '1', capabilitiesHash: '',
  });
  const provider = { remaining: () => 1, describe: () => ({ provider: 'railway-anonymous' }) };
  const off = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1' }, fleetConfig, fleetStore, clock: () => now,
  });
  const on = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1', PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED: '1' },
    fleetConfig, fleetStore, railwayProvider: provider, clock: () => now,
  });
  const intent = {
    taskId: 'build-1', summary: 'run stateless repository tests', requiredCapabilities: ['remote-worker'],
    preferredCapabilities: ['ephemeral-worker'], estimatedScratchBytes: 0, artifactRefs: [],
  };
  const disabledDecision = await off.route(intent);
  const enabledDecision = await on.route(intent);
  assert.equal(disabledDecision.nodeId, 'desktop-primary');
  assert.equal(Object.hasOwn(disabledDecision, 'routingEvidence'), false);
  assert.equal(Object.hasOwn(disabledDecision, 'provider'), false);
  assert.equal(enabledDecision.nodeId, 'railway-anonymous');
  assert.deepEqual(enabledDecision.routingEvidence.candidates.map((candidate) => candidate.provider), ['fleet-node', 'railway-anonymous']);
});

test('ephemeral candidate is hard-ineligible for local UI, GPU, pinned local nodes and exhausted quota', async () => {
  const now = new Date('2026-09-28T02:00:00.000Z');
  const provider = { remaining: () => 1 };
  const router = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1', PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED: '1' },
    fleetConfig: { nodes: [] }, fleetStore: new MemoryFleetStore(), railwayProvider: provider, clock: () => now,
  });
  for (const intent of [
    { requiresInteractiveUi: true },
    { requiresGpu: true },
    { pinnedNodeId: 'desktop-primary' },
  ]) {
    await assert.rejects(() => router.route({
      taskId: 'local-only', summary: 'requires local execution', requiredCapabilities: [],
      preferredCapabilities: [], estimatedScratchBytes: 0, artifactRefs: [], ...intent,
    }), /NO_ELIGIBLE_NODE/);
  }
  const noQuota = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1', PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED: '1' },
    fleetConfig: { nodes: [] }, fleetStore: new MemoryFleetStore(),
    railwayProvider: { remaining: () => 0 }, clock: () => now,
  });
  await assert.rejects(() => noQuota.route({
    taskId: 'quota', summary: 'run tests', requiredCapabilities: [], preferredCapabilities: [],
    estimatedScratchBytes: 0, artifactRefs: [],
  }), /NO_ELIGIBLE_NODE/);
});

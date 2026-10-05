const { normalizeRouteIntent } = require('./contracts');
const { eligibleNodes, deterministicOrder } = require('./eligibility');

function validateScores(scores, candidates) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw new Error('PROVIDER_GATEWAY_INVALID_SCORES');
  const output = {};
  for (const candidate of candidates) {
    const value = scores[candidate.id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
      throw new Error('PROVIDER_GATEWAY_INVALID_SCORES');
    }
    output[candidate.id] = value;
  }
  return output;
}

function providerGatewayOrder(candidates, intent, scores, options = {}) {
  const fallbackRanks = new Map(deterministicOrder(candidates, intent, options).map((candidate, index) => [candidate.id, index]));
  return [...candidates].sort((a, b) => {
    if (scores[b.id] !== scores[a.id]) return scores[b.id] - scores[a.id];
    return fallbackRanks.get(a.id) - fallbackRanks.get(b.id);
  });
}

class FleetRouter {
  constructor({
    fleetConfig,
    fleetStore,
    providerGatewayRouter = null,
    railwayProvider = null,
    railwayEnabled = false,
    clock = () => new Date(),
  } = {}) {
    if (!fleetConfig) throw new Error('FLEET_CONFIG_REQUIRED');
    if (!fleetStore) throw new Error('FLEET_STORE_REQUIRED');
    this.fleetConfig = fleetConfig;
    this.fleetStore = fleetStore;
    this.providerGatewayRouter = providerGatewayRouter;
    this.railwayProvider = railwayProvider;
    this.railwayEnabled = railwayEnabled === true;
    this.clock = clock;
  }

  ephemeralCandidate(intent) {
    if (!this.railwayEnabled || !this.railwayProvider) return { candidate: null, reasons: ['feature_disabled'] };
    if (intent.requiresInteractiveUi) return { candidate: null, reasons: ['interactive_ui_required'] };
    if (intent.requiresGpu) return { candidate: null, reasons: ['gpu_required'] };
    if (intent.requiresLocalExecution) return { candidate: null, reasons: ['local_execution_required'] };
    if (intent.requiresBrowserSession) return { candidate: null, reasons: ['browser_session_required'] };
    if (intent.pinnedNodeId && intent.pinnedNodeId !== 'railway-anonymous') return { candidate: null, reasons: ['pinned_to_other_node'] };
    if (intent.estimatedScratchBytes > 512 * 1024 * 1024) return { candidate: null, reasons: ['scratch_exceeds_ephemeral_limit'] };
    if ((intent.requiredCapabilities || []).some((cap) => ![
      'git', 'node', 'python', 'remote-worker', 'ephemeral-worker', 'cli', 'build', 'test', 'repo-analysis', 'processing',
    ].includes(cap))) {
      return { candidate: null, reasons: ['required_capability_unavailable'] };
    }
    const remaining = Number(this.railwayProvider.remaining?.() ?? 0);
    if (!Number.isFinite(remaining) || remaining <= 0) return { candidate: null, reasons: ['daily_quota_exhausted'] };
    return {
      candidate: {
        id: 'railway-anonymous', provider: 'railway-anonymous', platform: 'linux',
        capabilities: ['git', 'node', 'python', 'remote-worker', 'ephemeral-worker', 'cli', 'build', 'test', 'repo-analysis', 'processing'],
        affinities: ['background', 'tests'], freeDiskBytes: 1_000_000_000,
        totalDiskBytes: 1_500_000_000, freeMemoryBytes: 1_300_000_000,
        totalMemoryBytes: 2_000_000_000, cpuPercent: 0, activeJobs: 0, cachedArtifactCount: 0,
      },
      reasons: [],
    };
  }

  async route(input) {
    const intent = normalizeRouteIntent(input);
    const snapshot = this.fleetStore.snapshot({
      nowMs: this.clock().getTime(),
      staleAfterMs: 90_000,
    });
    const nodeCandidates = eligibleNodes({
      config: this.fleetConfig,
      snapshot,
      intent,
    });
    const ephemeral = this.ephemeralCandidate(intent);
    const candidates = [...nodeCandidates, ...(ephemeral.candidate ? [ephemeral.candidate] : [])]
      .sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length === 0) throw new Error('NO_ELIGIBLE_NODE');

    const evidenceBase = {
      candidates: candidates.map((candidate) => ({ id: candidate.id, provider: candidate.provider || 'fleet-node', eligible: true })),
      ineligible: [{ id: 'railway-anonymous', provider: 'railway-anonymous', reasons: ephemeral.reasons }]
        .filter((item) => item.reasons.length > 0),
    };
    const ephemeralDiagnostics = this.railwayEnabled && Boolean(this.railwayProvider);
    const routeOptions = { honorPreferredCapabilities: ephemeralDiagnostics };
    const selectedEvidence = (candidate, reason, fallbackReason = null) => ephemeralDiagnostics ? {
      provider: candidate.provider || 'fleet-node',
      routingEvidence: {
        ...evidenceBase,
        selectedProvider: candidate.provider || 'fleet-node',
        selectedProviderReason: reason,
        fallbackReason,
      },
    } : {};

    const base = {
      taskId: intent.taskId,
      eligibleNodeIds: candidates.map((candidate) => candidate.id),
      evaluatedAt: this.clock().toISOString(),
    };

    if (candidates.length === 1) {
      return {
        ...base,
        nodeId: candidates[0].id,
        decisionSource: 'single-candidate-fallback',
        semanticScores: null,
        ...selectedEvidence(candidates[0], 'only eligible candidate'),
      };
    }

    try {
      if (!this.providerGatewayRouter) throw new Error('PROVIDER_GATEWAY_UNAVAILABLE');
      const providerResult = await this.providerGatewayRouter.score({ intent, candidates });
      const scores = validateScores(
        providerResult?.scores,
        candidates,
      );
      const selected = providerGatewayOrder(candidates, intent, scores, routeOptions)[0];
      return {
        ...base,
        nodeId: selected.id,
        decisionSource: 'provider-gateway',
        semanticScores: scores,
        providerRouteId: providerResult.routeId,
        providerUsage: providerResult.usage,
        ...selectedEvidence(selected, 'highest valid Provider Gateway score among hard-eligible nodes'),
      };
    } catch (error) {
      const selected = deterministicOrder(candidates, intent, routeOptions)[0];
      const fallbackReason = String(error?.message || error).slice(0, 160);
      return {
        ...base,
        nodeId: selected.id,
        decisionSource: 'deterministic-fallback',
        semanticScores: null,
        providerGatewayError: fallbackReason,
        ...selectedEvidence(selected, 'deterministic order among hard-eligible providers', fallbackReason),
      };
    }
  }
}

module.exports = { FleetRouter, validateScores, providerGatewayOrder };

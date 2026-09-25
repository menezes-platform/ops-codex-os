const { normalizeRouteIntent } = require('./contracts');
const { eligibleNodes, deterministicOrder } = require('./eligibility');

function validateScores(scores, candidates) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw new Error('typesafe_invalid_scores');
  const output = {};
  for (const candidate of candidates) {
    const value = scores[candidate.id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
      throw new Error('typesafe_invalid_scores');
    }
    output[candidate.id] = value;
  }
  return output;
}

function typesafeOrder(candidates, intent, scores) {
  const fallbackRanks = new Map(deterministicOrder(candidates, intent).map((candidate, index) => [candidate.id, index]));
  return [...candidates].sort((a, b) => {
    if (scores[b.id] !== scores[a.id]) return scores[b.id] - scores[a.id];
    return fallbackRanks.get(a.id) - fallbackRanks.get(b.id);
  });
}

class FleetRouter {
  constructor({
    fleetConfig,
    fleetStore,
    typesafeRouter = null,
    clock = () => new Date(),
  } = {}) {
    if (!fleetConfig) throw new Error('FLEET_CONFIG_REQUIRED');
    if (!fleetStore) throw new Error('FLEET_STORE_REQUIRED');
    this.fleetConfig = fleetConfig;
    this.fleetStore = fleetStore;
    this.typesafeRouter = typesafeRouter;
    this.clock = clock;
  }

  async route(input) {
    const intent = normalizeRouteIntent(input);
    const snapshot = this.fleetStore.snapshot({
      nowMs: this.clock().getTime(),
      staleAfterMs: 90_000,
    });
    const candidates = eligibleNodes({
      config: this.fleetConfig,
      snapshot,
      intent,
    });
    if (candidates.length === 0) throw new Error('NO_ELIGIBLE_NODE');

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
        typesafeScores: null,
      };
    }

    try {
      if (!this.typesafeRouter) throw new Error('typesafe_unavailable');
      const scores = validateScores(
        await this.typesafeRouter.score({ intent, candidates }),
        candidates,
      );
      return {
        ...base,
        nodeId: typesafeOrder(candidates, intent, scores)[0].id,
        decisionSource: 'typesafe',
        typesafeScores: scores,
      };
    } catch (error) {
      return {
        ...base,
        nodeId: deterministicOrder(candidates, intent)[0].id,
        decisionSource: 'deterministic-fallback',
        typesafeScores: null,
        typesafeError: String(error?.message || error).slice(0, 160),
      };
    }
  }
}

module.exports = { FleetRouter, validateScores, typesafeOrder };

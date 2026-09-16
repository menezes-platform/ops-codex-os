const { createRunState, assertMutableGeneration } = require('./run-state');

class PersistFlowService {
  constructor({ store, clock = () => new Date() } = {}) {
    if (!store) throw new Error('AUTHORITY_STORE_REQUIRED');
    this.store = store;
    this.clock = clock;
  }

  nowIso() {
    return this.clock().toISOString();
  }

  startRun(input = {}) {
    const now = this.nowIso();
    const state = createRunState({
      ...input,
      createdAt: input.createdAt || now,
      updatedAt: now,
      checkpoints: Array.isArray(input.checkpoints) ? input.checkpoints : [],
    });
    return this.store.create(state);
  }

  inspectRun(runId) {
    const state = this.store.get(runId);
    if (!state) throw new Error('RUN_NOT_FOUND');
    return state;
  }
  heartbeat(runId, input = {}) {
    const now = this.nowIso();
    return this.store.update(runId, (state) => {
      assertMutableGeneration(state, input.generation);
      return {
        ...state,
        controllerHeartbeatAt: now,
        progress: input.progress ?? state.progress ?? null,
        updatedAt: now,
      };
    });
  }

  checkpoint(runId, input = {}) {
    const now = this.nowIso();
    return this.store.update(runId, (state) => {
      assertMutableGeneration(state, input.generation);
      const checkpoint = {
        at: now,
        generation: Number(input.generation),
        nextSafeAction: input.nextSafeAction ?? null,
        evidence: input.evidence ?? null,
      };
      return {
        ...state,
        checkpoints: [...(state.checkpoints || []), checkpoint],
        latestCheckpoint: checkpoint,
        nextSafeAction: input.nextSafeAction ?? state.nextSafeAction ?? null,
        updatedAt: now,
      };
    });
  }

  bridgeSync(runId, input = {}) {
    const now = this.nowIso();
    return this.store.update(runId, (state) => {
      const expected = Number(input.expectedGeneration);
      const generation = Number(input.generation);
      if (Number(state.generation) !== expected) throw new Error('STALE_GENERATION');
      if (generation !== expected + 1) throw new Error('INVALID_GENERATION');
      return {
        ...state, generation, status: 'ACTIVE', successor: null,
        controllerHeartbeatAt: input.controllerHeartbeatAt || now,
        progress: input.progress ?? state.progress ?? null,
        nextSafeAction: input.nextSafeAction ?? state.nextSafeAction ?? null,
        updatedAt: now,
      };
    });
  }

  claim(runId, input = {}) {
    return this.store.claimSuccessor({
      runId,
      expectedGeneration: input.expectedGeneration,
      generation: input.generation,
      claimSecret: input.claimSecret,
    });
  }
}

module.exports = { PersistFlowService };

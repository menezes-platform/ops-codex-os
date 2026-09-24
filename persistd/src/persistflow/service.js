const { createRunState, assertMutableGeneration } = require('./run-state');

class PersistFlowService {
  constructor({
    store,
    clock = () => new Date(),
    sandbox = null,
    fleetStore = null,
    fleetConfig = { nodes: [] },
    fleetRouter = null,
    driveAuth = null,
  } = {}) {
    if (!store) throw new Error('AUTHORITY_STORE_REQUIRED');
    this.store = store;
    this.clock = clock;
    this.sandbox = sandbox;
    this.fleetStore = fleetStore;
    this.fleetConfig = fleetConfig;
    this.fleetRouter = fleetRouter;
    this.driveAuth = driveAuth;
  }

  nowIso() {
    return this.clock().toISOString();
  }

  requireSandbox() {
    if (!this.sandbox) throw new Error('SANDBOX_NOT_CONFIGURED');
    return this.sandbox;
  }

  fleetHeartbeat(nodeId, heartbeat) {
    if (!this.fleetStore) throw new Error('FLEET_NOT_CONFIGURED');
    return this.fleetStore.putHeartbeat(nodeId, heartbeat);
  }

  fleetStatus() {
    if (!this.fleetStore) throw new Error('FLEET_NOT_CONFIGURED');
    return this.fleetStore.snapshot({ nowMs: this.clock().getTime(), staleAfterMs: 90_000 });
  }

  assertRunGeneration(runId, generation) {
    const state = this.inspectRun(runId);
    assertMutableGeneration(state, generation);
    return state;
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

  async sandboxCreate(runId, input = {}) {
    this.assertRunGeneration(runId, input.generation);
    const workspace = await this.requireSandbox().create({
      runId,
      repo: input.repo,
      ref: input.ref,
      providerHint: input.providerHint,
      policyTier: input.policyTier,
      ttlSeconds: input.ttlSeconds,
    });
    const run = this.checkpoint(runId, {
      generation: input.generation,
      nextSafeAction: input.nextSafeAction,
      evidence: { type: 'sandbox.workspace.created', workspace },
    });
    return { workspace, run };
  }

  async sandboxInspect(runId, workspaceId) {
    this.inspectRun(runId);
    const workspace = await this.requireSandbox().inspect(workspaceId);
    return { workspace };
  }

  async sandboxExec(runId, input = {}) {
    this.assertRunGeneration(runId, input.generation);
    const job = await this.requireSandbox().exec({
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      operation: input.operation,
      payload: input.payload,
      priority: input.priority,
      maxAttempts: input.maxAttempts,
    });
    const run = this.checkpoint(runId, {
      generation: input.generation,
      nextSafeAction: input.nextSafeAction,
      evidence: { type: 'sandbox.job.queued', job },
    });
    return { job, run };
  }

  async sandboxJob(runId, jobId) {
    this.inspectRun(runId);
    const job = await this.requireSandbox().inspectJob(jobId);
    return { job };
  }

  async sandboxReceipt(runId, input = {}) {
    this.assertRunGeneration(runId, input.generation);
    const receipt = await this.requireSandbox().receipt(input.jobId);
    const run = this.checkpoint(runId, {
      generation: input.generation,
      nextSafeAction: input.nextSafeAction,
      evidence: { type: 'sandbox.receipt', receipt },
    });
    return { receipt, run };
  }

  async sandboxDestroy(runId, input = {}) {
    this.assertRunGeneration(runId, input.generation);
    const workspace = await this.requireSandbox().destroy(input.workspaceId);
    const run = this.checkpoint(runId, {
      generation: input.generation,
      nextSafeAction: input.nextSafeAction,
      evidence: { type: 'sandbox.workspace.destroyed', workspace },
    });
    return { workspace, run };
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

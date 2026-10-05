const { createRunState, assertMutableGeneration } = require('./run-state');
const crypto = require('node:crypto');

const SECRET_FIELD = /(?:secret|token|password|credential|private[_-]?key|cookie|claim[_-]?url|bearer)/i;

function scrubDurable(value) {
  if (Array.isArray(value)) return value.map((item) => scrubDurable(item));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/\b(cookie|session|token|secret|password)=([^\s"']+)/gi, (_match, key) => key + '=[REDACTED]')
      .replace(/https:\/\/railway\.com\/ssh-signup\?[^\s"']+/gi, '[RAILWAY_CLAIM_URL_REDACTED]')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]');
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELD.test(key))
    .map(([key, item]) => [key, scrubDurable(item)]));
}

function assertSafeResume(value, depth = 0) {
  if (depth > 8) throw new Error('EPHEMERAL_RESUME_TOO_DEEP');
  if (Array.isArray(value)) {
    for (const item of value) assertSafeResume(item, depth + 1);
    return value;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /Bearer\s+\S+|https:\/\/railway\.com\/ssh-signup\?|-----BEGIN .*PRIVATE KEY-----|\b(?:cookie|session|token|secret|password)=/i.test(value)) {
      throw new Error('EPHEMERAL_RESUME_SECRET_FORBIDDEN');
    }
    return value;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw new Error('EPHEMERAL_RESUME_SECRET_FORBIDDEN');
    assertSafeResume(item, depth + 1);
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 64 * 1024) throw new Error('EPHEMERAL_RESUME_TOO_LARGE');
  return value;
}

function parseWorkerOutcome(result) {
  const stdout = String(result?.stdout || '');
  const lines = stdout.split(/\r?\n/);
  const markerIndex = lines.findLastIndex((line) => line.startsWith('PERSISTFLOW_HANDOFF_BASE64='));
  if (markerIndex < 0) return { status: 'completed', result };
  let resume;
  try {
    const encoded = lines[markerIndex].slice('PERSISTFLOW_HANDOFF_BASE64='.length).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('invalid base64');
    resume = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    assertSafeResume(resume);
    if (!resume || typeof resume !== 'object' || Array.isArray(resume)) throw new Error('invalid checkpoint');
  } catch {
    throw new Error('EPHEMERAL_RESUME_INVALID');
  }
  return {
    status: 'handoff',
    resume,
    result: { ...result, stdout: lines.filter((_, index) => index !== markerIndex).join('\n').replace(/\n+$/, '') },
  };
}

class PersistFlowService {
  constructor({
    store,
    clock = () => new Date(),
    sandbox = null,
    fleetStore = null,
    fleetConfig = { nodes: [] },
    fleetRouter = null,
    ephemeralProvider = null,
    ephemeralEnabled = false,
    ephemeralLoop = null,
    driveAuth = null,
    objectStore = null,
  } = {}) {
    if (!store) throw new Error('AUTHORITY_STORE_REQUIRED');
    this.store = store;
    this.clock = clock;
    this.sandbox = sandbox;
    this.fleetStore = fleetStore;
    this.fleetConfig = fleetConfig;
    this.fleetRouter = fleetRouter;
    this.ephemeralProvider = ephemeralProvider;
    this.ephemeralEnabled = ephemeralEnabled === true;
    this.ephemeralLoop = ephemeralLoop;
    this.activeEphemeralOperations = new Map();
    if (this.ephemeralEnabled && this.ephemeralProvider && !this.ephemeralLoop) {
      const { EphemeralWorkerLoop } = require('../fleet/ephemeral-loop');
      this.ephemeralLoop = new EphemeralWorkerLoop({ provider: this.ephemeralProvider, clock: this.clock });
    }
    this.driveAuth = driveAuth;
    this.objectStore = objectStore;
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

  async issueDriveAccess(nodeId) {
    const registered = Array.isArray(this.fleetConfig?.nodes)
      && this.fleetConfig.nodes.some((node) => node.id === nodeId);
    if (!registered) throw new Error('FLEET_NODE_NOT_REGISTERED');
    if (!this.driveAuth) throw new Error('DRIVE_AUTH_UNAVAILABLE');
    return this.driveAuth.getAccess();
  }

  async objectCatalogLookup(ref) {
    if (!this.objectStore) throw new Error('OBJECT_STORE_NOT_CONFIGURED');
    const file = await this.objectStore.resolve(ref);
    const appProperties = {};
    for (const [key, value] of Object.entries(file?.appProperties || {})) {
      if (key.startsWith('gdb_')) appProperties[key] = String(value);
    }
    return {
      ref: String(ref),
      fileId: String(file.id || ''),
      name: file.name ? String(file.name) : null,
      size: file.size == null ? null : Number(file.size),
      mimeType: file.mimeType ? String(file.mimeType) : null,
      modifiedTime: file.modifiedTime ? String(file.modifiedTime) : null,
      appProperties,
    };
  }

  cacheStatus() {
    const fleet = this.fleetStatus();
    return {
      nodes: fleet.nodes.map((row) => ({
        nodeId: row.nodeId,
        fresh: row.fresh,
        cacheBytes: Number(row.heartbeat?.cacheBytes || 0),
        cachedObjectCount: Array.isArray(row.heartbeat?.cachedObjectHashes)
          ? row.heartbeat.cachedObjectHashes.length
          : 0,
      })),
    };
  }

  assertRunGeneration(runId, generation) {
    const state = this.inspectRun(runId);
    assertMutableGeneration(state, generation);
    return state;
  }

  async routeTask(runId, input = {}) {
    this.assertRunGeneration(runId, input.generation);
    if (!this.fleetRouter) throw new Error('FLEET_ROUTER_NOT_CONFIGURED');
    const decision = await this.fleetRouter.route(input.intent || {});
    const now = this.nowIso();
    const run = this.store.update(runId, (state) => {
      assertMutableGeneration(state, input.generation);
      const checkpoint = {
        at: now,
        generation: Number(input.generation),
        nextSafeAction: state.nextSafeAction ?? null,
        evidence: {
          type: 'fleet.route',
          taskId: decision.taskId,
          nodeId: decision.nodeId,
          decisionSource: decision.decisionSource,
          eligibleNodeIds: decision.eligibleNodeIds,
          evaluatedAt: decision.evaluatedAt,
          ...(decision.providerRouteId ? { providerRouteId: decision.providerRouteId } : {}),
          ...(decision.providerUsage ? { providerUsage: decision.providerUsage } : {}),
          ...(decision.routingEvidence ? { routingEvidence: decision.routingEvidence } : {}),
        },
      };
      return {
        ...state,
        latestRoute: decision,
        checkpoints: [...(state.checkpoints || []), checkpoint],
        latestCheckpoint: checkpoint,
        updatedAt: now,
      };
    });
    return { decision, run };
  }

  async executeEphemeralTask(runId, input = {}) {
    if (!this.ephemeralEnabled) throw new Error('EPHEMERAL_EXECUTION_DISABLED');
    if (!this.ephemeralProvider || !this.ephemeralLoop) throw new Error('EPHEMERAL_PROVIDER_NOT_CONFIGURED');
    const operationId = String(input.operationId || '').trim();
    const command = String(input.command || '');
    if (!operationId || operationId.length > 128) throw new Error('OPERATION_ID_INVALID');
    if (!command.trim() || command.length > 8192 || command.includes('\0')) throw new Error('EPHEMERAL_COMMAND_INVALID');
    const commandDigest = crypto.createHash('sha256').update(command, 'utf8').digest('hex');
    const state = this.assertRunGeneration(runId, input.generation);
    const existing = state.ephemeralOperations?.[operationId];
    if (existing && existing.commandDigest !== commandDigest) throw new Error('OPERATION_ID_CONFLICT');
    const active = this.activeEphemeralOperations.get(runId + '\0' + operationId);
    if (active) return active;
    if (existing && existing.status !== 'PREPARING') {
      return { operation: existing, run: state, decision: state.latestRoute || null, replayed: true };
    }

    const operationKey = runId + '\0' + operationId;
    const now = this.nowIso();
    if (!existing) {
      this.store.update(runId, (current) => {
        assertMutableGeneration(current, input.generation);
        const operations = { ...(current.ephemeralOperations || {}) };
        if (operations[operationId]) return current;
        operations[operationId] = {
          operationId,
          generation: Number(input.generation),
          status: 'PREPARING',
          provider: null,
          workerGeneration: 0,
          commandDigest,
          correlationId: String(input.correlationId || crypto.randomUUID()).slice(0, 128),
          events: [],
          createdAt: now,
          updatedAt: now,
        };
        return { ...current, ephemeralOperations: operations, updatedAt: now };
      });
    }

    const flight = this.runEphemeralOperation(runId, { ...input, operationId, command });
    this.activeEphemeralOperations.set(operationKey, flight);
    try { return await flight; }
    finally { this.activeEphemeralOperations.delete(operationKey); }
  }

  async runEphemeralOperation(runId, input) {
    const { operationId, command } = input;
    const decision = await this.fleetRouter?.route(input.intent || {});
    if (!decision) throw new Error('FLEET_ROUTER_NOT_CONFIGURED');
    const now = this.nowIso();
    let run = this.store.update(runId, (state) => {
      assertMutableGeneration(state, input.generation);
      const operations = { ...(state.ephemeralOperations || {}) };
      const operation = operations[operationId];
      if (!operation || operation.status !== 'PREPARING') throw new Error('EPHEMERAL_OPERATION_ALREADY_CLAIMED');
      const selectedProvider = decision.provider || (decision.nodeId === 'railway-anonymous' ? 'railway-anonymous' : 'fleet-node');
      operations[operationId] = {
        ...operation,
        provider: selectedProvider,
        selectedNodeId: decision.nodeId,
        status: selectedProvider === 'railway-anonymous' ? 'ACQUIRING' : 'ROUTED_TO_EXISTING_PROVIDER',
        routingEvidence: scrubDurable(decision.routingEvidence || {}),
        updatedAt: now,
      };
      const checkpoint = {
        at: now,
        generation: Number(input.generation),
        nextSafeAction: 'execute durable operation ' + operationId,
        evidence: scrubDurable({
          type: 'fleet.route', taskId: decision.taskId, nodeId: decision.nodeId,
          provider: selectedProvider, decisionSource: decision.decisionSource,
          ...(decision.providerRouteId ? { providerRouteId: decision.providerRouteId } : {}),
          ...(decision.providerUsage ? { providerUsage: decision.providerUsage } : {}),
          routingEvidence: decision.routingEvidence || null,
        }),
      };
      return {
        ...state, latestRoute: decision, ephemeralOperations: operations,
        checkpoints: [...(state.checkpoints || []), checkpoint], latestCheckpoint: checkpoint, updatedAt: now,
      };
    });
    let operation = run.ephemeralOperations[operationId];
    if (operation.provider !== 'railway-anonymous') {
      const at = this.nowIso();
      const fallbackEvent = scrubDurable({
        type: 'ephemeral.worker.fallback', runId, operationId, generation: Number(input.generation),
        requestId: operation.correlationId, selectedProvider: operation.provider,
        reason: decision.routingEvidence?.fallbackReason || 'railway-not-selected',
      });
      run = this.store.update(runId, (state) => {
        const current = state.ephemeralOperations[operationId];
        const operations = { ...state.ephemeralOperations, [operationId]: { ...current, events: [...(current.events || []), fallbackEvent], updatedAt: at } };
        const checkpoint = { at, generation: Number(input.generation), nextSafeAction: state.nextSafeAction || null, evidence: fallbackEvent };
        return { ...state, ephemeralOperations: operations, checkpoints: [...(state.checkpoints || []), checkpoint], latestCheckpoint: checkpoint, updatedAt: at };
      });
      return { operation: run.ephemeralOperations[operationId], run, decision, replayed: false };
    }

    const requestId = operation.correlationId;
    const checkpoint = async (event) => {
      const safeEvent = scrubDurable({
        type: event.type,
        at: event.at,
        runId,
        operationId,
        generation: Number(input.generation),
        requestId,
        provider: 'railway-anonymous',
        workerGeneration: Number(event.attempt || 0),
        worker: event.worker,
        successor: event.successor,
        resume: event.resume,
        errorCode: String(event.error || '').replace(/https?:\/\/\S+/g, '[URL_REDACTED]').slice(0, 160),
        result: event.result ? { status: 'completed' } : undefined,
      });
      const at = this.nowIso();
      run = this.store.update(runId, (state) => {
        assertMutableGeneration(state, input.generation);
        const operations = { ...(state.ephemeralOperations || {}) };
        const current = operations[operationId];
        const status = event.type === 'ephemeral.worker.release' ? current.status
          : event.type === 'ephemeral.worker.successor_failed' || event.type === 'ephemeral.worker.handoff_failed' ? 'HANDOFF_BLOCKED'
          : event.type === 'ephemeral.worker.acquire.started' ? 'ACQUIRING'
          : ['ephemeral.worker.acquire.failed', 'ephemeral.worker.failed', 'ephemeral.worker.handoff_failed', 'ephemeral.worker.successor_failed'].includes(event.type) ? 'FAILED'
            : event.type === 'ephemeral.worker.completed' ? 'COMPLETED'
              : event.type === 'ephemeral.worker.handoff' ? 'HANDOFF'
                : event.type === 'ephemeral.worker.handoff.requested' ? 'CHECKPOINTED'
                  : 'RUNNING';
        operations[operationId] = {
          ...current,
          status,
          workerGeneration: Math.max(Number(current.workerGeneration || 0), Number(event.attempt || 0)),
          events: [...(current.events || []), safeEvent],
          updatedAt: at,
        };
        const persistedCheckpoint = {
          at,
          generation: Number(input.generation),
          nextSafeAction: event.resume?.nextSafeAction || state.nextSafeAction || null,
          evidence: safeEvent,
        };
        return {
          ...state, ephemeralOperations: operations,
          checkpoints: [...(state.checkpoints || []), persistedCheckpoint],
          latestCheckpoint: persistedCheckpoint, updatedAt: at,
        };
      });
      operation = run.ephemeralOperations[operationId];
    };

    try {
      const result = await this.ephemeralLoop.run({ id: runId + '-' + operationId, taskId: operationId }, {
        executeWorker: async ({ worker, resume }) => {
          const resumeEnv = resume
            ? 'PERSISTFLOW_RESUME_BASE64=' + Buffer.from(JSON.stringify(assertSafeResume(resume)), 'utf8').toString('base64') + ' '
            : '';
          return parseWorkerOutcome(await this.ephemeralProvider.exec(worker, resumeEnv + command));
        },
        finalizeHandoff: async ({ successor }) => { await this.ephemeralProvider.exec(successor, 'true'); },
        checkpoint,
      });
      run = this.inspectRun(runId);
      operation = run.ephemeralOperations[operationId];
      return { operation, run, decision, result: result.result, replayed: false };
    } catch (error) {
      const at = this.nowIso();
      run = this.store.update(runId, (state) => {
        const operations = { ...(state.ephemeralOperations || {}) };
        const current = operations[operationId];
        const status = current.events?.some((event) => ['ephemeral.worker.successor_failed', 'ephemeral.worker.handoff_failed'].includes(event.type))
          ? 'HANDOFF_BLOCKED' : 'FAILED';
        operations[operationId] = { ...current, status, errorCode: safeErrorCode(error), updatedAt: at };
        return { ...state, ephemeralOperations: operations, updatedAt: at };
      });
      throw error;
    }
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

function safeErrorCode(error) {
  const value = String(error?.message || error);
  const match = /^([A-Z][A-Z0-9_:-]{0,79})/.exec(value);
  return match ? match[1] : 'EPHEMERAL_EXECUTION_FAILED';
}

module.exports = { PersistFlowService };

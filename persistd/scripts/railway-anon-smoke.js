#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { RailwayAnonymousProvider } = require('../src/fleet/railway-anonymous');
const { FleetRouter } = require('../src/fleet/router');
const { MemoryFleetStore } = require('../src/fleet/store');
const { FileAuthorityStore } = require('../src/persistflow/authority-store');
const { PersistFlowService } = require('../src/persistflow/service');

async function main() {
  const runId = 'railway-smoke-' + crypto.randomUUID();
  const operationId = 'bounded-remote-proof';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-railway-smoke-'));
  const store = new FileAuthorityStore(dataDir);
  const provider = new RailwayAnonymousProvider();
  const fleetConfig = { nodes: [] };
  const fleetRouter = new FleetRouter({
    fleetConfig,
    fleetStore: new MemoryFleetStore(),
    railwayProvider: provider,
    railwayEnabled: true,
  });
  const service = new PersistFlowService({
    store,
    fleetConfig,
    fleetRouter,
    ephemeralProvider: provider,
    ephemeralEnabled: true,
  });
  service.startRun({ runId, generation: 1, goal: 'bounded Railway anonymous remote smoke' });

  const input = {
    generation: 1,
    operationId,
    command: 'printf "REMOTE_OK\\n"; uname -s; git --version; node --version',
    intent: {
      taskId: operationId,
      summary: 'run a bounded Linux CLI capability smoke on disposable remote compute',
      requiredCapabilities: ['remote-worker', 'cli'],
      preferredCapabilities: ['ephemeral-worker'],
      estimatedScratchBytes: 0,
      artifactRefs: [],
    },
  };

  let completed = false;
  try {
    const result = await service.executeEphemeralTask(runId, input);
    completed = result.operation.status === 'COMPLETED';
    if (!completed || !/REMOTE_OK/.test(result.result?.stdout || '')) throw new Error('RAILWAY_PERSISTFLOW_SMOKE_RESULT_INVALID');

    // Verify the same durable authority after a controller-object restart and prove retry does not execute again.
    const restarted = new PersistFlowService({
      store: new FileAuthorityStore(dataDir),
      fleetRouter,
      ephemeralProvider: provider,
      ephemeralEnabled: true,
    });
    const replay = await restarted.executeEphemeralTask(runId, input);
    const run = restarted.inspectRun(runId);
    const operation = run.ephemeralOperations[operationId];
    const completedEvent = operation.events.find((event) => event.type === 'ephemeral.worker.completed');
    const workerId = completedEvent?.worker?.id || '';
    const keyPath = path.join(provider.keyRoot, workerId);
    process.stdout.write(JSON.stringify({
      status: 'completed',
      runId,
      generation: run.generation,
      operationId,
      correlationId: operation.correlationId,
      provider: operation.provider,
      selectedNodeId: operation.selectedNodeId,
      routingEvidence: operation.routingEvidence,
      workerGeneration: operation.workerGeneration,
      workerId,
      workerDeadline: completedEvent?.worker?.buildExpiresAt || null,
      checkpoints: operation.events.filter((event) => event.type.startsWith('ephemeral.worker.')).map((event) => event.type),
      result: result.result,
      restartStatus: replay.operation.status,
      restartReplaySuppressed: replay.replayed === true,
      privateKeyRemoved: workerId ? !fs.existsSync(keyPath) : null,
      desktopNodeEligible: false,
      authority: store.kind,
    }, null, 2) + '\n');
  } finally {
    // If the bounded probe fails, remove this smoke's private key files; Railway's anonymous VM expires under its offer lifecycle.
    if (!completed) {
      for (let generation = 1; generation <= 3; generation += 1) {
        const workerId = runId + '-' + operationId + '-g' + generation;
        await provider.release({ keyPath: path.join(provider.keyRoot, workerId) });
      }
    }
  }
}

main().catch((error) => {
  const message = String(error?.message || error);
  process.stderr.write((/^[A-Z][A-Z0-9_:-]{0,120}$/.test(message) ? message : 'RAILWAY_PERSISTFLOW_SMOKE_FAILED') + '\n');
  process.exitCode = 1;
});

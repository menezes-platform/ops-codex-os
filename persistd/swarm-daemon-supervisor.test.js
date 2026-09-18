'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSwarmDaemon, loadRegistry } = require('./src/swarm/swarm-daemon');
const { supervisorTick, TaskStatus } = require('./src/swarm/swarm-supervisor');

const NOW = Date.parse('2026-09-18T23:45:00.000Z');

test('daemon -> supervisor integration preserves tasks and durable assignments across registry normalization', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-daemon-supervisor-'));
  const registryPath = path.join(root, 'registry.json');
  const statePath = path.join(root, 'state.json');

  fs.writeFileSync(registryPath, JSON.stringify({
    version: '1.0.0',
    workers: {
      open: {
        id: 'open',
        type: 'opencode',
        adapter: 'test',
        enabled: true,
      },
    },
    tasks: {
      task1: {
        id: 'task1',
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        priority: 50,
        createdAt: '2026-09-18T23:00:00.000Z',
      },
    },
  }, null, 2));

  let dispatchCount = 0;
  const daemon = createSwarmDaemon({
    registryPath,
    statePath,
    once: true,
    supervisorTick,
    probeAdapters: {
      opencode: async (worker) => ({
        workerId: worker.id,
        workerType: 'opencode',
        processAlive: true,
        atStartScreen: true,
        providerConfigured: true,
        provider: 'omniroute',
        observedAt: new Date(NOW).toISOString(),
      }),
    },
    dispatchers: {
      test: async () => {
        dispatchCount += 1;
        return { ok: true, status: 'STARTED', evidence: 'pid:4242' };
      },
    },
    clock: {
      now: () => NOW,
      setTimeout,
      clearTimeout,
    },
  });

  const state = await daemon.start();
  assert.equal(dispatchCount, 1);
  assert.equal(state.registry.tasks.task1.status, TaskStatus.RUNNING);
  assert.equal(state.registry.tasks.task1.assignedWorkerId, 'open');
  assert.equal(state.registry.workers.open.currentTaskId, 'task1');
  assert.ok(state.snapshots.open);
  assert.ok(state.classifications.open);

  const persisted = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(persisted.tasks.task1.status, TaskStatus.RUNNING);
  assert.equal(persisted.workers.open.currentTaskId, 'task1');
  assert.equal(fs.existsSync(statePath), true);

  const reloaded = loadRegistry(registryPath);
  assert.equal(reloaded.tasks.task1.status, TaskStatus.RUNNING);
  assert.equal(reloaded.workers.length, 1);
  assert.equal(reloaded.workers[0].id, 'open');

  fs.rmSync(root, { recursive: true, force: true });
});

test('supervisor normalization accepts daemon worker/task arrays without losing stable ids', async () => {
  const result = await supervisorTick({
    registry: {
      workers: [{ id: 'w1', type: 'opencode', adapter: 'test', enabled: true }],
      tasks: [{ id: 't1', status: 'PENDING', priority: 1, maxAttempts: 3 }],
    },
    snapshots: {
      w1: {
        workerId: 'w1',
        workerType: 'opencode',
        processAlive: true,
        atStartScreen: true,
        providerConfigured: true,
        observedAt: new Date(NOW).toISOString(),
      },
    },
    dispatchers: { test: async () => ({ ok: true, status: 'STARTED' }) },
    clock: () => new Date(NOW),
  });

  assert.equal(result.registry.workers.w1.id, 'w1');
  assert.equal(result.registry.tasks.t1.id, 't1');
  assert.equal(result.registry.tasks.t1.status, TaskStatus.RUNNING);
});

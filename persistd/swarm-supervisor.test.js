'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TaskStatus,
  supervisorTick,
  readRegistry,
  writeRegistryAtomic,
} = require('./src/swarm/swarm-supervisor');

const NOW = new Date('2026-09-18T23:30:00.000Z');
const clock = () => NOW;

function readyOpenCode(id) {
  return {
    workerId: id,
    workerType: 'opencode',
    processAlive: true,
    atStartScreen: true,
    providerConfigured: true,
    provider: 'omniroute',
    observedAt: NOW.toISOString(),
  };
}

function idleWorker(id, extra = {}) {
  return {
    id,
    type: 'opencode',
    adapter: 'test',
    enabled: true,
    ...extra,
  };
}

function pendingTask(id, extra = {}) {
  return {
    id,
    status: TaskStatus.PENDING,
    attempts: 0,
    maxAttempts: 3,
    priority: 10,
    createdAt: '2026-09-18T23:00:00.000Z',
    ...extra,
  };
}
test('idle ready worker receives highest-priority compatible task and lease', async () => {
  const registry = {
    workers: { w1: idleWorker('w1') },
    tasks: {
      low: pendingTask('low', { priority: 1 }),
      high: pendingTask('high', { priority: 50 }),
    },
  };
  const calls = [];
  const result = await supervisorTick({
    registry,
    snapshots: { w1: readyOpenCode('w1') },
    dispatchers: {
      test: async ({ task }) => {
        calls.push(task.id);
        return { ok: true, status: 'STARTED', evidence: 'pid:123' };
      },
    },
    clock,
  });
  assert.deepEqual(calls, ['high']);
  assert.equal(result.registry.tasks.high.status, TaskStatus.RUNNING);
  assert.equal(result.registry.tasks.high.assignedWorkerId, 'w1');
  assert.equal(result.registry.workers.w1.currentTaskId, 'high');
  assert.ok(Date.parse(result.registry.tasks.high.leaseExpiresAt) > NOW.getTime());
  assert.equal(result.registry.tasks.low.status, TaskStatus.PENDING);
});

test('conflictKey prevents simultaneous dispatch into same mutable lane', async () => {
  const registry = {
    workers: { w1: idleWorker('w1'), w2: idleWorker('w2') },
    tasks: {
      a: pendingTask('a', { conflictKey: 'persistd-core', priority: 20 }),
      b: pendingTask('b', { conflictKey: 'persistd-core', priority: 10 }),
    },
  };
  const calls = [];
  const result = await supervisorTick({
    registry,
    snapshots: { w1: readyOpenCode('w1'), w2: readyOpenCode('w2') },
    dispatchers: { test: async ({ worker, task }) => {
      calls.push([worker.id, task.id]);
      return { ok: true, status: 'STARTED' };
    } },
    clock,
  });
  assert.equal(calls.length, 1);
  assert.equal(result.registry.tasks.a.status, TaskStatus.RUNNING);
  assert.equal(result.registry.tasks.b.status, TaskStatus.PENDING);
});
test('fresh ChatGPT progress renews an existing lease instead of redispatching', async () => {
  const previous = {
    workerId: 'chat',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 4,
    lastProgressAt: '2026-09-18T23:29:40.000Z',
    observedAt: '2026-09-18T23:29:40.000Z',
  };
  const current = {
    ...previous,
    toolCount: 5,
    lastProgressAt: '2026-09-18T23:29:59.000Z',
    observedAt: NOW.toISOString(),
  };
  const registry = {
    workers: {
      chat: {
        id: 'chat',
        type: 'chatgpt-browser',
        adapter: 'chat',
        currentTaskId: 'active',
        lastSnapshot: previous,
      },
    },
    tasks: {
      active: {
        id: 'active',
        status: TaskStatus.RUNNING,
        attempts: 1,
        maxAttempts: 3,
        assignedWorkerId: 'chat',
        leaseExpiresAt: '2026-09-18T23:30:05.000Z',
      },
    },
  };
  const result = await supervisorTick({
    registry,
    snapshots: { chat: current },
    dispatchers: { chat: async () => { throw new Error('must-not-dispatch'); } },
    clock,
  });
  assert.equal(result.registry.workers.chat.status, 'WORKING');
  assert.equal(result.registry.tasks.active.status, TaskStatus.RUNNING);
  assert.ok(Date.parse(result.registry.tasks.active.leaseExpiresAt) >= NOW.getTime() + 90_000);
  assert.equal(result.events.some((event) => event.type === 'DISPATCHED'), false);
});
test('DONE worker releases completed task and is immediately eligible for next independent task', async () => {
  const registry = {
    workers: {
      agy: {
        id: 'agy',
        type: 'antigravity/agy',
        adapter: 'test',
        currentTaskId: 'old',
      },
    },
    tasks: {
      old: {
        id: 'old',
        status: TaskStatus.RUNNING,
        attempts: 1,
        maxAttempts: 3,
        assignedWorkerId: 'agy',
        leaseExpiresAt: '2026-09-18T23:31:00.000Z',
      },
      next: pendingTask('next', { priority: 25 }),
    },
  };
  const snapshot = {
    workerId: 'agy',
    workerType: 'antigravity/agy',
    processAlive: true,
    runnerRunning: true,
    taskStatus: 'DONE',
    lastTask: { id: 'old', status: 'DONE' },
    observedAt: NOW.toISOString(),
  };
  const result = await supervisorTick({
    registry,
    snapshots: { agy: snapshot },
    dispatchers: { test: async () => ({ ok: true, status: 'STARTED' }) },
    clock,
  });
  assert.equal(result.registry.tasks.old.status, TaskStatus.DONE);
  assert.equal(result.registry.tasks.next.status, TaskStatus.RUNNING);
  assert.equal(result.registry.workers.agy.currentTaskId, 'next');
  assert.equal(result.registry.workers.agy.lastCompletedTaskId, 'old');
});
test('STALE ChatGPT is requeued and put on cooldown instead of counted as working', async () => {
  const previous = {
    workerId: 'chat',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 22,
    lastProgressAt: '2026-09-18T23:28:30.000Z',
    observedAt: '2026-09-18T23:29:00.000Z',
  };
  const current = {
    ...previous,
    observedAt: NOW.toISOString(),
  };
  const registry = {
    workers: {
      chat: {
        id: 'chat',
        type: 'chatgpt-browser',
        adapter: 'chat',
        currentTaskId: 'sync',
        lastSnapshot: previous,
      },
    },
    tasks: {
      sync: {
        id: 'sync',
        status: TaskStatus.RUNNING,
        attempts: 1,
        maxAttempts: 3,
        assignedWorkerId: 'chat',
        leaseExpiresAt: '2026-09-18T23:31:00.000Z',
      },
    },
  };
  const result = await supervisorTick({
    registry,
    snapshots: { chat: current },
    dispatchers: { chat: async () => ({ ok: true }) },
    clock,
  });
  assert.equal(result.registry.workers.chat.status, 'STALE');
  assert.equal(result.registry.workers.chat.currentTaskId, null);
  assert.equal(result.registry.tasks.sync.status, TaskStatus.PENDING);
  assert.ok(Date.parse(result.registry.tasks.sync.retryAt) > NOW.getTime());
  assert.ok(Date.parse(result.registry.workers.chat.cooldownUntil) > NOW.getTime());
});
test('true human gate blocks task and is never automatically reassigned', async () => {
  const registry = {
    workers: {
      claw: {
        id: 'claw',
        type: 'openclaw/myclawn',
        adapter: 'test',
        currentTaskId: 'qa',
      },
      spare: idleWorker('spare'),
    },
    tasks: {
      qa: {
        id: 'qa',
        status: TaskStatus.RUNNING,
        attempts: 1,
        maxAttempts: 3,
        humanGate: true,
        assignedWorkerId: 'claw',
        leaseExpiresAt: '2026-09-18T23:31:00.000Z',
      },
    },
  };
  const result = await supervisorTick({
    registry,
    snapshots: {
      claw: {
        workerId: 'claw',
        workerType: 'openclaw/myclawn',
        connected: true,
        processAlive: true,
        authenticated: false,
        needsAuth: true,
        observedAt: NOW.toISOString(),
      },
      spare: readyOpenCode('spare'),
    },
    dispatchers: { test: async () => ({ ok: true }) },
    clock,
  });
  assert.equal(result.registry.tasks.qa.status, TaskStatus.BLOCKED);
  assert.equal(result.registry.tasks.qa.assignedWorkerId, 'claw');
  assert.equal(result.events.some((event) => event.type === 'DISPATCHED' && event.taskId === 'qa'), false);
});
test('retry exhaustion converts repeated STALE failure into durable BLOCKED state', async () => {
  const previous = {
    workerId: 'chat',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    toolCount: 7,
    lastProgressAt: '2026-09-18T23:20:00.000Z',
    observedAt: '2026-09-18T23:28:00.000Z',
  };
  const registry = {
    workers: {
      chat: {
        id: 'chat',
        type: 'chatgpt-browser',
        adapter: 'chat',
        currentTaskId: 'hard',
        lastSnapshot: previous,
      },
    },
    tasks: {
      hard: {
        id: 'hard',
        status: TaskStatus.RUNNING,
        attempts: 3,
        maxAttempts: 3,
        assignedWorkerId: 'chat',
        leaseExpiresAt: '2026-09-18T23:31:00.000Z',
      },
    },
  };
  const result = await supervisorTick({
    registry,
    snapshots: { chat: { ...previous, observedAt: NOW.toISOString() } },
    dispatchers: {},
    clock,
  });
  assert.equal(result.registry.tasks.hard.status, TaskStatus.BLOCKED);
  assert.equal(result.registry.tasks.hard.blockedReason, 'RETRY_EXHAUSTED');
  assert.equal(result.registry.workers.chat.currentTaskId, null);
});

test('registry persistence is atomic and round-trips normalized state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-swarm-'));
  const file = path.join(root, 'registry.json');
  writeRegistryAtomic(file, {
    workers: { w1: idleWorker('w1') },
    tasks: { t1: pendingTask('t1') },
  });
  const loaded = readRegistry(file);
  assert.equal(loaded.workers.w1.id, 'w1');
  assert.equal(loaded.tasks.t1.id, 't1');
  assert.equal(loaded.tasks.t1.status, TaskStatus.PENDING);
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.readdirSync(root).filter((name) => name.includes('.tmp-')).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

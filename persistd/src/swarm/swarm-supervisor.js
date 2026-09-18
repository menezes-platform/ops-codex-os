'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WorkerStatus, classifyWorkerSnapshot } = require('./worker-probes');

const TaskStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  BLOCKED: 'BLOCKED',
});

const DEFAULTS = Object.freeze({
  leaseMs: 90_000,
  idleGraceMs: 30_000,
  retryDelayMs: 15_000,
  maxAttempts: 3,
});

function parseTime(value) {
  if (!value) return NaN;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : NaN;
}

function iso(ms) { return new Date(ms).toISOString(); }

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}
function normalizeRegistry(input = {}) {
  const registry = clone(input);
  registry.version = Number(registry.version || 1);
  registry.revision = Number(registry.revision || 0);
  const workersInput = registry.workers;
  if (Array.isArray(workersInput)) {
    registry.workers = Object.fromEntries(workersInput.map((worker, index) => {
      const id = String(worker?.id || worker?.workerId || `worker-${index + 1}`);
      return [id, { ...(worker || {}), id }];
    }));
  } else {
    registry.workers = workersInput && typeof workersInput === 'object' ? workersInput : {};
  }

  const tasksInput = registry.tasks;
  if (Array.isArray(tasksInput)) {
    registry.tasks = Object.fromEntries(tasksInput.map((task, index) => {
      const id = String(task?.id || `task-${index + 1}`);
      return [id, { ...(task || {}), id }];
    }));
  } else {
    registry.tasks = tasksInput && typeof tasksInput === 'object' ? tasksInput : {};
  }

  for (const [id, worker] of Object.entries(registry.workers)) {
    worker.id = worker.id || id;
    worker.enabled = worker.enabled !== false;
    worker.status = worker.status || WorkerStatus.IDLE;
    worker.currentTaskId = worker.currentTaskId || null;
  }
  for (const [id, task] of Object.entries(registry.tasks)) {
    task.id = task.id || id;
    task.status = task.status || TaskStatus.PENDING;
    task.attempts = Number(task.attempts || 0);
    task.maxAttempts = Number(task.maxAttempts || DEFAULTS.maxAttempts);
    task.priority = Number(task.priority || 0);
  }
  return registry;
}

function leaseExpired(task, nowMs) {
  const expiresAt = parseTime(task?.leaseExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

function isHumanGate(worker, classification, task) {
  return Boolean(
    worker?.humanGate ||
    task?.humanGate ||
    classification?.evidence?.humanGate ||
    classification?.reason === 'HUMAN_GATE'
  );
}
function requeueTask(task, nowMs, reason, retryDelayMs) {
  task.assignedWorkerId = null;
  task.leaseExpiresAt = null;
  task.lastError = reason || null;
  if (task.attempts >= task.maxAttempts) {
    task.status = TaskStatus.BLOCKED;
    task.blockedReason = 'RETRY_EXHAUSTED';
    task.retryAt = null;
  } else {
    task.status = TaskStatus.PENDING;
    task.retryAt = iso(nowMs + retryDelayMs);
  }
}

function reconcileWorker(registry, worker, snapshot, nowMs, options) {
  const previous = worker.lastSnapshot || null;
  const classification = classifyWorkerSnapshot(
    snapshot || { workerId: worker.id, workerType: worker.type, offline: true, observedAt: iso(nowMs) },
    previous,
    { now: nowMs, ...(worker.probeOptions || {}) }
  );

  worker.previousSnapshot = previous;
  worker.lastSnapshot = snapshot || null;
  worker.status = classification.status;
  worker.reason = classification.reason;
  worker.evidence = classification.evidence;
  worker.observedAt = classification.observedAt;
  worker.splitBrain = Boolean(classification.splitBrain);

  const task = worker.currentTaskId ? registry.tasks[worker.currentTaskId] : null;
  if (!task) {
    worker.currentTaskId = null;
    return classification;
  }
  if (classification.status === WorkerStatus.WORKING) {
    task.status = TaskStatus.RUNNING;
    task.leaseExpiresAt = iso(nowMs + options.leaseMs);
    task.lastProgressAt = classification.observedAt || iso(nowMs);
    worker.leaseExpiresAt = task.leaseExpiresAt;
    return classification;
  }

  if (classification.status === WorkerStatus.DONE) {
    task.status = TaskStatus.DONE;
    task.completedAt = iso(nowMs);
    task.leaseExpiresAt = null;
    task.assignedWorkerId = worker.id;
    worker.lastCompletedTaskId = task.id;
    worker.currentTaskId = null;
    worker.leaseExpiresAt = null;
    return classification;
  }

  if (classification.status === WorkerStatus.BLOCKED && isHumanGate(worker, classification, task)) {
    task.status = TaskStatus.BLOCKED;
    task.blockedReason = classification.reason || 'HUMAN_GATE';
    task.leaseExpiresAt = null;
    worker.leaseExpiresAt = null;
    return classification;
  }

  const dispatchAge = nowMs - parseTime(worker.lastDispatchAt);
  const idleExpired = classification.status === WorkerStatus.IDLE &&
    (leaseExpired(task, nowMs) || !Number.isFinite(dispatchAge) || dispatchAge >= options.idleGraceMs);
  const retryableFailure = [WorkerStatus.STALE, WorkerStatus.ERROR].includes(classification.status);
  const offlineExpired = classification.status === WorkerStatus.OFFLINE && leaseExpired(task, nowMs);
  if (idleExpired || retryableFailure || offlineExpired) {
    requeueTask(task, nowMs, classification.reason || classification.status, options.retryDelayMs);
    worker.currentTaskId = null;
    worker.leaseExpiresAt = null;
    if (retryableFailure) worker.cooldownUntil = iso(nowMs + options.retryDelayMs);
  }
  return classification;
}

function workerMatchesTask(worker, task) {
  if (!worker.enabled) return false;
  if (Array.isArray(task.workerIds) && task.workerIds.length && !task.workerIds.includes(worker.id)) return false;
  if (Array.isArray(task.workerTypes) && task.workerTypes.length && !task.workerTypes.includes(worker.type)) return false;
  if (task.lane && Array.isArray(worker.lanes) && worker.lanes.length && !worker.lanes.includes(task.lane)) return false;
  return true;
}

function activeConflictKeys(registry) {
  const keys = new Set();
  for (const task of Object.values(registry.tasks)) {
    if (task.status !== TaskStatus.RUNNING) continue;
    if (task.conflictKey) keys.add(task.conflictKey);
  }
  return keys;
}

function chooseTask(registry, worker, nowMs) {
  const activeKeys = activeConflictKeys(registry);
  return Object.values(registry.tasks)
    .filter((task) => task.status === TaskStatus.PENDING)
    .filter((task) => !task.retryAt || parseTime(task.retryAt) <= nowMs)
    .filter((task) => workerMatchesTask(worker, task))
    .filter((task) => !task.conflictKey || !activeKeys.has(task.conflictKey))
    .sort((a, b) => (b.priority - a.priority) ||
      (parseTime(a.createdAt) || 0) - (parseTime(b.createdAt) || 0) ||
      a.id.localeCompare(b.id))[0] || null;
}
async function dispatchTask(registry, worker, task, dispatchers, nowMs, options) {
  const adapter = worker.adapter || worker.type;
  const dispatcher = dispatchers?.[adapter];
  if (typeof dispatcher !== 'function') {
    worker.status = WorkerStatus.ERROR;
    worker.reason = 'DISPATCHER_MISSING';
    worker.cooldownUntil = iso(nowMs + options.retryDelayMs);
    return { ok: false, status: 'DISPATCHER_MISSING' };
  }

  task.attempts += 1;
  task.lastAttemptAt = iso(nowMs);
  let result;
  try {
    result = await dispatcher({ worker: clone(worker), task: clone(task), registry: clone(registry) });
  } catch (error) {
    result = { ok: false, status: 'DISPATCH_ERROR', error: error?.message || String(error) };
  }

  if (result?.ok === false) {
    requeueTask(task, nowMs, result.status || result.error || 'DISPATCH_FAILED', options.retryDelayMs);
    worker.status = WorkerStatus.ERROR;
    worker.reason = result.status || 'DISPATCH_FAILED';
    worker.cooldownUntil = iso(nowMs + options.retryDelayMs);
    return result;
  }

  task.status = TaskStatus.RUNNING;
  task.assignedWorkerId = worker.id;
  task.startedAt = task.startedAt || iso(nowMs);
  task.lastDispatchAt = iso(nowMs);
  task.leaseExpiresAt = iso(nowMs + options.leaseMs);
  task.dispatchEvidence = result?.evidence || result?.status || 'DISPATCH_ACCEPTED';
  worker.currentTaskId = task.id;
  worker.lastDispatchAt = iso(nowMs);
  worker.leaseExpiresAt = task.leaseExpiresAt;
  worker.status = WorkerStatus.WORKING;
  worker.reason = 'DISPATCHED';
  return { ok: true, ...result };
}
async function supervisorTick({
  registry: inputRegistry,
  snapshots = {},
  dispatchers = {},
  clock = () => new Date(),
  ...overrides
}) {
  const options = { ...DEFAULTS, ...overrides };
  const now = clock();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('INVALID_CLOCK');

  const registry = normalizeRegistry(inputRegistry);
  const events = [];

  for (const worker of Object.values(registry.workers)) {
    const snapshot = snapshots[worker.id] || null;
    const classification = reconcileWorker(registry, worker, snapshot, nowMs, options);
    events.push({ type: 'OBSERVED', workerId: worker.id, status: classification.status, reason: classification.reason });
  }

  for (const worker of Object.values(registry.workers)) {
    if (!worker.enabled || worker.currentTaskId) continue;
    if ([WorkerStatus.OFFLINE, WorkerStatus.BLOCKED].includes(worker.status)) continue;
    const cooldown = parseTime(worker.cooldownUntil);
    if (Number.isFinite(cooldown) && cooldown > nowMs) continue;
    const task = chooseTask(registry, worker, nowMs);
    if (!task) continue;
    const result = await dispatchTask(registry, worker, task, dispatchers, nowMs, options);
    events.push({ type: result?.ok === false ? 'DISPATCH_FAILED' : 'DISPATCHED', workerId: worker.id, taskId: task.id, status: result?.status || null });
  }

  registry.revision += 1;
  registry.updatedAt = iso(nowMs);
  return { registry, events };
}
function readRegistry(filePath) {
  try {
    return normalizeRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeRegistry({});
    throw error;
  }
}

function writeRegistryAtomic(filePath, registry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(normalizeRegistry(registry), null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = {
  TaskStatus,
  DEFAULTS,
  normalizeRegistry,
  leaseExpired,
  isHumanGate,
  requeueTask,
  reconcileWorker,
  workerMatchesTask,
  chooseTask,
  dispatchTask,
  supervisorTick,
  readRegistry,
  writeRegistryAtomic,
};

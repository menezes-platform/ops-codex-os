const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateWatchdog } = require('./src/persistflow/watchdog');
const { isRolloverDue } = require('./src/orchestrator');

const now = new Date('2026-09-15T22:00:00.000Z');

function stateAt(ageMs, status = 'ACTIVE') {
  return {
    STATUS: status,
    CONTROLLER_HEARTBEAT_AT: new Date(now.getTime() - ageMs).toISOString(),
  };
}

test('moves an active run from suspected stall to recovery required', () => {
  const suspected = evaluateWatchdog(stateAt(3 * 60_000), {
    now, stallMs: 2 * 60_000, recoveryMs: 4 * 60_000,
  });
  assert.equal(suspected.status, 'SUSPECTED_STALL');

  const recovery = evaluateWatchdog(stateAt(5 * 60_000), {
    now, stallMs: 2 * 60_000, recoveryMs: 4 * 60_000,
  });
  assert.equal(recovery.status, 'RECOVERY_REQUIRED');
});

test('known busy activity suppresses recovery escalation', () => {
  const result = evaluateWatchdog(stateAt(8 * 60_000), {
    now, stallMs: 2 * 60_000, recoveryMs: 4 * 60_000, busy: true,
  });
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.reason, 'activity_observed');
});

test('unhealthy browser blocks recovery without creating a successor', () => {
  const result = evaluateWatchdog(stateAt(8 * 60_000), {
    now, stallMs: 2 * 60_000, recoveryMs: 4 * 60_000, browserHealthy: false,
  });
  assert.equal(result.status, 'WAITING_BROWSER');
  assert.equal(result.shouldCreateSuccessor, false);
});

test('legacy runs without a heartbeat are ignored by the watchdog', () => {
  assert.equal(evaluateWatchdog({ STATUS: 'ACTIVE' }, { now }).status, 'ACTIVE');
});

test('recovery required reuses the normal rollover path', () => {
  assert.equal(isRolloverDue({ STATUS: 'RECOVERY_REQUIRED' }, now, 20), true);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const orchestrator = require('./src/orchestrator');
const { readControl, writeControlAtomic } = require('./src/control-state');

function makeRun(root, state) {
  const runDir = path.join(root, state.RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const controlPath = path.join(runDir, 'CONTROL.md');
  writeControlAtomic(controlPath, state);
  return controlPath;
}

test('tick enters WAITING_BROWSER and never creates a successor when recovery browser is unhealthy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-watchdog-browser-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'watchdog-browser', GENERATION: '1', STATUS: 'ACTIVE', CHAT_ID: 'chat-1',
    STARTED_AT: '2026-09-15T21:00:00.000Z', CONTROLLER_HEARTBEAT_AT: '2026-09-15T21:50:00.000Z',
  });
  let createCalls = 0;
  const browser = {
    async cleanupRunScratchTabs() {},
    async isRunChatBusy() { return { busy: false }; },
    async createSuccessor() { createCalls++; return {}; },
  };
  const result = await orchestrator.tick({
    root, browser, notifier: {},
    remoteHealth: { async preflight() { return { ok: false, browser: 'UNHEALTHY', desktop: 'HEALTHY' }; } },
    clock: () => now, rolloverMinutes: 999,
    watchdogStallMs: 2 * 60_000, watchdogRecoveryMs: 4 * 60_000,
  });
  assert.equal(result.action, 'WAITING_BROWSER');
  assert.equal(createCalls, 0);
  assert.equal(readControl(controlPath).STATUS, 'WAITING_BROWSER');
});

test('tick treats busy chat activity as a heartbeat and delays recovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistflow-watchdog-busy-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'watchdog-busy', GENERATION: '1', STATUS: 'ACTIVE', CHAT_ID: 'chat-1',
    STARTED_AT: '2026-09-15T21:00:00.000Z', CONTROLLER_HEARTBEAT_AT: '2026-09-15T21:50:00.000Z',
  });
  let createCalls = 0;
  const browser = {
    async cleanupRunScratchTabs() {},
    async isRunChatBusy() { return { busy: true }; },
    async createSuccessor() { createCalls++; return {}; },
  };
  const result = await orchestrator.tick({
    root, browser, notifier: {},
    remoteHealth: { async preflight() { return { ok: true, browser: 'HEALTHY', desktop: 'HEALTHY' }; } },
    clock: () => now, rolloverMinutes: 999,
    watchdogStallMs: 2 * 60_000, watchdogRecoveryMs: 4 * 60_000,
  });
  assert.equal(result.action, 'WORKER_BUSY');
  assert.equal(createCalls, 0);
  const final = readControl(controlPath);
  assert.equal(final.STATUS, 'ACTIVE');
  assert.equal(final.CONTROLLER_HEARTBEAT_AT, now.toISOString());
});

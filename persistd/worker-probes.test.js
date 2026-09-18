'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WorkerStatus,
  normalizeWorkerType,
  detectFreshness,
  detectSplitBrain,
  classifyWorkerSnapshot,
  probeWorkers,
  classifyChatGPTBrowser,
  classifyMyClawn,
  classifyAntigravity,
  classifyOpenCode,
  classifyAgentBrowser,
  classifyOmniRoute,
  classifyRemoteDevice,
} = require('./src/swarm/worker-probes');

test('WorkerStatus defines the complete operational lifecycle set', () => {
  assert.equal(WorkerStatus.IDLE, 'IDLE');
  assert.equal(WorkerStatus.STALE, 'STALE');
  assert.equal(WorkerStatus.BLOCKED, 'BLOCKED');
  assert.equal(WorkerStatus.OFFLINE, 'OFFLINE');
  assert.equal(WorkerStatus.DONE, 'DONE');
  assert.equal(WorkerStatus.ERROR, 'ERROR');
  assert.equal(WorkerStatus.WORKING, 'WORKING');
});

test('normalizeWorkerType maps aliases to canonical worker type identifiers', () => {
  assert.equal(normalizeWorkerType('chatgpt-browser'), 'chatgpt-browser');
  assert.equal(normalizeWorkerType('chatgpt'), 'chatgpt-browser');
  assert.equal(normalizeWorkerType('openclaw/myclawn'), 'openclaw/myclawn');
  assert.equal(normalizeWorkerType('myclawn'), 'openclaw/myclawn');
  assert.equal(normalizeWorkerType('antigravity/agy'), 'antigravity/agy');
  assert.equal(normalizeWorkerType('agy'), 'antigravity/agy');
  assert.equal(normalizeWorkerType('opencode'), 'opencode');
  assert.equal(normalizeWorkerType('headless-browser/agent-browser'), 'headless-browser/agent-browser');
  assert.equal(normalizeWorkerType('agent-browser'), 'headless-browser/agent-browser');
  assert.equal(normalizeWorkerType('omniroute/control-plane'), 'omniroute/control-plane');
  assert.equal(normalizeWorkerType('control-plane'), 'omniroute/control-plane');
  assert.equal(normalizeWorkerType('remote-device'), 'remote-device');
  assert.equal(normalizeWorkerType('device'), 'remote-device');
});

// INCIDENT 1: ChatGPT stop button + timeout with no tool-count change => STALE
test('Incident 1: ChatGPT stop button visible with timeout and no tool-count change classifies as STALE', () => {
  const previous = {
    workerId: 'chatgpt-w1',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 5,
    observedAt: '2026-09-18T20:00:00.000Z',
    lastProgressAt: '2026-09-18T20:00:00.000Z',
  };

  const current = {
    workerId: 'chatgpt-w1',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 5, // No change in tool count
    observedAt: '2026-09-18T20:01:00.000Z', // 60s later, exceeds 30s timeout
    lastProgressAt: '2026-09-18T20:00:00.000Z',
  };

  const result = classifyWorkerSnapshot(current, previous);
  assert.equal(result.status, WorkerStatus.STALE);
  assert.match(result.reason, /NO_TOOL_PROGRESS|STALLED/);
  assert.equal(result.evidence.stopButtonVisible, true);
  assert.equal(result.evidence.toolCount, 5);
  assert.equal(result.evidence.toolDelta, 0);
  assert.ok(result.observedAt);
});

test('ChatGPT browser with advancing tool count or fresh tokens classifies as WORKING', () => {
  const previous = {
    workerId: 'chatgpt-w1',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 5,
    observedAt: '2026-09-18T20:00:00.000Z',
    lastProgressAt: '2026-09-18T20:00:00.000Z',
  };

  const current = {
    workerId: 'chatgpt-w1',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 6, // Tool count advanced
    observedAt: '2026-09-18T20:00:15.000Z',
    lastProgressAt: '2026-09-18T20:00:14.000Z',
  };

  const result = classifyWorkerSnapshot(current, previous);
  assert.equal(result.status, WorkerStatus.WORKING);
  assert.equal(result.evidence.toolCount, 6);
  assert.equal(result.evidence.toolDelta, 1);
});

test('ChatGPT browser with login wall or challenge classifies as BLOCKED', () => {
  const snapshot = {
    workerId: 'chatgpt-w1',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    cloudflareChallenge: true,
    loginRequired: true,
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.BLOCKED);
  assert.match(result.reason, /BLOCKED/);
});

// INCIDENT 2: MyClawn authenticated blank prompt => IDLE
test('Incident 2: MyClawn authenticated blank prompt classifies as IDLE', () => {
  const snapshot = {
    workerId: 'myclawn-1',
    workerType: 'openclaw/myclawn',
    connected: true,
    processAlive: true,
    authenticated: true,
    hasActiveSession: true,
    promptInput: '', // Blank prompt input
    activeTask: null,
    isExecuting: false,
    observedAt: '2026-09-18T20:10:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.IDLE);
  assert.equal(result.reason, 'MYCLAWN_AUTHENTICATED_BLANK_PROMPT');
  assert.equal(result.evidence.authenticated, true);
  assert.equal(result.evidence.promptInput, '');
  assert.equal(result.evidence.isExecuting, false);
});

test('MyClawn unauthenticated classifies as BLOCKED', () => {
  const snapshot = {
    workerId: 'myclawn-1',
    workerType: 'openclaw/myclawn',
    connected: true,
    processAlive: true,
    authenticated: false,
    needsAuth: true,
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.BLOCKED);
  assert.equal(result.reason, 'MYCLAWN_AUTHENTICATION_REQUIRED');
});

test('MyClawn executing with fresh tool progress classifies as WORKING', () => {
  const previous = {
    workerId: 'myclawn-1',
    workerType: 'openclaw/myclawn',
    connected: true,
    authenticated: true,
    isExecuting: true,
    toolCount: 2,
    observedAt: '2026-09-18T20:00:00.000Z',
  };
  const current = {
    workerId: 'myclawn-1',
    workerType: 'openclaw/myclawn',
    connected: true,
    authenticated: true,
    isExecuting: true,
    toolCount: 3,
    observedAt: '2026-09-18T20:00:10.000Z',
  };

  const result = classifyWorkerSnapshot(current, previous);
  assert.equal(result.status, WorkerStatus.WORKING);
});

// INCIDENT 3: Antigravity last task DONE despite residual runner => DONE/IDLE not WORKING
test('Incident 3: Antigravity last task DONE despite residual runner classifies as DONE/IDLE and NOT WORKING', () => {
  const snapshot = {
    workerId: 'agy-orchestrator',
    workerType: 'antigravity/agy',
    processAlive: true,
    runnerRunning: true,
    pid: 9140,
    taskStatus: 'DONE',
    lastTask: {
      id: 'task-auth-hardening',
      status: 'DONE',
    },
    observedAt: '2026-09-18T20:12:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.match(result.status, /^(DONE|IDLE)$/);
  assert.notEqual(result.status, WorkerStatus.WORKING, 'A residual runner must NOT be considered WORKING when task is DONE');
  assert.equal(result.status, WorkerStatus.DONE);
  assert.equal(result.reason, 'ANTIGRAVITY_LAST_TASK_DONE_RESIDUAL_RUNNER');
  assert.equal(result.evidence.residualRunner, true);
  assert.equal(result.evidence.isWorking, false);
});

test('Antigravity process alive with no tasks running classifies as IDLE, not WORKING', () => {
  const snapshot = {
    workerId: 'agy-orchestrator',
    workerType: 'antigravity/agy',
    processAlive: true,
    runnerRunning: true,
    activeTask: null,
    taskStatus: null,
    activeSubagents: 0,
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.IDLE);
  assert.notEqual(result.status, WorkerStatus.WORKING, 'Alive process alone is never proof of work');
});

test('Antigravity running task with fresh subagent tool invocations classifies as WORKING', () => {
  const previous = {
    workerId: 'agy-orchestrator',
    workerType: 'antigravity/agy',
    processAlive: true,
    taskStatus: 'IN_PROGRESS',
    activeSubagents: 2,
    toolCount: 10,
    observedAt: '2026-09-18T20:00:00.000Z',
  };
  const current = {
    workerId: 'agy-orchestrator',
    workerType: 'antigravity/agy',
    processAlive: true,
    taskStatus: 'IN_PROGRESS',
    activeSubagents: 2,
    toolCount: 14,
    observedAt: '2026-09-18T20:00:05.000Z',
  };

  const result = classifyWorkerSnapshot(current, previous);
  assert.equal(result.status, WorkerStatus.WORKING);
  assert.equal(result.evidence.toolDelta, 4);
});

// INCIDENT 4: OpenCode start screen/provider absent => BLOCKED or IDLE
test('Incident 4a: OpenCode start screen with provider absent classifies as BLOCKED or IDLE', () => {
  const snapshot = {
    workerId: 'opencode-local',
    workerType: 'opencode',
    processAlive: true,
    atStartScreen: true,
    providerConfigured: false,
    provider: null,
    observedAt: '2026-09-18T20:14:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.match(result.status, /^(BLOCKED|IDLE)$/);
  assert.equal(result.status, WorkerStatus.BLOCKED);
  assert.equal(result.reason, 'OPENCODE_PROVIDER_ABSENT');
  assert.equal(result.evidence.providerAbsent, true);
});

test('Incident 4b: OpenCode at start screen with provider configured classifies as IDLE', () => {
  const snapshot = {
    workerId: 'opencode-local',
    workerType: 'opencode',
    processAlive: true,
    atStartScreen: true,
    providerConfigured: true,
    provider: 'anthropic',
    observedAt: '2026-09-18T20:14:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.match(result.status, /^(BLOCKED|IDLE)$/);
  assert.equal(result.status, WorkerStatus.IDLE);
  assert.equal(result.reason, 'OPENCODE_START_SCREEN_READY');
});

// INCIDENT 5: agent-browser newtab-only => IDLE
test('Incident 5: agent-browser newtab-only classifies as IDLE', () => {
  const snapshot = {
    workerId: 'agent-browser-0',
    workerType: 'headless-browser/agent-browser',
    browserRunning: true,
    connected: true,
    tabs: ['chrome://newtab/'],
    activeTab: 'chrome://newtab/',
    tabsCount: 1,
    isEvaluating: false,
    navigating: false,
    observedAt: '2026-09-18T20:15:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.IDLE);
  assert.equal(result.reason, 'AGENT_BROWSER_NEWTAB_ONLY');
  assert.equal(result.evidence.newTabOnly, true);
  assert.equal(result.evidence.isEvaluating, false);
});

test('agent-browser with about:blank only classifies as IDLE', () => {
  const snapshot = {
    workerId: 'agent-browser-0',
    workerType: 'headless-browser/agent-browser',
    browserRunning: true,
    connected: true,
    tabs: ['about:blank'],
    activeTab: 'about:blank',
    isEvaluating: false,
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.IDLE);
  assert.equal(result.reason, 'AGENT_BROWSER_NEWTAB_ONLY');
});

test('agent-browser actively evaluating with progress classifies as WORKING', () => {
  const previous = {
    workerId: 'agent-browser-0',
    workerType: 'headless-browser/agent-browser',
    browserRunning: true,
    connected: true,
    tabs: ['https://example.com/app'],
    activeTab: 'https://example.com/app',
    isEvaluating: true,
    toolCount: 1,
    observedAt: '2026-09-18T20:00:00.000Z',
  };
  const current = {
    workerId: 'agent-browser-0',
    workerType: 'headless-browser/agent-browser',
    browserRunning: true,
    connected: true,
    tabs: ['https://example.com/app'],
    activeTab: 'https://example.com/app',
    isEvaluating: true,
    toolCount: 2,
    observedAt: '2026-09-18T20:00:04.000Z',
  };

  const result = classifyWorkerSnapshot(current, previous);
  assert.equal(result.status, WorkerStatus.WORKING);
});

// INCIDENT 6: OmniRoute process/catalog live but health says server down => ERROR/split-brain
test('Incident 6: OmniRoute process/catalog live but health says server down classifies as ERROR with split-brain evidence', () => {
  const snapshot = {
    workerId: 'omniroute-node-1',
    workerType: 'omniroute/control-plane',
    processAlive: true,
    pid: 7712,
    catalogLoaded: true,
    catalogCount: 18,
    health: {
      ok: false,
      status: 'DOWN',
      error: 'connect ECONNREFUSED 127.0.0.1:9090',
    },
    observedAt: '2026-09-18T20:16:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.ERROR);
  assert.equal(result.splitBrain, true);
  assert.equal(result.reason, 'SPLIT_BRAIN_PROCESS_ALIVE_HEALTH_DOWN');
  assert.equal(result.evidence.splitBrain, true);
  assert.equal(result.evidence.processAlive, true);
  assert.equal(result.evidence.catalogLive, true);
  assert.equal(result.evidence.healthDown, true);
});

test('OmniRoute healthy with 0 active routings classifies as IDLE', () => {
  const snapshot = {
    workerId: 'omniroute-node-1',
    workerType: 'omniroute/control-plane',
    processAlive: true,
    catalogLoaded: true,
    catalogCount: 18,
    health: {
      ok: true,
      status: 'UP',
    },
    activeRoutingCount: 0,
    observedAt: '2026-09-18T20:16:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.IDLE);
  assert.equal(result.reason, 'OMNIROUTE_LISTENING_IDLE');
  assert.equal(result.splitBrain, false);
});

test('OmniRoute healthy with active routing traffic classifies as WORKING', () => {
  const snapshot = {
    workerId: 'omniroute-node-1',
    workerType: 'omniroute/control-plane',
    processAlive: true,
    catalogLoaded: true,
    health: { ok: true, status: 'UP' },
    activeRoutingCount: 4,
    lastProgressAt: '2026-09-18T20:16:00.000Z',
    observedAt: '2026-09-18T20:16:02.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot, null, { timeoutMs: 10000 });
  assert.equal(result.status, WorkerStatus.WORKING);
  assert.equal(result.reason, 'OMNIROUTE_ROUTING_ACTIVE');
});

// INCIDENT 7: remote device status offline => OFFLINE
test('Incident 7: remote device status offline classifies as OFFLINE', () => {
  const snapshot = {
    workerId: 'android-pixel-01',
    workerType: 'remote-device',
    status: 'offline',
    connected: false,
    pingOk: false,
    observedAt: '2026-09-18T20:17:00.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot);
  assert.equal(result.status, WorkerStatus.OFFLINE);
  assert.equal(result.reason, 'REMOTE_DEVICE_OFFLINE');
  assert.equal(result.evidence.connected, false);
});

test('remote device connected and executing with fresh heartbeat classifies as WORKING', () => {
  const snapshot = {
    workerId: 'android-pixel-01',
    workerType: 'remote-device',
    status: 'busy',
    connected: true,
    currentRunId: 'run-remote-apk-10',
    lastHeartbeatAt: '2026-09-18T20:17:00.000Z',
    observedAt: '2026-09-18T20:17:05.000Z',
  };

  const result = classifyWorkerSnapshot(snapshot, null, { timeoutMs: 30000 });
  assert.equal(result.status, WorkerStatus.WORKING);
  assert.equal(result.evidence.currentRunId, 'run-remote-apk-10');
});

test('remote device connected but heartbeat expired classifies as STALE', () => {
  const snapshot = {
    workerId: 'android-pixel-01',
    workerType: 'remote-device',
    status: 'busy',
    connected: true,
    currentRunId: 'run-remote-apk-10',
    lastHeartbeatAt: '2026-09-18T20:00:00.000Z',
    observedAt: '2026-09-18T20:02:00.000Z', // 120s later
  };

  const result = classifyWorkerSnapshot(snapshot, null, { timeoutMs: 30000 });
  assert.equal(result.status, WorkerStatus.STALE);
  assert.equal(result.reason, 'REMOTE_DEVICE_HEARTBEAT_EXPIRED');
});

// Freshness and Split-brain Helpers
test('detectFreshness distinguishes advancement vs stall', () => {
  const prev = {
    toolCount: 3,
    outputLength: 100,
    observedAt: '2026-09-18T20:00:00.000Z',
  };
  const advanced = {
    toolCount: 4,
    outputLength: 150,
    observedAt: '2026-09-18T20:00:10.000Z',
  };
  const stalled = {
    toolCount: 3,
    outputLength: 100,
    observedAt: '2026-09-18T20:01:00.000Z',
  };

  const freshResult = detectFreshness(advanced, prev, { timeoutMs: 30000 });
  assert.equal(freshResult.isFresh, true);
  assert.equal(freshResult.hasChanged, true);
  assert.equal(freshResult.toolDelta, 1);
  assert.equal(freshResult.outputDelta, 50);

  const staleResult = detectFreshness(stalled, prev, { timeoutMs: 30000 });
  assert.equal(staleResult.isFresh, false);
  assert.equal(staleResult.hasChanged, false);
  assert.equal(staleResult.toolDelta, 0);
  assert.equal(staleResult.outputDelta, 0);
});

test('detectSplitBrain detects both process alive/health down and process dead/health up', () => {
  const liveProcessHealthDown = {
    processAlive: true,
    pid: 1234,
    healthOk: false,
    healthStatus: 'DOWN',
  };
  const r1 = detectSplitBrain(liveProcessHealthDown);
  assert.equal(r1.isSplitBrain, true);
  assert.equal(r1.reason, 'SPLIT_BRAIN_PROCESS_ALIVE_HEALTH_DOWN');

  const deadProcessHealthUp = {
    processAlive: false,
    healthOk: true,
  };
  const r2 = detectSplitBrain(deadProcessHealthUp);
  assert.equal(r2.isSplitBrain, true);
  assert.equal(r2.reason, 'SPLIT_BRAIN_PROCESS_DEAD_HEALTH_UP');

  const concordant = {
    processAlive: true,
    health: { ok: true, status: 'UP' },
  };
  const r3 = detectSplitBrain(concordant);
  assert.equal(r3.isSplitBrain, false);
});

test('probeWorkers processes multi-worker batches maintaining correlation', () => {
  const snapshots = [
    {
      workerId: 'w-chatgpt',
      workerType: 'chatgpt-browser',
      browserRunning: true,
      stopButtonVisible: true,
      toolCount: 1,
      lastProgressAt: '2026-09-18T20:00:00.000Z',
      observedAt: '2026-09-18T20:02:00.000Z',
    },
    {
      workerId: 'w-myclawn',
      workerType: 'openclaw/myclawn',
      connected: true,
      authenticated: true,
      promptInput: '',
    },
    {
      workerId: 'w-device',
      workerType: 'remote-device',
      status: 'offline',
    },
  ];

  const results = probeWorkers(snapshots);
  assert.equal(results.length, 3);
  assert.equal(results[0].workerId, 'w-chatgpt');
  assert.equal(results[0].status, WorkerStatus.STALE);
  assert.equal(results[1].workerId, 'w-myclawn');
  assert.equal(results[1].status, WorkerStatus.IDLE);
  assert.equal(results[2].workerId, 'w-device');
  assert.equal(results[2].status, WorkerStatus.OFFLINE);
});

test('classifyWorkerSnapshot handles malformed inputs safely without throwing', () => {
  const resultNull = classifyWorkerSnapshot(null);
  assert.equal(resultNull.status, WorkerStatus.ERROR);
  assert.equal(resultNull.reason, 'INVALID_SNAPSHOT_INPUT');

  const resultEmpty = classifyWorkerSnapshot({});
  assert.equal(resultEmpty.workerType, 'generic');
  assert.ok(resultEmpty.observedAt);
});

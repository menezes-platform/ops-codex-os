'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  validateDispatch,
  dispatchCommand,
  dispatchAntigravityWorker,
  dispatchOpenCodeWorker,
  isProcessAlive,
  readLogTail,
} = require('./src/swarm/dispatchers');
const {
  buildChatGPTProbeScript,
  buildGenericChatGPTSendScript,
} = require('./src/browser/conversation-script');
const { createEgoBrowserTransport } = require('./src/browser/ego-browser');
const {
  parseDaemonArgs,
  loadRegistry,
  collectWorkerSnapshots,
  createSwarmDaemon,
  persistStateAtomic,
} = require('./src/swarm/swarm-daemon');
const {
  classifyChatGPTBrowser,
  classifyAntigravity,
  classifyOpenCode,
  WorkerStatus,
} = require('./src/swarm/worker-probes');

// ============================================================================
// 1. DISPATCH ESCAPING & SHELL INJECTION PREVENTION
// ============================================================================

test('dispatch rejects commands with shell metacharacters and chaining attempts', () => {
  const maliciousCommands = [
    'agy; rm -rf /',
    'agy && echo pwned',
    'agy | nc localhost 4444',
    'agy > output.txt',
    'agy < input.txt',
    'agy`whoami`',
    'agy$(id)',
    'agy\ncat /etc/passwd',
    'agy\r\nevil',
  ];

  for (const cmd of maliciousCommands) {
    assert.throws(
      () => validateDispatch(cmd, []),
      /SHELL_INJECTION_DETECTED/,
      `Should reject command: ${cmd}`
    );
  }
});

test('dispatch rejects null bytes in command or arguments', () => {
  assert.throws(
    () => validateDispatch('agy\0evil', []),
    /SHELL_INJECTION_DETECTED/,
    'Should reject null byte in command'
  );

  assert.throws(
    () => validateDispatch('agy', ['safe', 'arg\0injection']),
    /SHELL_INJECTION_DETECTED/,
    'Should reject null byte in args'
  );
});

test('dispatch enforces shell: false even if caller requests shell', async () => {
  let capturedOptions = null;
  const mockSpawn = (cmd, args, opts) => {
    capturedOptions = opts;
    const child = new EventEmitter();
    child.pid = 9999;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => {}, end: () => {} };
    return child;
  };

  await dispatchCommand({
    command: 'agy',
    args: ['--task', 'foo; bar & baz'],
    shell: true, // Caller tries to enable shell
    spawnFn: mockSpawn,
    fsModule: {
      existsSync: () => true,
      mkdirSync: () => {},
      createWriteStream: () => ({ write: () => {}, on: () => {}, end: () => {} }),
    },
  });

  assert.equal(capturedOptions.shell, false, 'shell must strictly remain false');
  assert.deepEqual(capturedOptions.stdio, ['ignore', 'pipe', 'pipe']);
});

test('dispatch preserves arguments with special characters verbatim without shell expansion', async () => {
  let spawnedArgs = null;
  const mockSpawn = (cmd, args) => {
    spawnedArgs = args;
    const child = new EventEmitter();
    child.pid = 1234;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => {}, end: () => {} };
    return child;
  };

  const riskyArgs = [
    '--prompt', 'Write a script with $VAR && rm -rf / || echo "quoted text" & bg',
    '--filter', '*.js',
    '--path', 'C:\\Program Files\\App (x86)\\test',
    '--json', '{"key": "value with spaces and > pipes"}',
  ];

  await dispatchCommand({
    command: 'opencode',
    args: riskyArgs,
    spawnFn: mockSpawn,
    fsModule: {
      existsSync: () => true,
      mkdirSync: () => {},
      createWriteStream: () => ({ write: () => {}, on: () => {}, end: () => {} }),
    },
  });

  assert.deepEqual(spawnedArgs, riskyArgs, 'Arguments must be passed untouched in array form');
});

// ============================================================================
// 2. CHILD START EVIDENCE & LOGGING
// ============================================================================

test('dispatchCommand returns child start evidence with PID, logPath, and taskMarker', async () => {
  const logWrites = [];
  const mockStream = {
    write: (data) => logWrites.push(String(data)),
    on: () => {},
    end: () => {},
  };

  const mockChild = new EventEmitter();
  mockChild.pid = 54321;
  mockChild.stdout = new EventEmitter();
  mockChild.stderr = new EventEmitter();
  mockChild.stdin = { write: () => {}, end: () => {} };

  const evidence = await dispatchCommand({
    command: 'agy',
    args: ['--workspace', '/repos/project'],
    cwd: '/repos/project',
    workerId: 'agy-worker-1',
    workerType: 'antigravity/agy',
    taskMarker: 'MARKER_ABC_123',
    taskMarkerArg: '--marker',
    logPath: '/repos/project/.persistd/logs/agy-1.log',
    spawnFn: () => mockChild,
    fsModule: {
      existsSync: () => true,
      mkdirSync: () => {},
      createWriteStream: () => mockStream,
    },
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.pid, 54321);
  assert.equal(evidence.workerId, 'agy-worker-1');
  assert.equal(evidence.workerType, 'antigravity/agy');
  assert.equal(evidence.taskMarker, 'MARKER_ABC_123');
  assert.equal(evidence.command, 'agy');
  assert.deepEqual(evidence.args, ['--workspace', '/repos/project', '--marker', 'MARKER_ABC_123']);
  assert.equal(evidence.cwd, '/repos/project');
  assert.equal(evidence.logPath, '/repos/project/.persistd/logs/agy-1.log');
  assert.equal(evidence.processAlive, true);
  assert.ok(evidence.startedAt);

  // Verify durable log header was written
  const combinedLog = logWrites.join('');
  assert.match(combinedLog, /=== \[SWARM_DISPATCH:START\] ===/);
  assert.match(combinedLog, /WORKER_ID: agy-worker-1/);
  assert.match(combinedLog, /TASK_MARKER: MARKER_ABC_123/);
});

test('dispatchCommand injects prompt safely via stdin and records evidence', async () => {
  const stdinChunks = [];
  let stdinEnded = false;

  const mockChild = new EventEmitter();
  mockChild.pid = 6789;
  mockChild.stdout = new EventEmitter();
  mockChild.stderr = new EventEmitter();
  mockChild.stdin = {
    write: (chunk) => stdinChunks.push(String(chunk)),
    end: () => { stdinEnded = true; },
  };

  const evidence = await dispatchCommand({
    command: 'opencode',
    workerId: 'opencode-worker-1',
    prompt: 'Implement feature X safely\nDo not break tests',
    injectPromptViaStdin: true,
    spawnFn: () => mockChild,
    fsModule: {
      existsSync: () => true,
      mkdirSync: () => {},
      createWriteStream: () => ({ write: () => {}, on: () => {}, end: () => {} }),
    },
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.promptInjected, true);
  assert.equal(stdinEnded, true);
  assert.equal(stdinChunks.join('').trim(), 'Implement feature X safely\nDo not break tests');
});

test('dispatchCommand handles immediate spawn errors without unhandled exceptions', async () => {
  const mockSpawn = () => {
    const child = new EventEmitter();
    child.pid = undefined;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    // Simulate immediate ENOENT error
    setImmediate(() => {
      child.emit('error', new Error('spawn agy ENOENT'));
    });
    return child;
  };

  const evidence = await dispatchCommand({
    command: 'agy',
    workerId: 'worker-missing',
    spawnFn: mockSpawn,
    fsModule: {
      existsSync: () => true,
      mkdirSync: () => {},
      createWriteStream: () => ({ write: () => {}, on: () => {}, end: () => {} }),
    },
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.pid, null);
  assert.equal(evidence.processAlive, false);
  assert.match(evidence.error, /ENOENT/);
});

test('dispatchAntigravityWorker and dispatchOpenCodeWorker set canonical worker types', async () => {
  let lastOptions = null;
  const mockSpawn = (cmd, args, opts) => {
    lastOptions = { cmd, args, opts };
    const child = new EventEmitter();
    child.pid = 1111;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => {}, end: () => {} };
    return child;
  };

  const fsMock = {
    existsSync: () => true,
    mkdirSync: () => {},
    createWriteStream: () => ({ write: () => {}, on: () => {}, end: () => {} }),
  };

  const agyEv = await dispatchAntigravityWorker({
    command: 'agy',
    spawnFn: mockSpawn,
    fsModule: fsMock,
  });
  assert.equal(agyEv.workerType, 'antigravity/agy');

  const openCodeEv = await dispatchOpenCodeWorker({
    command: 'opencode',
    spawnFn: mockSpawn,
    fsModule: fsMock,
  });
  assert.equal(openCodeEv.workerType, 'opencode');
});

test('readLogTail safely extracts the tail of worker durable logs', () => {
  const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
  const fsMock = {
    existsSync: () => true,
    statSync: () => ({ size: Buffer.byteLength(content) }),
    openSync: () => 3,
    readSync: (fd, buffer, offset, length, position) => {
      const slice = Buffer.from(content).subarray(position, position + length);
      slice.copy(buffer, offset);
      return slice.length;
    },
    closeSync: () => {},
  };

  const tail = readLogTail('/fake/path.log', { maxBytes: 14, fsModule: fsMock });
  assert.equal(tail, 'Line 4\nLine 5\n');
});

// ============================================================================
// 3. GENERIC CHATGPT PROBE & SEND SCRIPT CONSTRUCTORS & PARSING
// ============================================================================

test('buildChatGPTProbeScript generates script with DOM progress observables and login/rate-limit checks', () => {
  const script = buildChatGPTProbeScript({ runId: 'run-99', chatId: 'chat-abc', openIfMissing: false });

  assert.match(script, /persist:run-99/);
  assert.match(script, /chat-abc/);
  assert.match(script, /stop-button/);
  assert.match(script, /prompt-textarea/);
  assert.match(script, /data-message-author-role="assistant"/);
  assert.match(script, /loginRequired/);
  assert.match(script, /rateLimitExceeded/);
  assert.match(script, /toolNodes/);
  assert.match(script, /PERSISTD_RESULT/);
});

test('buildGenericChatGPTSendScript generates script with task marker and assistant start observables', () => {
  const script = buildGenericChatGPTSendScript({
    runId: 'run-88',
    chatId: 'chat-xyz',
    message: 'Execute step 1',
    taskMarker: 'SWARM_STEP_01',
    waitForAssistantStart: true,
  });

  assert.match(script, /persist:run-88/);
  assert.match(script, /chat-xyz/);
  assert.match(script, /SWARM_TASK_MARKER:SWARM_STEP_01/);
  assert.match(script, /stop-button/);
  assert.match(script, /PERSISTD_RESULT/);
});

test('ChatGPT probe parsing: tab exists with stop button and tool progress classifies as WORKING', () => {
  const probeSnapshot = {
    workerId: 'chatgpt-worker-1',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    processAlive: true,
    windowOpen: true,
    tabFound: true,
    isLoggedIn: true,
    loginRequired: false,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 3,
    outputLength: 450,
    promptReady: false,
    observedAt: new Date().toISOString(),
  };

  const previousSnapshot = {
    workerId: 'chatgpt-worker-1',
    workerType: 'chatgpt-browser',
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 1,
    outputLength: 200,
    observedAt: new Date(Date.now() - 5000).toISOString(),
  };

  const classification = classifyChatGPTBrowser(probeSnapshot, previousSnapshot);
  assert.equal(classification.status, WorkerStatus.WORKING);
  assert.equal(classification.reason, 'CHATGPT_ACTIVE_GENERATION_WITH_PROGRESS');
  assert.equal(classification.evidence.toolDelta, 2);
});

test('ChatGPT probe parsing: tab exists with no stop button and prompt ready classifies as IDLE, never WORKING', () => {
  // CRITICAL REQUIREMENT: Never claim WORKING just because a tab exists!
  const probeSnapshot = {
    workerId: 'chatgpt-worker-2',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    processAlive: true,
    windowOpen: true,
    tabFound: true,
    isLoggedIn: true,
    loginRequired: false,
    stopButtonVisible: false,
    isGenerating: false,
    promptReady: true,
    promptInput: '',
    toolCount: 4,
    outputLength: 1200,
    observedAt: new Date().toISOString(),
  };

  const classification = classifyChatGPTBrowser(probeSnapshot);
  assert.equal(classification.status, WorkerStatus.IDLE);
  assert.notEqual(classification.status, WorkerStatus.WORKING);
  assert.equal(classification.reason, 'CHATGPT_READY_IDLE');
  assert.equal(classification.evidence.promptReady, true);
});

test('ChatGPT probe parsing: stop button visible but stalled beyond timeout classifies as STALE', () => {
  const now = Date.now();
  const probeSnapshot = {
    workerId: 'chatgpt-worker-3',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    processAlive: true,
    windowOpen: true,
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 5,
    outputLength: 800,
    observedAt: new Date(now).toISOString(),
    lastProgressAt: new Date(now - 45000).toISOString(), // 45s ago (> 30s timeout)
  };

  const previousSnapshot = {
    workerId: 'chatgpt-worker-3',
    workerType: 'chatgpt-browser',
    stopButtonVisible: true,
    isGenerating: true,
    toolCount: 5,
    outputLength: 800,
    observedAt: new Date(now - 45000).toISOString(),
    lastProgressAt: new Date(now - 45000).toISOString(),
  };

  const classification = classifyChatGPTBrowser(probeSnapshot, previousSnapshot, { now });
  assert.equal(classification.status, WorkerStatus.STALE);
  assert.equal(classification.reason, 'CHATGPT_STOP_BUTTON_TIMEOUT_NO_TOOL_PROGRESS');
});

test('ChatGPT probe parsing: login wall or challenge classifies as BLOCKED', () => {
  const probeSnapshot = {
    workerId: 'chatgpt-worker-4',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    processAlive: true,
    windowOpen: true,
    loginRequired: true,
    isLoggedIn: false,
    cloudflareChallenge: true,
  };

  const classification = classifyChatGPTBrowser(probeSnapshot);
  assert.equal(classification.status, WorkerStatus.BLOCKED);
  assert.equal(classification.reason, 'CHATGPT_AUTHENTICATION_OR_CHALLENGE_BLOCKED');
});

test('ChatGPT probe parsing: rate limit exceeded classifies as ERROR', () => {
  const probeSnapshot = {
    workerId: 'chatgpt-worker-5',
    workerType: 'chatgpt-browser',
    browserRunning: true,
    processAlive: true,
    windowOpen: true,
    rateLimitExceeded: true,
  };

  const classification = classifyChatGPTBrowser(probeSnapshot);
  assert.equal(classification.status, WorkerStatus.ERROR);
  assert.equal(classification.reason, 'CHATGPT_ERROR_STATE');
});

test('egoBrowser transport exposes probeChatGPTWorker and sendChatGPTWorkerMessage', async () => {
  const executedScripts = [];
  const transport = createEgoBrowserTransport({
    runner: async (script) => {
      executedScripts.push(script);
      return { ok: true, status: 'PROBE_COMPLETE', promptReady: true, isGenerating: false };
    },
  });

  const probeRes = await transport.probeChatGPTWorker({
    state: { RUN_ID: 'swarm-run' },
    chatId: 'chat-target-1',
  });
  assert.equal(probeRes.ok, true);
  assert.match(executedScripts[0], /persist:swarm-run/);
  assert.match(executedScripts[0], /chat-target-1/);

  const sendRes = await transport.sendChatGPTWorkerMessage({
    state: { RUN_ID: 'swarm-run' },
    chatId: 'chat-target-1',
    message: 'Hello worker',
    taskMarker: 'TASK_999',
  });
  assert.equal(sendRes.ok, true);
  assert.match(executedScripts[1], /SWARM_TASK_MARKER:TASK_999/);
});

// ============================================================================
// 4. DAEMON ARGUMENT PARSING & REGISTRY NORMALIZATION
// ============================================================================

test('parseDaemonArgs parses full flags, shorthand flags, and defaults', () => {
  const defaults = parseDaemonArgs([]);
  assert.equal(defaults.registryPath, 'swarm-registry.json');
  assert.equal(defaults.statePath, 'swarm-state.json');
  assert.equal(defaults.intervalMs, 5000);
  assert.equal(defaults.once, false);

  const parsed = parseDaemonArgs([
    '-r', 'custom-reg.json',
    '-s', 'custom-state.json',
    '-i', '2500',
    '--once',
    '--verbose',
  ]);
  assert.equal(parsed.registryPath, 'custom-reg.json');
  assert.equal(parsed.statePath, 'custom-state.json');
  assert.equal(parsed.intervalMs, 2500);
  assert.equal(parsed.once, true);
  assert.equal(parsed.verbose, true);

  const eqSyntax = parseDaemonArgs([
    '--registry=reg-eq.json',
    '--state=state-eq.json',
    '--interval=1000',
  ]);
  assert.equal(eqSyntax.registryPath, 'reg-eq.json');
  assert.equal(eqSyntax.statePath, 'state-eq.json');
  assert.equal(eqSyntax.intervalMs, 1000);
});

test('parseDaemonArgs rejects invalid interval values', () => {
  assert.throws(
    () => parseDaemonArgs(['--interval', '-10']),
    /CLI_ARG_ERROR/,
    'Should reject negative interval'
  );

  assert.throws(
    () => parseDaemonArgs(['--interval=notanumber']),
    /CLI_ARG_ERROR/,
    'Should reject non-numeric interval'
  );
});

test('loadRegistry normalizes array, object, or JSON file inputs', () => {
  const fromArray = loadRegistry([
    { id: 'w1', type: 'antigravity' },
    { id: 'w2', type: 'chatgpt' },
  ]);
  assert.equal(fromArray.workers.length, 2);
  assert.equal(fromArray.workers[0].type, 'antigravity/agy');
  assert.equal(fromArray.workers[1].type, 'chatgpt-browser');

  const fromObject = loadRegistry({
    version: '2.0.0',
    workers: {
      'worker-a': { type: 'opencode' },
      'worker-b': { type: 'openclaw' },
    },
  });
  assert.equal(fromObject.version, '2.0.0');
  assert.equal(fromObject.workers.length, 2);
  assert.equal(fromObject.workers[0].id, 'worker-a');
  assert.equal(fromObject.workers[0].type, 'opencode');
  assert.equal(fromObject.workers[1].type, 'openclaw/myclawn');

  const fsMock = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({
      version: '1.2.3',
      workers: [{ id: 'file-w', type: 'device' }],
    }),
  };
  const fromFile = loadRegistry('fake-registry.json', { fsModule: fsMock });
  assert.equal(fromFile.version, '1.2.3');
  assert.equal(fromFile.workers[0].type, 'remote-device');
});

// ============================================================================
// 5. DAEMON ONCE-MODE & DEPENDENCY INJECTION
// ============================================================================

test('createSwarmDaemon once-mode executes single tick with probe adapters and supervisor tick', async () => {
  const writtenFiles = {};
  const fsMock = {
    existsSync: () => true,
    mkdirSync: () => {},
    writeFileSync: (file, content) => { writtenFiles[file] = content; },
    renameSync: (from, to) => {
      writtenFiles[to] = writtenFiles[from];
      delete writtenFiles[from];
    },
  };

  let supervisorTickCalled = false;
  let supervisorTickArgs = null;

  const mockSupervisorTick = async ({ registry, snapshots, classifications, tickCount }) => {
    supervisorTickCalled = true;
    supervisorTickArgs = { registry, snapshots, classifications, tickCount };
    return {
      version: '1.0.0',
      status: 'SUPERVISED',
      tickCount,
      managedWorkers: Object.keys(classifications).length,
      classifications,
    };
  };

  const probeAdapters = {
    'antigravity/agy': async (worker) => ({
      workerId: worker.id,
      workerType: 'antigravity/agy',
      processAlive: true,
      taskStatus: 'DONE',
      completed: true,
      observedAt: new Date().toISOString(),
    }),
    'chatgpt-browser': async (worker) => ({
      workerId: worker.id,
      workerType: 'chatgpt-browser',
      browserRunning: true,
      processAlive: true,
      windowOpen: true,
      stopButtonVisible: false,
      isGenerating: false,
      promptReady: true,
      observedAt: new Date().toISOString(),
    }),
  };

  const registry = {
    version: '1.0.0',
    workers: [
      { id: 'agy-1', type: 'antigravity' },
      { id: 'cg-1', type: 'chatgpt' },
    ],
  };

  const daemon = createSwarmDaemon({
    registry,
    statePath: '/tmp/state.json',
    once: true,
    probeAdapters,
    supervisorTick: mockSupervisorTick,
    fsModule: fsMock,
  });

  const finalState = await daemon.start();

  // 1. Verify once-mode finished and supervisor tick was invoked
  assert.equal(daemon.isRunning(), false, 'Daemon should not be running after once-mode');
  assert.equal(supervisorTickCalled, true);
  assert.equal(supervisorTickArgs.tickCount, 1);
  assert.equal(finalState.status, 'SUPERVISED');
  assert.equal(finalState.managedWorkers, 2);

  // 2. Verify worker classifications generated by probe adapters
  assert.equal(finalState.classifications['agy-1'].status, WorkerStatus.DONE);
  assert.equal(finalState.classifications['cg-1'].status, WorkerStatus.IDLE);

  // 3. Verify atomic state file was written
  assert.ok(writtenFiles['/tmp/state.json'], 'State file must be written atomically');
  const savedState = JSON.parse(writtenFiles['/tmp/state.json']);
  assert.equal(savedState.status, 'SUPERVISED');
  assert.equal(savedState.managedWorkers, 2);
});

test('createSwarmDaemon default tick generates valid swarm state when supervisor is decoupled', async () => {
  const registry = {
    version: '1.0.0',
    workers: [
      { id: 'generic-1', type: 'generic', pid: 9999, processAlive: true },
    ],
  };

  const daemon = createSwarmDaemon({
    registry,
    once: true,
  });

  const state = await daemon.tick();
  assert.equal(state.version, '1.0.0');
  assert.equal(state.tickCount, 1);
  assert.ok(state.workers['generic-1']);
  assert.ok(state.snapshots['generic-1']);
});

test('createSwarmDaemon interval loop advances multiple ticks and stops cleanly', async () => {
  let simulatedNow = 1000000;
  let scheduledCallbacks = [];

  const mockClock = {
    now: () => simulatedNow,
    setTimeout: (fn, ms) => {
      const entry = { fn, due: simulatedNow + ms };
      scheduledCallbacks.push(entry);
      return entry;
    },
    clearTimeout: (handle) => {
      scheduledCallbacks = scheduledCallbacks.filter((c) => c !== handle);
    },
  };

  let tickExecutions = 0;
  const mockSupervisor = async ({ tickCount }) => {
    tickExecutions++;
    return { tickCount };
  };

  const daemon = createSwarmDaemon({
    registry: { version: '1.0.0', workers: [] },
    intervalMs: 1000,
    once: false,
    supervisorTick: mockSupervisor,
    clock: mockClock,
  });

  // Start loop (executes tick 1)
  await daemon.start();
  assert.equal(tickExecutions, 1);
  assert.equal(daemon.isRunning(), true);

  // Advance clock and trigger tick 2
  simulatedNow += 1000;
  const nextCallback = scheduledCallbacks.shift();
  assert.ok(nextCallback);
  await nextCallback.fn();
  assert.equal(tickExecutions, 2);

  // Stop daemon
  await daemon.stop();
  assert.equal(daemon.isRunning(), false);
  assert.equal(scheduledCallbacks.length, 0, 'No more timers after stop');
});

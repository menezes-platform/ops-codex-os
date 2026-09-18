'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { classifyWorkerSnapshot, normalizeWorkerType } = require('./worker-probes');
const { isProcessAlive } = require('./dispatchers');

/**
 * Synchronous sleep helper using Atomics when available.
 *
 * @param {number} ms
 */
function sleepSync(ms) {
  if (typeof Atomics !== 'undefined' && typeof SharedArrayBuffer !== 'undefined') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } else {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

/**
 * Atomically replaces a file with retry for transient Windows locks.
 *
 * @param {string} tmp
 * @param {string} filePath
 * @param {object} [options]
 */
function replaceFileWithRetry(tmp, filePath, {
  rename = fs.renameSync,
  sleep = sleepSync,
  retries = 12,
  baseDelayMs = 25,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmp, filePath);
      return;
    } catch (error) {
      const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
      if (!transient || attempt >= retries) throw error;
      sleep(Math.min(baseDelayMs * (attempt + 1), 250));
    }
  }
}

/**
 * Atomically persists swarm state to a JSON file.
 *
 * @param {string} statePath
 * @param {object} state
 * @param {object} [options]
 */
function persistStateAtomic(statePath, state, options = {}) {
  if (!statePath) return;

  const fsModule = options.fsModule || fs;
  const dir = path.dirname(path.resolve(statePath));
  if (!fsModule.existsSync(dir)) {
    fsModule.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(state, null, 2) + '\n';
  const tmp = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;

  fsModule.writeFileSync(tmp, content, 'utf8');
  try {
    replaceFileWithRetry(tmp, statePath, {
      rename: fsModule.renameSync ? fsModule.renameSync.bind(fsModule) : fs.renameSync,
      sleep: options.sleep || sleepSync,
      retries: options.retries || 12,
      baseDelayMs: options.baseDelayMs || 25,
    });
  } catch (error) {
    // If persistent Windows lock, attempt verified in-place overwrite
    const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
    if (transient && fsModule.writeFileSync) {
      fsModule.writeFileSync(statePath, content, 'utf8');
      try { fsModule.unlinkSync(tmp); } catch {}
      return;
    }
    try { fsModule.unlinkSync(tmp); } catch {}
    throw error;
  }
}

/**
 * Parses CLI arguments for the swarm daemon.
 *
 * @param {Array<string>} argv
 * @returns {object}
 */
function parseDaemonArgs(argv = []) {
  const parsed = {
    registryPath: 'swarm-registry.json',
    statePath: 'swarm-state.json',
    intervalMs: 5000,
    once: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--registry' || arg === '-r') {
      const val = argv[++i];
      if (!val) throw new Error('CLI_ARG_ERROR: Missing value for --registry');
      parsed.registryPath = val;
    } else if (arg.startsWith('--registry=')) {
      parsed.registryPath = arg.slice('--registry='.length);
    } else if (arg === '--state' || arg === '-s') {
      const val = argv[++i];
      if (!val) throw new Error('CLI_ARG_ERROR: Missing value for --state');
      parsed.statePath = val;
    } else if (arg.startsWith('--state=')) {
      parsed.statePath = arg.slice('--state='.length);
    } else if (arg === '--interval' || arg === '-i') {
      const val = argv[++i];
      const num = Number(val);
      if (!Number.isFinite(num) || num <= 0) {
        throw new Error(`CLI_ARG_ERROR: Invalid interval value: ${val}`);
      }
      parsed.intervalMs = Math.round(num);
    } else if (arg.startsWith('--interval=')) {
      const val = arg.slice('--interval='.length);
      const num = Number(val);
      if (!Number.isFinite(num) || num <= 0) {
        throw new Error(`CLI_ARG_ERROR: Invalid interval value: ${val}`);
      }
      parsed.intervalMs = Math.round(num);
    } else if (arg === '--once') {
      parsed.once = true;
    } else if (arg === '--verbose' || arg === '-v') {
      parsed.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    }
  }

  return parsed;
}

/**
 * Loads and normalizes a registry from JSON file or object.
 *
 * @param {string|object} registryInput
 * @param {object} [options]
 * @returns {{ version: string, workers: Array<object> }}
 */
function loadRegistry(registryInput, options = {}) {
  const fsModule = options.fsModule || fs;
  let raw = registryInput;

  if (typeof registryInput === 'string') {
    if (!fsModule.existsSync(registryInput)) {
      throw new Error(`REGISTRY_NOT_FOUND: Registry file does not exist: ${registryInput}`);
    }
    const content = fsModule.readFileSync(registryInput, 'utf8');
    try {
      raw = JSON.parse(content);
    } catch (err) {
      throw new Error(`REGISTRY_PARSE_ERROR: Failed to parse registry JSON: ${err.message}`);
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { version: '1.0.0', workers: [] };
  }

  let workersList = [];
  if (Array.isArray(raw)) {
    workersList = raw;
  } else if (Array.isArray(raw.workers)) {
    workersList = raw.workers;
  } else if (raw.workers && typeof raw.workers === 'object') {
    workersList = Object.entries(raw.workers).map(([id, val]) => ({
      id,
      ...(typeof val === 'object' ? val : { type: val }),
    }));
  }

  const normalizedWorkers = workersList.map((w, index) => {
    const id = String(w.id || w.workerId || `worker-${index + 1}`);
    const type = normalizeWorkerType(w.type || w.workerType || 'generic');
    return {
      ...w,
      id,
      workerId: id,
      type,
      workerType: type,
    };
  });

  const base = Array.isArray(raw) ? {} : { ...raw };
  return {
    ...base,
    version: raw.version || '1.0.0',
    workers: normalizedWorkers,
    tasks: raw.tasks && typeof raw.tasks === 'object' ? raw.tasks : {},
  };
}

/**
 * Collects snapshots for workers in the registry using configured probe adapters.
 *
 * @param {object} options
 * @param {object} options.registry - Normalized registry
 * @param {object} [options.probeAdapters={}] - Map of probe adapter functions
 * @param {object} [options.previousSnapshots={}] - Previous snapshots by workerId
 * @param {object} [options.context={}] - Additional context passed to adapters
 * @returns {Promise<{ snapshots: Record<string, object>, classifications: Record<string, object> }>}
 */
async function collectWorkerSnapshots(options = {}) {
  const {
    registry,
    probeAdapters = {},
    previousSnapshots = {},
    context = {},
  } = options;

  const rawSnapshots = {};
  const classifications = {};

  for (const worker of registry.workers) {
    const workerType = normalizeWorkerType(worker.type);
    const adapter = probeAdapters[workerType] ||
      probeAdapters[worker.type] ||
      probeAdapters.default ||
      probeAdapters.generic;

    let snapshot;
    if (typeof adapter === 'function') {
      try {
        snapshot = await adapter(worker, {
          ...context,
          previousSnapshot: previousSnapshots[worker.id] || null,
        });
      } catch (adapterError) {
        snapshot = {
          workerId: worker.id,
          workerType,
          error: adapterError.message,
          observedAt: new Date().toISOString(),
          processAlive: false,
        };
      }
    } else {
      // Built-in default fallback adapter
      const processAlive = typeof worker.pid === 'number'
        ? isProcessAlive(worker.pid)
        : (worker.processAlive !== undefined ? worker.processAlive : true);

      snapshot = {
        workerId: worker.id,
        workerType,
        pid: worker.pid || null,
        processAlive,
        observedAt: new Date().toISOString(),
        ...worker,
      };
    }

    // Ensure worker identity properties
    snapshot.workerId = snapshot.workerId || worker.id;
    snapshot.workerType = snapshot.workerType || workerType;
    snapshot.observedAt = snapshot.observedAt || new Date().toISOString();

    rawSnapshots[worker.id] = snapshot;

    // Run classification using worker-probes
    const prev = previousSnapshots[worker.id] || null;
    classifications[worker.id] = classifyWorkerSnapshot(snapshot, prev);
  }

  return {
    snapshots: rawSnapshots,
    classifications,
  };
}

/**
 * Creates a decoupled Swarm Daemon instance.
 *
 * @param {object} options
 * @param {string|object} [options.registry] - Registry path or object
 * @param {string} [options.registryPath] - Registry path
 * @param {string} [options.statePath] - Output state path
 * @param {number} [options.intervalMs=5000] - Tick interval
 * @param {boolean} [options.once=false] - Run once mode
 * @param {object} [options.probeAdapters={}] - Configured probe adapters
 * @param {function} [options.supervisorTick] - Supplied supervisor tick function
 * @param {object} [options.fsModule=fs] - fs dependency injection
 * @param {object} [options.clock] - Clock dependency injection
 * @param {function} [options.logger] - Logger function
 * @returns {object} Swarm daemon instance
 */
function createSwarmDaemon(options = {}) {
  const {
    registry,
    registryPath,
    statePath,
    intervalMs = 5000,
    once = false,
    probeAdapters = {},
    supervisorTick = null,
    dispatchers = {},
    fsModule = fs,
    clock = {
      now: Date.now.bind(Date),
      setTimeout: global.setTimeout.bind(global),
      clearTimeout: global.clearTimeout.bind(global),
    },
    logger = null,
  } = options;

  const effectiveRegistryInput = registry || registryPath || 'swarm-registry.json';
  const effectiveStatePath = statePath || null;

  let timer = null;
  let running = false;
  let inFlightTick = null;
  let tickCount = 0;
  let currentState = null;
  let previousState = null;

  const log = (...args) => {
    if (typeof logger === 'function') logger(...args);
  };

  /**
   * Performs a single supervisor/snapshot tick.
   *
   * @returns {Promise<object>} Next swarm state
   */
  async function tick() {
    tickCount++;
    const now = clock.now();

    // 1. Read registry JSON
    const reg = loadRegistry(effectiveRegistryInput, { fsModule });

    // 2. Collect snapshots through configured probe adapters & classify
    const previousSnapshots = currentState?.snapshots || {};
    const { snapshots, classifications } = await collectWorkerSnapshots({
      registry: reg,
      probeAdapters,
      previousSnapshots,
      context: { tickCount, state: currentState },
    });

    // 3. Run supplied supervisor tick function (decoupled)
    let nextState;
    if (typeof supervisorTick === 'function') {
      nextState = await supervisorTick({
        registry: reg,
        snapshots,
        classifications,
        state: currentState,
        previousState,
        tickCount,
        timestamp: now,
        dispatchers,
        clock: () => new Date(now),
      });
    }

    if (!nextState || typeof nextState !== 'object') {
      // Default state format if supervisor tick not provided or returns null
      nextState = {
        version: reg.version || '1.0.0',
        tickCount,
        updatedAt: new Date(now).toISOString(),
        workers: classifications,
        snapshots,
      };
    } else {
      nextState = {
        ...nextState,
        tickCount,
        snapshots: nextState.snapshots || snapshots,
        classifications: nextState.classifications || classifications,
      };
    }

    // 4. Persist mutable supervisor registry so leases/assignments survive the next tick.
    if (typeof effectiveRegistryInput === 'string' && nextState.registry) {
      persistStateAtomic(effectiveRegistryInput, nextState.registry, { fsModule });
    }

    // 5. Atomically persist observability state.
    if (effectiveStatePath) {
      persistStateAtomic(effectiveStatePath, nextState, { fsModule });
    }

    previousState = currentState;
    currentState = nextState;

    log(`[SWARM_DAEMON:TICK] Tick #${tickCount} completed with ${reg.workers.length} workers`);
    return currentState;
  }

  /**
   * Starts the daemon. If once is true, executes a single tick and resolves.
   *
   * @returns {Promise<object>} Resolves with state
   */
  async function start() {
    if (running) return currentState;
    running = true;

    if (once) {
      try {
        const state = await tick();
        running = false;
        return state;
      } catch (err) {
        running = false;
        throw err;
      }
    }

    // Loop mode
    const runLoop = async () => {
      if (!running) return;
      try {
        inFlightTick = tick();
        await inFlightTick;
      } catch (err) {
        log(`[SWARM_DAEMON:ERROR] Error in tick #${tickCount}: ${err.message}`);
      } finally {
        inFlightTick = null;
        if (running) {
          timer = clock.setTimeout(runLoop, intervalMs);
        }
      }
    };

    await runLoop();
    return currentState;
  }

  /**
   * Stops the daemon loop.
   *
   * @returns {Promise<object>} Resolves when in-flight tick is complete
   */
  async function stop() {
    running = false;
    if (timer) {
      clock.clearTimeout(timer);
      timer = null;
    }
    if (inFlightTick) {
      try {
        await inFlightTick;
      } catch {}
    }
    return currentState;
  }

  return {
    tick,
    start,
    stop,
    getState: () => currentState,
    isRunning: () => running,
    getTickCount: () => tickCount,
  };
}

// CLI execution handler
if (require.main === module) {
  const args = parseDaemonArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
Swarm Daemon CLI

Usage:
  node swarm-daemon.js [options]

Options:
  -r, --registry <path>   Registry JSON file path (default: swarm-registry.json)
  -s, --state <path>      Output state JSON file path (default: swarm-state.json)
  -i, --interval <ms>     Loop interval in milliseconds (default: 5000)
      --once              Run a single tick and exit
  -v, --verbose           Verbose output
  -h, --help              Show this help message
`);
    process.exit(0);
  }

  const daemon = createSwarmDaemon({
    ...args,
    logger: args.verbose ? console.log : null,
  });

  daemon.start().then((state) => {
    if (args.once) {
      console.log(JSON.stringify(state, null, 2));
      process.exit(0);
    }
  }).catch((err) => {
    console.error(`Swarm Daemon Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  sleepSync,
  replaceFileWithRetry,
  persistStateAtomic,
  parseDaemonArgs,
  loadRegistry,
  collectWorkerSnapshots,
  createSwarmDaemon,
};

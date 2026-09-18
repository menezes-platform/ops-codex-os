'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Checks if a process is alive given its PID.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means process exists but we cannot signal it; ESRCH means not found
    return error.code === 'EPERM';
  }
}

/**
 * Validates command and arguments to prevent shell injection.
 * Enforces shell: false and disallows shell metacharacters in binary command.
 *
 * @param {string} command
 * @param {Array<string>} [args=[]]
 * @returns {{ sanitizedCommand: string, sanitizedArgs: Array<string> }}
 */
function validateDispatch(command, args = []) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('DISPATCH_INVALID_COMMAND: Command must be a non-empty string');
  }

  // Reject null bytes
  if (command.includes('\0')) {
    throw new Error('SHELL_INJECTION_DETECTED: Command contains forbidden null byte');
  }

  // Shell chaining / redirection operators are disallowed in executable command path
  if (/[\r\n;&|><`$]/.test(command)) {
    throw new Error(`SHELL_INJECTION_DETECTED: Command contains shell metacharacters: ${command}`);
  }

  if (!Array.isArray(args)) {
    throw new Error('DISPATCH_INVALID_ARGS: Args must be an array');
  }

  const sanitizedArgs = args.map((arg, idx) => {
    if (arg === null || arg === undefined) {
      throw new Error(`DISPATCH_INVALID_ARG: Arg at index ${idx} is null or undefined`);
    }
    const str = String(arg);
    if (str.includes('\0')) {
      throw new Error(`SHELL_INJECTION_DETECTED: Arg at index ${idx} contains forbidden null byte`);
    }
    return str;
  });

  return {
    sanitizedCommand: command.trim(),
    sanitizedArgs,
  };
}

/**
 * Safely reads the tail of a durable log file.
 *
 * @param {string} logPath
 * @param {object} [options]
 * @param {number} [options.maxBytes=16384]
 * @param {object} [options.fsModule=fs]
 * @returns {string}
 */
function readLogTail(logPath, options = {}) {
  const fsModule = options.fsModule || fs;
  const maxBytes = options.maxBytes || 16384;

  if (!logPath || !fsModule.existsSync(logPath)) {
    return '';
  }

  try {
    const stat = fsModule.statSync(logPath);
    if (stat.size === 0) return '';

    const readSize = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(readSize);
    const fd = fsModule.openSync(logPath, 'r');
    try {
      fsModule.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    } finally {
      fsModule.closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Dispatches a command worker without shell injection.
 * Writes stdout/stderr to a durable log file, injects task markers/prompts safely,
 * and returns child start evidence with PID.
 *
 * @param {object} options
 * @param {string} options.command - Executable binary or path
 * @param {Array<string>} [options.args=[]] - CLI arguments
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.workerId] - Worker identifier
 * @param {string} [options.workerType='generic'] - Worker type identifier
 * @param {string} [options.logPath] - Destination durable log file
 * @param {string} [options.taskMarker] - Task marker string to inject
 * @param {string} [options.taskMarkerArg] - Argument flag if passed via CLI (e.g. '--task-marker')
 * @param {string} [options.prompt] - Prompt string to inject
 * @param {string} [options.promptArg] - Argument flag if prompt passed via CLI (e.g. '--prompt')
 * @param {boolean} [options.injectPromptViaStdin=true] - Whether to write prompt to child stdin
 * @param {object} [options.env] - Additional environment variables
 * @param {boolean} [options.windowsHide=true] - Hide Windows console window
 * @param {function} [options.spawnFn=spawn] - Spawn function dependency injection
 * @param {object} [options.fsModule=fs] - fs dependency injection
 * @returns {Promise<object>} Start evidence
 */
async function dispatchCommand(options = {}) {
  const {
    command,
    args = [],
    cwd = process.cwd(),
    workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workerType = 'generic',
    logPath,
    taskMarker = null,
    taskMarkerArg = null,
    prompt = null,
    promptArg = null,
    injectPromptViaStdin = true,
    env = {},
    windowsHide = true,
    spawnFn = spawn,
    fsModule = fs,
  } = options;

  const { sanitizedCommand, sanitizedArgs } = validateDispatch(command, args);

  // Build final arguments list safely without shell expansion
  const finalArgs = [...sanitizedArgs];
  if (taskMarker && taskMarkerArg) {
    finalArgs.push(taskMarkerArg, String(taskMarker));
  }
  if (prompt && promptArg) {
    finalArgs.push(promptArg, String(prompt));
  }

  // Ensure working directory exists if specified
  if (cwd && !fsModule.existsSync(cwd)) {
    fsModule.mkdirSync(cwd, { recursive: true });
  }

  // Determine durable log destination
  const effectiveLogPath = logPath || path.join(cwd, '.persistd', 'logs', `${workerId}.log`);
  const logDir = path.dirname(effectiveLogPath);
  if (!fsModule.existsSync(logDir)) {
    fsModule.mkdirSync(logDir, { recursive: true });
  }

  // Open durable log stream (appending)
  const logStream = fsModule.createWriteStream
    ? fsModule.createWriteStream(effectiveLogPath, { flags: 'a', encoding: 'utf8' })
    : null;

  const startedAt = new Date().toISOString();

  // Prepare environment with task markers
  const childEnv = {
    ...process.env,
    ...env,
    SWARM_WORKER_ID: workerId,
    SWARM_WORKER_TYPE: workerType,
  };
  if (taskMarker) {
    childEnv.SWARM_TASK_MARKER = String(taskMarker);
  }

  // Write durable start header
  const startHeader = [
    `\n=== [SWARM_DISPATCH:START] ===`,
    `TIMESTAMP: ${startedAt}`,
    `WORKER_ID: ${workerId}`,
    `WORKER_TYPE: ${workerType}`,
    `COMMAND: ${sanitizedCommand}`,
    `ARGS: ${JSON.stringify(finalArgs)}`,
    `CWD: ${cwd}`,
    `TASK_MARKER: ${taskMarker || 'NONE'}`,
    `==============================\n`,
  ].join('\n');

  if (logStream) {
    logStream.write(startHeader);
    logStream.on('error', () => {}); // Safe no-op on log stream errors
  } else if (fsModule.appendFileSync) {
    try {
      fsModule.appendFileSync(effectiveLogPath, startHeader, 'utf8');
    } catch {}
  }

  const pipeStdin = Boolean(prompt && injectPromptViaStdin);

  // Spawn with shell strictly disabled to guarantee no shell injection
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(sanitizedCommand, finalArgs, {
        cwd,
        env: childEnv,
        shell: false, // HARD ENFORCEMENT: Never invoke shell
        windowsHide,
        stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (spawnError) {
      if (logStream) {
        logStream.write(`[SWARM_DISPATCH:SPAWN_ERROR] ${spawnError.message}\n`);
        logStream.end();
      }
      return resolve({
        ok: false,
        workerId,
        workerType,
        pid: null,
        command: sanitizedCommand,
        args: finalArgs,
        cwd,
        logPath: effectiveLogPath,
        taskMarker,
        startedAt,
        processAlive: false,
        error: spawnError.message,
      });
    }

    if (!child) {
      return resolve({
        ok: false,
        workerId,
        workerType,
        pid: null,
        command: sanitizedCommand,
        args: finalArgs,
        cwd,
        logPath: effectiveLogPath,
        taskMarker,
        startedAt,
        processAlive: false,
        error: 'SPAWN_RETURNED_NULL',
      });
    }

    let settled = false;

    // Handle early spawn error
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      if (logStream) {
        logStream.write(`[SWARM_DISPATCH:ERROR] ${err.message}\n`);
        logStream.end();
      }
      resolve({
        ok: false,
        workerId,
        workerType,
        pid: child.pid || null,
        command: sanitizedCommand,
        args: finalArgs,
        cwd,
        logPath: effectiveLogPath,
        taskMarker,
        startedAt,
        processAlive: false,
        error: err.message,
      });
    });

    // Pipe stdout & stderr to durable log
    if (child.stdout && logStream) {
      child.stdout.on('data', (chunk) => {
        try { logStream.write(chunk); } catch {}
      });
    }
    if (child.stderr && logStream) {
      child.stderr.on('data', (chunk) => {
        try { logStream.write(chunk); } catch {}
      });
    }

    // Handle process termination
    child.once('close', (code, signal) => {
      const exitFooter = [
        `\n=== [SWARM_DISPATCH:EXIT] ===`,
        `TIMESTAMP: ${new Date().toISOString()}`,
        `WORKER_ID: ${workerId}`,
        `PID: ${child.pid || 'N/A'}`,
        `EXIT_CODE: ${code}`,
        `SIGNAL: ${signal || 'NONE'}`,
        `=============================\n`,
      ].join('\n');

      if (logStream) {
        try {
          logStream.write(exitFooter);
          logStream.end();
        } catch {}
      }
    });

    // If prompt is provided and stdin is piped, inject prompt safely
    let promptInjected = false;
    if (pipeStdin && child.stdin) {
      try {
        child.stdin.write(prompt + '\n');
        child.stdin.end();
        promptInjected = true;
      } catch {
        promptInjected = false;
      }
    }

    // Process started successfully
    const handleSuccess = () => {
      if (settled) return;
      settled = true;
      resolve({
        ok: true,
        workerId,
        workerType,
        pid: child.pid,
        command: sanitizedCommand,
        args: finalArgs,
        cwd,
        logPath: effectiveLogPath,
        taskMarker,
        promptInjected,
        startedAt,
        processAlive: true,
        child,
      });
    };

    if (child.pid) {
      // Small delay or next tick to catch immediate synchronous binary-not-found errors
      if (typeof child.once === 'function') {
        child.once('spawn', handleSuccess);
        // Fallback if spawn event already fired or in mock environments
        setImmediate(() => {
          if (!settled && child.pid) {
            handleSuccess();
          }
        });
      } else {
        handleSuccess();
      }
    }
  });
}

/**
 * Specialized dispatcher for Antigravity / Agy workers.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function dispatchAntigravityWorker(options = {}) {
  const binary = options.command || (process.platform === 'win32' ? 'agy.cmd' : 'agy');
  return dispatchCommand({
    ...options,
    command: binary,
    workerType: 'antigravity/agy',
  });
}

/**
 * Specialized dispatcher for OpenCode workers.
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
async function dispatchOpenCodeWorker(options = {}) {
  const binary = options.command || (process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  return dispatchCommand({
    ...options,
    command: binary,
    workerType: 'opencode',
  });
}

module.exports = {
  isProcessAlive,
  validateDispatch,
  readLogTail,
  dispatchCommand,
  dispatchAntigravityWorker,
  dispatchOpenCodeWorker,
};

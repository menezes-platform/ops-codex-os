const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { evictionReserves } = require('../storage/cache-manager');
const { syncDirectory, ensureDurableDirectory, writeExclusiveJson, writeAtomicJson } = require('../durable-file');

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
function executionRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['requestId', 'commandId'].includes(key))
    || typeof value.requestId !== 'string' || !ID.test(value.requestId)
    || typeof value.commandId !== 'string' || !ID.test(value.commandId)) {
    throw new Error('INVALID_EXECUTION_REQUEST');
  }
  return { requestId: value.requestId, commandId: value.commandId };
}

function normalizeCommands(commands) {
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) throw new Error('EXECUTOR_COMMANDS_REQUIRED');
  const output = new Map();
  for (const [id, command] of Object.entries(commands)) {
    if (!ID.test(id) || !command || !path.isAbsolute(command.executable || '')
      || !path.isAbsolute(command.cwd || '') || !Array.isArray(command.args)
      || command.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))
      || !Number.isInteger(command.timeoutMs) || command.timeoutMs < 50 || command.timeoutMs > 300_000
      || !Number.isInteger(command.maxOutputBytes) || command.maxOutputBytes < 1 || command.maxOutputBytes > 32_768
      || !Number.isSafeInteger(command.estimatedScratchBytes ?? 0) || (command.estimatedScratchBytes ?? 0) < 0
      || /\.(cmd|bat)$/i.test(command.executable)) throw new Error('INVALID_EXECUTOR_COMMAND');
    if (!fs.statSync(command.executable).isFile() || !fs.statSync(command.cwd).isDirectory()) throw new Error('INVALID_EXECUTOR_COMMAND');
    output.set(id, { ...command, args: [...command.args], estimatedScratchBytes: command.estimatedScratchBytes ?? 0 });
  }
  return output;
}

async function killTree(child, { platform = process.platform, spawnImpl = spawn, waitMs = 1000 } = {}) {
  if (!child.pid) return { code: 'TREE_KILL_START_FAILED' };
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    return new Promise(resolve => {
      let killer, timer, settled = false;
      const finish = code => {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve({ code });
      };
      try {
        killer = spawnImpl(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore', env: { SystemRoot: systemRoot, WINDIR: systemRoot } });
      } catch { finish('TREE_KILL_START_FAILED'); return; }
      timer = setTimeout(() => {
        try { killer.kill(); } catch {}
        killer.unref?.(); finish('TREE_KILL_UNCONFIRMED');
      }, waitMs);
      killer.once('error', () => finish('TREE_KILL_START_FAILED'));
      killer.once('close', code => finish(code === 0 ? 'TREE_KILL_CONFIRMED' : 'TREE_KILL_FAILED'));
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); return { code: 'TREE_KILL_CONFIRMED' }; }
    catch { try { child.kill('SIGKILL'); } catch {} return { code: 'TREE_KILL_FAILED' }; }
  }
}

const TERMINATION_CODES = Object.freeze(['TREE_KILL_CONFIRMED', 'TREE_KILL_FAILED', 'TREE_KILL_START_FAILED',
  'TREE_KILL_UNCONFIRMED', 'PROCESS_TERMINATION_UNCONFIRMED', 'PIPES_STILL_OPEN', 'PROCESS_SPAWN_FAILED', 'PROCESS_CLOSED']);

class FleetExecutor {
  constructor({ nodeId, secret, receiptDir, commands, statfs = fs.promises.statfs, io = fs,
    spawnImpl = spawn, terminate = killTree, supervisionMs = 5000 } = {}) {
    if (!ID.test(nodeId || '') || !secret || !path.isAbsolute(receiptDir || '')) throw new Error('EXECUTOR_CONFIG_REQUIRED');
    this.nodeId = nodeId;
    this.secret = secret;
    this.receiptDir = receiptDir;
    this.commands = normalizeCommands(commands);
    this.statfs = statfs;
    this.io = io;
    if (!Number.isInteger(supervisionMs) || supervisionMs < 1 || supervisionMs > 30_000) throw new Error('EXECUTOR_CONFIG_REQUIRED');
    this.spawnImpl = spawnImpl; this.terminate = terminate; this.supervisionMs = supervisionMs;
    this.guardPath = path.join(receiptDir, '.execution-active.json');
    this.guardHeld = fs.existsSync(this.guardPath);
    this.activeCount = 0;
    this.unresolved = new Set();
    try {
      for (const name of fs.readdirSync(receiptDir).filter(name => /^[0-9a-f]{64}\.json$/.test(name))) {
        const receipt = JSON.parse(fs.readFileSync(path.join(receiptDir, name), 'utf8'));
        if (receipt.status === 'RUNNING') this.unresolved.add(receipt.requestId);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  get activeJobs() { return Math.max(this.activeCount, this.unresolved.size, this.guardHeld ? 1 : 0); }

  guardConflict(request) {
    try {
      const guard = JSON.parse(fs.readFileSync(this.guardPath, 'utf8'));
      if (!ID.test(guard.requestId || '') || guard.nodeId !== this.nodeId || guard.requestId === request.requestId) return 'EXECUTION_STATE_UNCERTAIN';
      return 'EXECUTOR_BUSY';
    } catch { return 'EXECUTION_STATE_UNCERTAIN'; }
  }

  async execute(input) {
    const request = executionRequest(input);
    const command = this.commands.get(request.commandId);
    if (!command) throw new Error('COMMAND_NOT_ALLOWED');
    const target = path.join(this.receiptDir, crypto.createHash('sha256').update(request.requestId).digest('hex') + '.json');
    const readExisting = () => {
      const receipt = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (receipt.requestId !== request.requestId || receipt.commandId !== request.commandId || receipt.nodeId !== this.nodeId) throw new Error('EXECUTION_ID_CONFLICT');
      // RUNNING after a worker restart is uncertain. Never silently launch it again.
      return { ...receipt, replayed: true };
    };
    try { return readExisting(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.activeJobs >= 1) throw new Error(this.guardHeld ? this.guardConflict(request) : 'EXECUTOR_BUSY');
    this.activeCount += 1;
    try {
      const disk = await this.statfs(command.cwd);
      const total = Number(disk.bsize) * Number(disk.blocks);
      const free = Number(disk.bsize) * Number(disk.bavail);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)
        || free - command.estimatedScratchBytes < evictionReserves(total).startReserve) throw new Error('INSUFFICIENT_LOCAL_CAPACITY');
      ensureDurableDirectory(this.receiptDir, { io: this.io });
      // This guard fences different IDs across processes using the same receipt
      // directory. It is never broken by age/PID: uncertain work needs inspection.
      try {
        writeExclusiveJson(this.guardPath, { nodeId: this.nodeId, requestId: request.requestId, pid: process.pid }, { io: this.io });
        this.guardHeld = true;
      } catch (error) {
        this.guardHeld = fs.existsSync(this.guardPath);
        if (error.code === 'EEXIST') {
          try { return readExisting(); }
          catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
          throw new Error(this.guardConflict(request));
        }
        throw error;
      }
      this.unresolved.add(request.requestId);
      const receipt = { ...request, nodeId: this.nodeId, status: 'RUNNING', startedAt: new Date().toISOString() };
      try { this.directorySyncSupported = writeExclusiveJson(target, receipt, { io: this.io }); }
      catch (error) { if (error.code === 'EEXIST') return readExisting(); throw error; }
      const result = await this.run(command);
      const completed = { ...receipt, ...result,
        ...(result.status === 'RUNNING' ? { observedAt: new Date().toISOString() } : { finishedAt: new Date().toISOString() }) };
      // Persist metadata only: command output may contain private project data.
      const { stdout, stderr, ...durable } = completed;
      this.directorySyncSupported = writeAtomicJson(target, durable, { io: this.io });
      // No evidence of termination: keep both the receipt and cross-process guard.
      if (result.status === 'RUNNING') return { ...completed, replayed: false };
      this.unresolved.delete(request.requestId);
      this.io.unlinkSync(this.guardPath);
      syncDirectory(this.receiptDir, { io: this.io });
      this.guardHeld = false;
      return { ...completed, replayed: false };
    } finally { this.activeCount -= 1; }
  }

  run(command) {
    return new Promise(resolve => {
      // No inherited PATH, cloud credentials, node HMAC secret or caller-controlled environment.
      const env = {};
      for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
      let child;
      try {
        child = this.spawnImpl(command.executable, command.args, {
          cwd: command.cwd, env, shell: false, windowsHide: true,
          detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch { resolve({ status: 'FAILED', exitCode: null, outputTruncated: false, terminationCode: 'PROCESS_SPAWN_FAILED' }); return; }
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), used = 0;
      let outputTruncated = false, timedOut = false, settled = false, exited = false, closed = false;
      let code = null, signal = null, terminationCode = null, supervisionTimer;
      const collect = channel => chunk => {
        const remaining = Math.max(0, command.maxOutputBytes - used);
        if (chunk.length > remaining) outputTruncated = true;
        const bounded = chunk.subarray(0, remaining);
        used += bounded.length;
        if (channel === 'stdout') stdout = Buffer.concat([stdout, bounded]);
        else stderr = Buffer.concat([stderr, bounded]);
      };
      const finish = uncertain => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(supervisionTimer);
        const clean = bytes => bytes.toString('utf8').split(this.secret).join('[REDACTED]');
        if (uncertain) { child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.(); }
        resolve({ status: uncertain ? 'RUNNING' : timedOut ? 'TIMED_OUT' : code === 0 ? 'COMPLETED' : 'FAILED',
          exitCode: uncertain ? null : code, signal, stdout: clean(stdout), stderr: clean(stderr), outputTruncated,
          terminationCode: terminationCode || (uncertain ? exited ? 'PIPES_STILL_OPEN' : 'PROCESS_TERMINATION_UNCONFIRMED' : 'PROCESS_CLOSED') });
      };
      const reconcileClose = () => {
        if (closed && (!timedOut || terminationCode)) finish(timedOut && terminationCode !== 'TREE_KILL_CONFIRMED');
      };
      child.stdout?.on('data', collect('stdout'));
      child.stderr?.on('data', collect('stderr'));
      child.stdout?.on('error', () => {}); child.stderr?.on('error', () => {});
      const timer = setTimeout(() => {
        timedOut = true;
        supervisionTimer = setTimeout(() => {
          if (terminationCode === 'TREE_KILL_CONFIRMED') terminationCode = exited ? 'PIPES_STILL_OPEN' : 'PROCESS_TERMINATION_UNCONFIRMED';
          finish(true);
        }, this.supervisionMs);
        Promise.resolve().then(() => this.terminate(child)).then(outcome => {
          if (settled) return;
          terminationCode = TERMINATION_CODES.includes(outcome?.code) ? outcome.code : 'TREE_KILL_UNCONFIRMED';
          reconcileClose();
        }, () => { if (!settled) { terminationCode = 'TREE_KILL_START_FAILED'; reconcileClose(); } });
      }, command.timeoutMs);
      child.once('error', () => { /* Node emits close after spawn errors; keep paths/details private. */ });
      child.once('exit', () => { exited = true; });
      child.once('close', (exitCode, exitSignal) => {
        closed = true; code = exitCode; signal = exitSignal; reconcileClose();
      });
    });
  }
}

module.exports = { FleetExecutor, executionRequest, killTree, TERMINATION_CODES };

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { evictionReserves } = require('../storage/cache-manager');

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

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill('SIGKILL'));
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}

class FleetExecutor {
  constructor({ nodeId, secret, receiptDir, commands, statfs = fs.promises.statfs } = {}) {
    if (!ID.test(nodeId || '') || !secret || !path.isAbsolute(receiptDir || '')) throw new Error('EXECUTOR_CONFIG_REQUIRED');
    this.nodeId = nodeId;
    this.secret = secret;
    this.receiptDir = receiptDir;
    this.commands = normalizeCommands(commands);
    this.statfs = statfs;
    this.activeCount = 0;
    this.unresolved = new Set();
    try {
      for (const name of fs.readdirSync(receiptDir).filter(name => /^[0-9a-f]{64}\.json$/.test(name))) {
        const receipt = JSON.parse(fs.readFileSync(path.join(receiptDir, name), 'utf8'));
        if (receipt.status === 'RUNNING') this.unresolved.add(receipt.requestId);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  get activeJobs() { return Math.max(this.activeCount, this.unresolved.size); }

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
    if (this.activeJobs >= 1) throw new Error('EXECUTOR_BUSY');
    this.activeCount += 1;
    try {
      const disk = await this.statfs(command.cwd);
      const total = Number(disk.bsize) * Number(disk.blocks);
      const free = Number(disk.bsize) * Number(disk.bavail);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)
        || free - command.estimatedScratchBytes < evictionReserves(total).startReserve) throw new Error('INSUFFICIENT_LOCAL_CAPACITY');
      fs.mkdirSync(this.receiptDir, { recursive: true, mode: 0o700 });
      const receipt = { ...request, nodeId: this.nodeId, status: 'RUNNING', startedAt: new Date().toISOString() };
      let fd;
      try { fd = fs.openSync(target, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') return readExisting(); throw error; }
      try { fs.writeFileSync(fd, JSON.stringify(receipt)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      this.unresolved.add(request.requestId);
      const result = await this.run(command);
      const completed = { ...receipt, ...result, finishedAt: new Date().toISOString() };
      // Persist metadata only: command output may contain private project data.
      const { stdout, stderr, ...durable } = completed;
      const temp = target + '.' + crypto.randomUUID() + '.tmp';
      const finalFd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(finalFd, JSON.stringify(durable)); fs.fsyncSync(finalFd); }
      finally { fs.closeSync(finalFd); }
      fs.renameSync(temp, target);
      this.unresolved.delete(request.requestId);
      return { ...completed, replayed: false };
    } finally { this.activeCount -= 1; }
  }

  run(command) {
    return new Promise(resolve => {
      // No inherited PATH, cloud credentials, node HMAC secret or caller-controlled environment.
      const env = {};
      for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
      const child = spawn(command.executable, command.args, {
        cwd: command.cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), used = 0;
      let outputTruncated = false, timedOut = false;
      const collect = channel => chunk => {
        const remaining = Math.max(0, command.maxOutputBytes - used);
        if (chunk.length > remaining) outputTruncated = true;
        const bounded = chunk.subarray(0, remaining);
        used += bounded.length;
        if (channel === 'stdout') stdout = Buffer.concat([stdout, bounded]);
        else stderr = Buffer.concat([stderr, bounded]);
      };
      child.stdout.on('data', collect('stdout'));
      child.stderr.on('data', collect('stderr'));
      const timer = setTimeout(() => { timedOut = true; killTree(child); }, command.timeoutMs);
      child.on('error', () => { /* close follows error; never return OS paths or error details */ });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const clean = bytes => bytes.toString('utf8').split(this.secret).join('[REDACTED]');
        resolve({ status: timedOut ? 'TIMED_OUT' : code === 0 ? 'COMPLETED' : 'FAILED',
          exitCode: code, signal, stdout: clean(stdout), stderr: clean(stderr), outputTruncated });
      });
    });
  }
}

module.exports = { FleetExecutor, executionRequest };

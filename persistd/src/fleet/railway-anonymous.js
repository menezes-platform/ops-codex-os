const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_DAILY_LIMIT = 3;
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_EXEC_GUARD_MS = 90_000;

function safeName(value) {
  const name = String(value || 'worker').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return name.slice(0, 96) || 'worker';
}

function parseIso(value, code) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(code);
  return new Date(ms).toISOString();
}

function maybeManifest(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.build_expires_at || !parsed.preview_url) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseRailwayManifest(...streams) {
  for (const stream of streams) {
    const lines = String(stream || '').split(/\r?\n/).reverse();
    for (const line of lines) {
      const parsed = maybeManifest(line);
      if (!parsed) continue;
      return {
        status: String(parsed.status || ''),
        state: String(parsed.state || ''),
        description: parsed.description ? String(parsed.description) : null,
        previewUrl: String(parsed.preview_url || ''),
        claimUrl: parsed.human_claim_url ? String(parsed.human_claim_url) : null,
        buildExpiresAt: parseIso(parsed.build_expires_at, 'RAILWAY_ANON_DEADLINE_INVALID'),
        usage: parsed.usage && typeof parsed.usage === 'object' ? { ...parsed.usage } : {},
      };
    }
  }
  throw new Error('RAILWAY_ANON_MANIFEST_MISSING');
}

function stripRailwayManifest(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !maybeManifest(line))
    .join('\n')
    .replace(/\n+$/, '');
}

function defaultKeyRoot() {
  const base = process.env.PERSISTFLOW_DATA_DIR
    || path.join(os.homedir(), '.agents', 'persistd');
  return path.join(base, 'railway-anonymous-keys');
}

function defaultQuotaPath() {
  const base = process.env.PERSISTFLOW_DATA_DIR
    || path.join(os.homedir(), '.agents', 'persistd');
  return path.join(base, 'railway-anonymous-quota.json');
}

function runProcess(file, args, {
  cwd,
  env = process.env,
  timeoutMs = 0,
  input,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    let killTimer = null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 3_000);
        killTimer.unref?.();
      }, timeoutMs);
      timer.unref?.();
    }

    if (input !== undefined && input !== null) child.stdin.end(String(input));
    else child.stdin.end();
  });
}

class RailwayAnonymousQuotaStore {
  constructor(filePath = defaultQuotaPath(), { clock = () => new Date() } = {}) {
    this.filePath = String(filePath || '');
    this.clock = clock;
  }

  dayKey() {
    return this.clock().toISOString().slice(0, 10);
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (value.day !== this.dayKey()) return { day: this.dayKey(), used: 0 };
      const used = Number(value.used);
      return { day: value.day, used: Number.isInteger(used) && used >= 0 ? used : 0 };
    } catch (error) {
      if (error?.code === 'ENOENT') return { day: this.dayKey(), used: 0 };
      throw error;
    }
  }

  remaining(limit = DEFAULT_DAILY_LIMIT) {
    return Math.max(0, Number(limit) - this.read().used);
  }

  recordUse() {
    const state = this.read();
    const next = { day: this.dayKey(), used: state.used + 1 };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.filePath);
    return next;
  }
}

class RailwayAnonymousProvider {
  constructor({
    sshBinary = 'ssh',
    scpBinary = 'scp',
    sshKeygenBinary = 'ssh-keygen',
    host = 'railway.new',
    keyRoot = defaultKeyRoot(),
    quotaStore = new RailwayAnonymousQuotaStore(),
    dailyLimit = DEFAULT_DAILY_LIMIT,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    execGuardMs = DEFAULT_EXEC_GUARD_MS,
    clock = () => new Date(),
    runProcessImpl = runProcess,
  } = {}) {
    this.sshBinary = sshBinary;
    this.scpBinary = scpBinary;
    this.sshKeygenBinary = sshKeygenBinary;
    this.host = host;
    this.keyRoot = keyRoot;
    this.quotaStore = quotaStore;
    this.dailyLimit = Number(dailyLimit);
    this.connectTimeoutMs = Number(connectTimeoutMs);
    this.execGuardMs = Number(execGuardMs);
    this.clock = clock;
    this.runProcess = runProcessImpl;
    this.acquireTail = Promise.resolve();
  }

  sshBaseArgs(keyPath) {
    return [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      '-i', keyPath,
      '-T',
      this.host,
    ];
  }

  scpBaseArgs(keyPath) {
    return [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      '-i', keyPath,
    ];
  }

  describe(worker) {
    return {
      id: worker.id,
      provider: 'railway-anonymous',
      previewUrl: worker.previewUrl,
      buildExpiresAt: worker.buildExpiresAt,
      acquiredAt: worker.acquiredAt,
    };
  }

  remaining() {
    return this.quotaStore.remaining(this.dailyLimit);
  }

  async acquire(options = {}) {
    const prior = this.acquireTail;
    let unlock;
    this.acquireTail = new Promise((resolve) => { unlock = resolve; });
    await prior;
    try { return await this.acquireOne(options); }
    finally { unlock(); }
  }

  async acquireOne({ workerId } = {}) {
    if (this.remaining() <= 0) {
      throw new Error('RAILWAY_ANON_DAILY_BUDGET_EXHAUSTED');
    }

    const id = safeName(workerId || ('railway-' + Date.now()));
    fs.mkdirSync(this.keyRoot, { recursive: true });
    const keyPath = path.join(this.keyRoot, id);
    if (fs.existsSync(keyPath) || fs.existsSync(keyPath + '.pub')) {
      throw new Error('RAILWAY_ANON_KEY_EXISTS');
    }

    const keygen = await this.runProcess(this.sshKeygenBinary, [
      '-q', '-t', 'ed25519', '-N', '', '-f', keyPath,
    ], { timeoutMs: 10_000 });
    if (keygen.code !== 0 || keygen.timedOut) {
      throw new Error('RAILWAY_ANON_KEYGEN_FAILED');
    }

    let connected;
    try {
      connected = await this.runProcess(
        this.sshBinary,
        this.sshBaseArgs(keyPath),
        { timeoutMs: this.connectTimeoutMs },
      );
    } catch (error) {
      await this.release({ keyPath }, { cleanupKey: true });
      throw new Error('RAILWAY_ANON_CONNECT_FAILED:' + String(error?.code || 'process'));
    }

    let manifest;
    try {
      manifest = parseRailwayManifest(connected.stdout, connected.stderr);
    } catch (error) {
      await this.release({ keyPath }, { cleanupKey: true });
      const output = (connected.stdout + '\n' + connected.stderr).toLowerCase();
      if (output.includes('temporarily disabled') || output.includes('try again shortly')) {
        throw new Error('RAILWAY_ANON_CAPACITY_UNAVAILABLE');
      }
      throw error;
    }

    const deadlineMs = Date.parse(manifest.buildExpiresAt);
    if (deadlineMs <= this.clock().getTime()) {
      await this.release({ keyPath }, { cleanupKey: true });
      throw new Error('RAILWAY_ANON_DEADLINE_EXPIRED');
    }

    this.quotaStore.recordUse();
    return {
      id,
      provider: 'railway-anonymous',
      keyPath,
      previewUrl: manifest.previewUrl,
      claimUrl: manifest.claimUrl,
      buildExpiresAt: manifest.buildExpiresAt,
      acquiredAt: this.clock().toISOString(),
      manifest,
    };
  }

  remainingMs(worker) {
    return Date.parse(worker.buildExpiresAt) - this.clock().getTime();
  }

  async exec(worker, command, { timeoutMs } = {}) {
    if (!worker?.keyPath) throw new Error('RAILWAY_ANON_WORKER_INVALID');
    const remaining = this.remainingMs(worker) - this.execGuardMs;
    if (remaining <= 0) throw new Error('RAILWAY_ANON_HANDOFF_REQUIRED');
    const requested = timeoutMs == null ? remaining : Math.min(Number(timeoutMs), remaining);
    const effectiveTimeout = Math.max(1, Math.floor(requested));

    const result = await this.runProcess(
      this.sshBinary,
      [...this.sshBaseArgs(worker.keyPath), String(command || '')],
      { timeoutMs: effectiveTimeout },
    );

    const stdout = stripRailwayManifest(result.stdout);
    const stderr = stripRailwayManifest(result.stderr);
    if (result.timedOut) {
      const error = new Error('RAILWAY_ANON_EXEC_TIMEOUT');
      error.stdout = stdout;
      error.stderr = stderr;
      throw error;
    }
    if (result.code !== 0) {
      const error = new Error('RAILWAY_ANON_EXEC_FAILED:' + result.code);
      error.exitCode = result.code;
      error.stdout = stdout;
      error.stderr = stderr;
      throw error;
    }
    return { exitCode: 0, stdout, stderr };
  }

  assertRemotePath(remotePath) {
    const value = String(remotePath || '');
    if (!value.startsWith('/app/') && value !== '/app') {
      throw new Error('RAILWAY_ANON_REMOTE_PATH_FORBIDDEN');
    }
    return value;
  }

  async copyTo(worker, localPath, remotePath, { recursive = false, timeoutMs = 120_000 } = {}) {
    if (!worker?.keyPath) throw new Error('RAILWAY_ANON_WORKER_INVALID');
    const target = this.assertRemotePath(remotePath);
    const args = [
      ...this.scpBaseArgs(worker.keyPath),
      ...(recursive ? ['-r'] : []),
      String(localPath),
      this.host + ':' + target,
    ];
    const result = await this.runProcess(this.scpBinary, args, { timeoutMs });
    if (result.timedOut) throw new Error('RAILWAY_ANON_SCP_TIMEOUT');
    if (result.code !== 0) throw new Error('RAILWAY_ANON_SCP_FAILED:' + result.code);
    return { stdout: result.stdout, stderr: result.stderr };
  }

  async copyFrom(worker, remotePath, localPath, { recursive = false, timeoutMs = 120_000 } = {}) {
    if (!worker?.keyPath) throw new Error('RAILWAY_ANON_WORKER_INVALID');
    const source = this.assertRemotePath(remotePath);
    const args = [
      ...this.scpBaseArgs(worker.keyPath),
      ...(recursive ? ['-r'] : []),
      this.host + ':' + source,
      String(localPath),
    ];
    const result = await this.runProcess(this.scpBinary, args, { timeoutMs });
    if (result.timedOut) throw new Error('RAILWAY_ANON_SCP_TIMEOUT');
    if (result.code !== 0) throw new Error('RAILWAY_ANON_SCP_FAILED:' + result.code);
    return { stdout: result.stdout, stderr: result.stderr };
  }

  async release(worker, { cleanupKey = true } = {}) {
    if (!cleanupKey || !worker?.keyPath) return;
    for (const target of [worker.keyPath, worker.keyPath + '.pub']) {
      try { fs.unlinkSync(target); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_EXEC_GUARD_MS,
  RailwayAnonymousProvider,
  RailwayAnonymousQuotaStore,
  parseRailwayManifest,
  stripRailwayManifest,
  runProcess,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ALLOWED_TOOLS = Object.freeze({node: process.execPath, git: 'git', python: null});
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function containedIn(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function prepareSilentJob({taskId, tool, args = [], cwd, allowedRoot, logRoot, shell, requiresInteractiveUi, requiresBrowserSession, requiresGpu, timeoutMs = 60000, maxOutputBytes = 1048576} = {}) {
  if (requiresInteractiveUi || requiresBrowserSession || requiresGpu) throw new Error('SILENT_JOB_INTERACTIVE_FORBIDDEN');
  if (shell !== undefined && shell !== false) throw new Error('SILENT_JOB_SHELL_FORBIDDEN');
  if (!Object.hasOwn(ALLOWED_TOOLS, tool)) throw new Error('SILENT_JOB_TOOL_FORBIDDEN');
  // Windows Store python.exe aliases may open a Store GUI. Never execute them silently.
  let executable = ALLOWED_TOOLS[tool];
  if (tool === 'python') {
    const configured = process.env.FLEET_PYTHON_EXE;
    if (!configured || !path.isAbsolute(configured) || /[\\/]WindowsApps[\\/]/i.test(configured)) throw new Error('SILENT_JOB_PYTHON_NOT_CONFIGURED');
    executable = fs.realpathSync(configured);
    if (!/python(?:3(?:\\.\\d+)?)?\\.exe$/i.test(executable) || /[\\/]WindowsApps[\\/]/i.test(executable)) throw new Error('SILENT_JOB_PYTHON_NOT_CONFIGURED');
  }
  if (!ID_RE.test(String(taskId || ''))) throw new Error('SILENT_JOB_ID_INVALID');
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('SILENT_JOB_ARGS_INVALID');
  if (!allowedRoot || !cwd) throw new Error('SILENT_JOB_WORKSPACE_REQUIRED');
  const root = fs.realpathSync(allowedRoot);
  const working = fs.realpathSync(cwd);
  if (!containedIn(root, working)) throw new Error('SILENT_JOB_CWD_OUTSIDE_ROOT');
  const logs = path.resolve(logRoot || path.join(root, '.fleet-silent-jobs'));
  if (!containedIn(root, logs)) throw new Error('SILENT_JOB_LOG_OUTSIDE_ROOT');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15 * 60000) throw new Error('SILENT_JOB_TIMEOUT_INVALID');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 8 * 1048576) throw new Error('SILENT_JOB_OUTPUT_LIMIT_INVALID');
  return {taskId, tool, executable, args, cwd: working, root, logs, timeoutMs, maxOutputBytes};
}

async function runSilentJob(input = {}) {
  const job = prepareSilentJob(input);
  fs.mkdirSync(job.logs, {recursive:true});
  // Resolve symlinks in an existing logs directory before creating files there.
  if (!containedIn(job.root, fs.realpathSync(job.logs))) throw new Error('SILENT_JOB_LOG_OUTSIDE_ROOT');
  const jobDir = path.join(job.logs, job.taskId);
  fs.mkdirSync(jobDir); // fails closed on duplicate taskId; no replay/overwrites
  const stdoutPath = path.join(jobDir, 'stdout.log');
  const stderrPath = path.join(jobDir, 'stderr.log');
  const receiptPath = path.join(jobDir, 'receipt.json');
  const stdoutFd = fs.openSync(stdoutPath,'wx');
  const stderrFd = fs.openSync(stderrPath,'wx');
  let written = 0;
  let truncated = false;
  let timedOut = false;
  const startedAt = new Date().toISOString();
  const env = {...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', CI: 'true', TERM: 'dumb', NO_COLOR: '1'};
  // The HMAC authority is for the heartbeat, never for job subprocesses.
  delete env.PERSISTFLOW_FLEET_NODE_SECRET;
  delete env.PERSISTFLOW_FLEET_NODE_SECRETS_JSON;
  for (const key of Object.keys(env)) if (key.startsWith('PERSISTFLOW_FLEET_NODE_SECRET_')) delete env[key];
  function sink(fd) {
    return (data) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const remaining = Math.max(0, job.maxOutputBytes - written);
      const writeCount = Math.min(remaining, bytes.length);
      if (writeCount > 0) {
        fs.writeSync(fd, bytes, 0, writeCount);
        written += writeCount;
      }
      if (writeCount < bytes.length) truncated = true;
    };
  }
  let child;
  let spawnError;
  try {
    child = spawn(job.executable, job.args, {
      cwd:job.cwd, env, windowsHide:true, shell:false,
      detached:false, stdio:['ignore','pipe','pipe'],
    });
    child.stdout.on('data',sink(stdoutFd));
    child.stderr.on('data',sink(stderrFd));
    const timer = setTimeout(()=>{timedOut=true; child.kill();},job.timeoutMs);
    timer.unref();
    const completion = await new Promise((resolve)=>{
      child.once('error',(error)=>{spawnError=error;});
      child.once('close',(exitCode,signal)=>resolve({exitCode, signal}));
    });
    const status = timedOut ? 'timeout' : spawnError || completion.exitCode !== 0 ? 'failed' : 'completed';
    const receipt = {
      taskId:job.taskId, tool:job.tool, status,
      exitCode:completion.exitCode, signal:completion.signal || null,
      errorCode:spawnError?.code || null,
      startedAt, finishedAt:new Date().toISOString(),
      stdoutPath,stderrPath,receiptPath,
      truncated, windowsHide:true, shell:false,
    };
    fs.writeFileSync(receiptPath+'.tmp',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    fs.renameSync(receiptPath+'.tmp',receiptPath);
    return receipt;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

module.exports = {runSilentJob, prepareSilentJob};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ALLOWED_TOOLS = Object.freeze({node: process.execPath, git: 'git', python: null});
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DEFAULT_WORKSPACE_LIMIT=64*1024*1024;
const MAX_WORKSPACE_LIMIT=128*1024*1024;
const DEFAULT_DISK_RESERVE=30*1024*1024*1024;
function freeDiskBytes(directory) {
  const info=fs.statfsSync(directory);
  return Number(info.bavail)*Number(info.bsize);
}
function workspaceBytes(directory, cap) {
  let total=0;
  const stack=[directory];
  while(stack.length) {
    const current=stack.pop();
    for(const entry of fs.readdirSync(current,{withFileTypes:true})) {
      const file=path.join(current,entry.name);
      const stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())throw new Error('SILENT_JOB_WORKSPACE_SYMLINK_FORBIDDEN');
      if(stat.isDirectory())stack.push(file);
      else if(stat.isFile())total+=stat.size;
      else throw new Error('SILENT_JOB_WORKSPACE_NONFILE_FORBIDDEN');
      if(total>cap)return total;
    }
  }
  return total;
}

function containedIn(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function prepareSilentJob({taskId, tool, args = [], cwd, allowedRoot, logRoot, shell, requiresInteractiveUi, requiresBrowserSession, requiresGpu, timeoutMs = 60000, maxOutputBytes = 1048576, maxWorkspaceBytes = DEFAULT_WORKSPACE_LIMIT, minFreeDiskBytes = DEFAULT_DISK_RESERVE, workspaceScanMs = 250} = {}) {
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
  if (!Number.isSafeInteger(maxWorkspaceBytes) || maxWorkspaceBytes<1 || maxWorkspaceBytes>MAX_WORKSPACE_LIMIT) throw new Error('SILENT_JOB_WORKSPACE_QUOTA_INVALID');
  if (!Number.isSafeInteger(minFreeDiskBytes) || minFreeDiskBytes<0) throw new Error('SILENT_JOB_DISK_RESERVE_INVALID');
  if (!Number.isSafeInteger(workspaceScanMs) || workspaceScanMs<50 || workspaceScanMs>2000) throw new Error('SILENT_JOB_SCAN_INTERVAL_INVALID');
  return {taskId, tool, executable, args, cwd: working, root, logs, timeoutMs, maxOutputBytes, maxWorkspaceBytes, minFreeDiskBytes, workspaceScanMs};
}

async function runSilentJob(input = {}) {
  const job = prepareSilentJob(input);
  if (freeDiskBytes(job.cwd)<job.minFreeDiskBytes) throw new Error('SILENT_JOB_INSUFFICIENT_DISK');
  if (workspaceBytes(job.cwd,job.maxWorkspaceBytes)>job.maxWorkspaceBytes) throw new Error('SILENT_JOB_WORKSPACE_LIMIT_EXCEEDED');
  const tmp=path.join(job.cwd,'.tmp');
  fs.mkdirSync(tmp,{recursive:true});
  if (!containedIn(job.cwd,fs.realpathSync(tmp))) throw new Error('SILENT_JOB_TEMP_OUTSIDE_WORKSPACE');
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
  let resourceError = null;
  const startedAt = new Date().toISOString();
  const env = {...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', CI: 'true', TERM: 'dumb', NO_COLOR: '1',
    TMP:tmp, TEMP:tmp, TMPDIR:tmp, XDG_CACHE_HOME:tmp, NPM_CONFIG_CACHE:path.join(tmp,'npm-cache')};
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
    const monitor=setInterval(()=>{
      if(resourceError)return;
      try {
        if(workspaceBytes(job.cwd,job.maxWorkspaceBytes)>job.maxWorkspaceBytes)resourceError='SILENT_JOB_WORKSPACE_LIMIT_EXCEEDED';
        else if(freeDiskBytes(job.cwd)<job.minFreeDiskBytes)resourceError='SILENT_JOB_INSUFFICIENT_DISK';
      } catch(error) {resourceError=String(error?.message||'SILENT_JOB_QUOTA_MONITOR_ERROR');}
      if(resourceError)child.kill();
    },job.workspaceScanMs);
    monitor.unref();
    const completion = await new Promise((resolve)=>{
      child.once('error',(error)=>{spawnError=error;});
      child.once('close',(exitCode,signal)=>resolve({exitCode, signal}));
    });
    clearTimeout(timer);
    clearInterval(monitor);
    try {
      if(!resourceError && workspaceBytes(job.cwd,job.maxWorkspaceBytes)>job.maxWorkspaceBytes)resourceError='SILENT_JOB_WORKSPACE_LIMIT_EXCEEDED';
      if(!resourceError && freeDiskBytes(job.cwd)<job.minFreeDiskBytes)resourceError='SILENT_JOB_INSUFFICIENT_DISK';
    } catch(error) {resourceError=String(error?.message||'SILENT_JOB_QUOTA_MONITOR_ERROR');}
    const status = timedOut ? 'timeout' : resourceError || spawnError || completion.exitCode !== 0 ? 'failed' : 'completed';
    const receipt = {
      taskId:job.taskId, tool:job.tool, status,
      exitCode:completion.exitCode, signal:completion.signal || null,
      errorCode:resourceError || spawnError?.code || null,
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

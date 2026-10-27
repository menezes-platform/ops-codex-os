#!/usr/bin/env node
// Thin, dependency-free bridge from Codex to the user's authenticated Antigravity CLI.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODES = new Set(['plan', 'accept-edits']);
const DEFAULT_MODEL = 'gemini-4-argon-medium';
const DEFAULT_TIMEOUT = 180;
const executable = process.env.GEMINI_BRIDGE_AGY || (process.platform === 'win32' ? 'agy.exe' : 'agy');

export function normalizeRequest(input) {
  if (!input || !Array.isArray(input.workers) || input.workers.length < 1 || input.workers.length > 8) {
    throw new Error('workers must contain 1 to 8 tasks');
  }
  const concurrency = input.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('concurrency must be an integer from 1 to 8');
  }
  const context = input.context || '';
  if (typeof context !== 'string' || context.length > 4000) throw new Error('context exceeds 4000 characters');
  const worktrees = new Set();
  const workers = input.workers.map((item, index) => {
    if (typeof item?.task !== 'string' || !item.task.trim() || item.task.length > 4000) {
      throw new Error('each worker needs a nonempty task up to 4000 characters');
    }
    const mode = item.mode || 'plan';
    if (!MODES.has(mode)) throw new Error('invalid worker mode');
    const workdir = item.workdir || input.workdir || null;
    if (workdir != null && (typeof workdir !== 'string' || !isAbsolute(workdir))) {
      throw new Error('workdir must be an absolute path');
    }
    if (mode === 'accept-edits') {
      if (!workdir) throw new Error('mutating workers require an explicitly isolated worktree');
      const key = normalize(resolve(workdir)).toLowerCase();
      if (worktrees.has(key)) throw new Error('mutating workers cannot share the same worktree');
      worktrees.add(key);
    }
    const model = item.model || input.model || DEFAULT_MODEL;
    const effort = item.effort || input.effort || 'medium';
    if (!/^[a-z][a-z0-9.-]{2,79}$/.test(model)) throw new Error('invalid model id');
    if (!['low', 'medium', 'high'].includes(effort)) throw new Error('invalid effort');
    const timeoutSeconds = item.timeoutSeconds ?? input.timeoutSeconds ?? DEFAULT_TIMEOUT;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 1800) {
      throw new Error('timeoutSeconds must be 10 to 1800');
    }
    return {
      label: typeof item.label === 'string' && item.label.trim() ? item.label.slice(0, 80) : `gemini-${index + 1}`,
      task: context ? `Context:\n${context}\n\nTask:\n${item.task}` : item.task,
      mode, workdir, model, effort, timeoutSeconds
    };
  });
  return { workers, concurrency };
}

export function buildArgs(worker) {
  return [
    '--print', worker.task,
    '--output-format', 'json',
    '--mode', worker.mode,
    '--model', worker.model,
    '--effort', worker.effort,
    '--print-timeout', `${worker.timeoutSeconds}s`
  ];
}

export function projectResult(json) {
  return {
    ok: json.status === 'SUCCESS',
    response: typeof json.response === 'string' ? json.response : '',
    conversationId: json.conversation_id ?? null,
    totalTokens: json.usage?.total_tokens ?? null,
    durationSeconds: json.duration_seconds ?? null
  };
}

async function verifyWorktree(worker) {
  if (worker.mode !== 'accept-edits') return;
  const cwd = resolve(worker.workdir);
  // Linked worktrees have a .git FILE; primary repository checkouts have a .git DIRECTORY.
  const gitMeta = await stat(join(cwd, '.git')).catch(() => null);
  if (!gitMeta?.isFile()) throw new Error('mutating worker must run in a dedicated Git linked worktree');
  const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {encoding:'utf8', windowsHide:true}).trim();
  if (normalize(root).toLowerCase() !== normalize(cwd).toLowerCase()) {
    throw new Error('workdir must be the linked worktree root');
  }
  const branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {encoding:'utf8', windowsHide:true}).trim();
  if (!branch.startsWith('agent/')) throw new Error('mutating worker requires a dedicated agent/* branch');
}

export async function invokeWorker(worker) {
  await verifyWorktree(worker);
  return await new Promise((resolveResult, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(executable, buildArgs(worker), {
      cwd: worker.workdir || process.cwd(),
      shell: false,
      windowsHide: true,
      env: process.env
    });
    const watchdog = setTimeout(() => child.kill(), (worker.timeoutSeconds + 15) * 1000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 3_000_000) child.kill();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) child.kill();
    });
    child.on('error', err => { clearTimeout(watchdog); reject(new Error(`Antigravity CLI failed: ${err.code || err.message}`)); });
    child.on('close', code => {
      clearTimeout(watchdog);
      if (code !== 0) return reject(new Error(`Antigravity CLI exited with code ${code}; inspect local CLI diagnostics`));
      try {
        const json = JSON.parse(stdout.trim());
        const result = projectResult(json);
        if (!result.ok) return reject(new Error(`Gemini returned status ${json.status || 'unknown'}`));
        resolveResult(result);
      } catch (err) {
        reject(new Error(`Antigravity response parsing failed: ${err.message}`));
      }
    });
  });
}

export async function runDelegation(request, invoke = invokeWorker) {
  const results = new Array(request.workers.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(request.concurrency, request.workers.length)}, async () => {
    while (next < request.workers.length) {
      const index = next++;
      const worker = request.workers[index];
      try {
        results[index] = {label: worker.label, ...(await invoke(worker))};
      } catch (err) {
        results[index] = {label: worker.label, ok:false, error:err.message};
      }
    }
  }));
  return results;
}

function runCommand(args, timeoutMs=15000) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, {shell:false, windowsHide:true});
    let stdout = '';
    const watchdog = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); if (stdout.length > 100_000) child.kill(); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(watchdog);
      code === 0 ? resolveCommand(stdout.trim()) : reject(new Error(`agy exited with code ${code}`));
    });
  });
}

async function main(argv) {
  const command = argv[0];
  if (command === 'health') {
    const version = await runCommand(['--version']);
    process.stdout.write(JSON.stringify({ok:true,backend:'antigravity-cli',version}) + '\n');
    return;
  }
  if (command === 'models') {
    const models = await runCommand(['models'], 45000);
    process.stdout.write(JSON.stringify({ok:true,models:models.split(/\r?\n/).filter(Boolean)}) + '\n');
    return;
  }
  if (command === 'delegate') {
    const flag = argv.indexOf('--request-file');
    if (flag < 0 || !argv[flag+1]) throw new Error('delegate requires --request-file <JSON>');
    const request = normalizeRequest(JSON.parse(await readFile(argv[flag+1], 'utf8')));
    const workers = await runDelegation(request);
    process.stdout.write(JSON.stringify({ok:workers.every(w => w.ok),workers}) + '\n');
    if (workers.some(w => !w.ok)) process.exitCode = 1;
    return;
  }
  process.stdout.write('Usage: gemini-bridge health | models | delegate --request-file path.json\n');
  if (command && command !== '--help' && command !== 'help') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(err => {
    process.stderr.write(JSON.stringify({ok:false,error:err.message}) + '\n');
    process.exitCode = 1;
  });
}

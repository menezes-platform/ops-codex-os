#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  compactSuccessorPrompt,
  eligibleForSuccessor,
  eventDirFor,
  markSuccessorLaunched,
  safeId,
  stateRoot,
} = require('./codex-thin-controller');

function parseArgs(argv) {
  const options = { once: false, intervalSeconds: 30, home: os.homedir(), codexCommand: 'codex' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--once') options.once = true;
    else if (arg === '--interval-seconds') options.intervalSeconds = Math.max(10, Number(argv[++index]) || 30);
    else if (arg === '--home') options.home = argv[++index];
    else if (arg === '--codex-command') options.codexCommand = argv[++index];
    else if (arg === '--loop') options.once = false;
    else throw new Error('UNKNOWN_ARG:' + arg);
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionFiles(home) {
  const dir = path.join(stateRoot(home), 'sessions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => path.join(dir, name));
}

function readStateFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function launchSuccessor(state, options, now = new Date()) {
  if (!state.cwd || !fs.existsSync(state.cwd)) return { launched: false, reason: 'cwd_missing' };
  const logRoot = path.join(stateRoot(options.home), 'rollovers');
  fs.mkdirSync(logRoot, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = safeId(state.sessionId) + '-' + stamp;
  const stdoutPath = path.join(logRoot, base + '.jsonl');
  const stderrPath = path.join(logRoot, base + '.err.log');
  const out = fs.openSync(stdoutPath, 'a');
  const err = fs.openSync(stderrPath, 'a');
  const prompt = compactSuccessorPrompt(state, eventDirFor(state.sessionId, options.home));
  const child = spawn(options.codexCommand, ['exec', '-C', state.cwd, '--json', '-'], {
    windowsHide: true,
    stdio: ['pipe', out, err],
  });
  child.stdin.end(prompt);
  child.on('error', () => {});
  child.on('close', () => {
    try { fs.closeSync(out); } catch {}
    try { fs.closeSync(err); } catch {}
  });
  markSuccessorLaunched(state, child.pid, options.home, now);
  return { launched: true, pid: child.pid, stdoutPath, stderrPath };
}

function scanOnce(options, now = new Date()) {
  const results = [];
  for (const file of sessionFiles(options.home)) {
    const state = readStateFile(file);
    if (!state || !eligibleForSuccessor(state, now)) continue;
    results.push({ sessionId: state.sessionId, ...launchSuccessor(state, options, now) });
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  do {
    const results = scanOnce(options);
    if (results.length) process.stdout.write(JSON.stringify({ at: new Date().toISOString(), results }) + '\n');
    if (options.once) break;
    await sleep(options.intervalSeconds * 1000);
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write((error.stack || error.message) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { launchSuccessor, parseArgs, scanOnce, sessionFiles };

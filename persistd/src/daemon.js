#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tick } = require('./orchestrator');
const { createEgoBrowserTransport } = require('./browser/ego-browser');
const { createNotifier } = require('./notifier');
const { createRemoteHealth } = require('./remote-health');
const { createRemoteAuthorityClient } = require('./persistflow/remote-authority');

function parseArgs(argv) {
  const out = {
    once: false,
    root: path.join(os.homedir(), '.agents', 'continuations'),
    rolloverMinutes: 20,
    intervalSeconds: 15,
    includeSynthetic: false, runId: null,
    egoCommand: process.env.PERSISTD_EGO_COMMAND || 'ego-browser',
    remoteUrl: process.env.PERSISTFLOW_REMOTE_URL || null,
    remoteTokenFile: process.env.PERSISTFLOW_REMOTE_TOKEN_FILE || path.join(os.homedir(), '.persistflow', 'mcp-token.txt'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') out.once = true;
    else if (arg === '--include-synthetic') out.includeSynthetic = true; else if (arg === '--run-id') out.runId = argv[++i];
    else if (arg === '--root') out.root = argv[++i];
    else if (arg === '--rollover-minutes') out.rolloverMinutes = Number(argv[++i]);
    else if (arg === '--interval-seconds') out.intervalSeconds = Number(argv[++i]);
    else if (arg === '--ego-command') out.egoCommand = argv[++i];
    else if (arg === '--remote-url') out.remoteUrl = argv[++i];
    else if (arg === '--remote-token-file') out.remoteTokenFile = argv[++i];
    else throw new Error(`UNKNOWN_ARG:${arg}`);
  }
  return out;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function createRemoteAuthorityFromOptions(options, { readFileSync = fs.readFileSync, createClient = createRemoteAuthorityClient } = {}) {
  if (!options.remoteUrl) return null;
  let token = '';
  try { token = String(readFileSync(options.remoteTokenFile, 'utf8')).trim(); } catch {}
  if (!token) throw new Error('REMOTE_AUTHORITY_TOKEN_REQUIRED');
  return createClient({ baseUrl: options.remoteUrl, token });
}

async function runOnce(options) {
  const browser = createEgoBrowserTransport({ command: options.egoCommand });
  const notifier = createNotifier({ browser });
  const remoteHealth = createRemoteHealth({ browser });
  const remoteAuthority = createRemoteAuthorityFromOptions(options);
  return tick({
    root: options.root,
    browser,
    notifier,
    remoteHealth,
    remoteAuthority,
    rolloverMinutes: options.rolloverMinutes,
    includeSynthetic: options.includeSynthetic, runId: options.runId,
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.once) {
    const result = await runOnce(options);
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  for (;;) {
    try {
      const result = await runOnce(options);
      process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...result }) + '\n');
    } catch (error) {
      process.stderr.write(JSON.stringify({ at: new Date().toISOString(), error: error.message }) + '\n');
    }
    await sleep(Math.max(5, options.intervalSeconds) * 1000);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, createRemoteAuthorityFromOptions, runOnce, main };

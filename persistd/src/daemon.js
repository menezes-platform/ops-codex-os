#!/usr/bin/env node
const os = require('node:os');
const path = require('node:path');
const { tick } = require('./orchestrator');
const { createEgoBrowserTransport } = require('./browser/ego-browser');
const { createNotifier } = require('./notifier');
const { createRemoteHealth } = require('./remote-health');
const { parseMachineProviderIds, resolveMachineProviders } = require('./remote/machine-providers');

function parseArgs(argv) {
  const out = {
    once: false,
    root: path.join(os.homedir(), '.agents', 'continuations'),
    rolloverMinutes: 20,
    intervalSeconds: 15,
    includeSynthetic: false, runId: null,
    egoCommand: process.env.PERSISTD_EGO_COMMAND || 'ego-browser',
    machineProviders: process.env.PERSISTD_MACHINE_PROVIDERS || 'rdc',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--once') out.once = true;
    else if (arg === '--include-synthetic') out.includeSynthetic = true; else if (arg === '--run-id') out.runId = argv[++i];
    else if (arg === '--root') out.root = argv[++i];
    else if (arg === '--rollover-minutes') out.rolloverMinutes = Number(argv[++i]);
    else if (arg === '--interval-seconds') out.intervalSeconds = Number(argv[++i]);
    else if (arg === '--ego-command') out.egoCommand = argv[++i];
    else if (arg === '--machine-providers') out.machineProviders = argv[++i];
    else throw new Error(`UNKNOWN_ARG:${arg}`);
  }
  return out;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runOnce(options) {
  const machineProviderIds = parseMachineProviderIds(options.machineProviders);
  const machineProviders = resolveMachineProviders(machineProviderIds);
  const browser = createEgoBrowserTransport({ command: options.egoCommand, machineProviders });
  const notifier = createNotifier({ browser });
  const remoteHealth = createRemoteHealth({ browser });
  return tick({
    root: options.root,
    browser,
    notifier,
    remoteHealth,
    rolloverMinutes: options.rolloverMinutes,
    includeSynthetic: options.includeSynthetic, runId: options.runId,
    machineProviderIds,
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

module.exports = { parseArgs, runOnce, main };

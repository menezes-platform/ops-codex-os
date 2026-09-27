#!/usr/bin/env node
const { RailwayAnonymousProvider } = require('../src/fleet/railway-anonymous');

async function main() {
  const command = process.argv.slice(2).join(' ') || 'printf "REMOTE_OK\\n"; uname -s; node --version';
  const provider = new RailwayAnonymousProvider();
  let worker;
  try {
    worker = await provider.acquire({ workerId: 'smoke-' + Date.now() });
    const result = await provider.exec(worker, command, { timeoutMs: 120_000 });
    process.stdout.write(JSON.stringify({
      worker: provider.describe(worker),
      result,
    }, null, 2) + '\n');
  } finally {
    if (worker) await provider.release(worker);
  }
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + '\n');
  process.exitCode = 1;
});

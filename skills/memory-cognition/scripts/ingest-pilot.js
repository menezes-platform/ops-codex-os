'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildCorpus } = require('./evaluate-pilot');
const { HindsightAdapter } = require('../src');

function isPrivateEndpoint(input) {
  let host;
  try { host = new URL(input).hostname.toLowerCase(); } catch { return false; }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return host === '::1';
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function parseArgs(argv) {
  const args = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--repo') args.repo = argv[++index];
    else if (argv[index] === '--confirm-public-corpus') args.confirm = true;
    else throw new Error('unsupported argument');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = process.env.HINDSIGHT_API_URL;
  if (!args.confirm) throw new Error('explicit --confirm-public-corpus is required');
  if (!endpoint || !isPrivateEndpoint(endpoint)) throw new Error('HINDSIGHT_API_URL must point to a local or private-network endpoint');
  if (!args.repo) throw new Error('--repo <public project checkout> is required');
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pilot/manifest.json'), 'utf8'));
  const docs = buildCorpus(path.resolve(args.repo), manifest).filter((doc) => doc.provenance.path);
  const events = docs.map((doc) => ({
    eventId: doc.id,
    content: doc.text,
    observedAt: doc.provenance.timestamp,
    provenance: { ...doc.provenance },
  }));
  const adapter = new HindsightAdapter({ baseUrl: endpoint, token: process.env.HINDSIGHT_API_TOKEN, projectScopes: [manifest.scope] });
  let ingested = 0;
  let rejected = 0;
  let duplicates = 0;
  for (let offset = 0; offset < events.length; offset += 20) {
    const result = await adapter.ingest({ scope: manifest.scope, events: events.slice(offset, offset + 20) });
    ingested += result.ingested;
    rejected += result.rejected;
    duplicates += result.duplicates;
  }
  process.stdout.write(`${JSON.stringify({ scope: manifest.scope, sourceCount: events.length, ingested, rejected, duplicates, metrics: adapter.metrics.snapshot(), contentLogged: false })}\n`);
  if (rejected) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { isPrivateEndpoint, parseArgs };

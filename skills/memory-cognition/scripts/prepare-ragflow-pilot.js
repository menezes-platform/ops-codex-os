'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildCorpus } = require('./evaluate-pilot');

function safeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/^project\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function buildRAGFlowProjection(docs, scope) {
  if (!Array.isArray(docs)) throw new Error('docs must be a list');
  if (typeof scope !== 'string' || !/^project\/[^/]+\/[^/]+$/i.test(scope)) throw new Error('scope must be project/<owner>/<repo>');
  const [, owner, repo] = scope.toLowerCase().split('/');
  const repoName = `${owner}/${repo}`;
  const currentRef = docs.find((doc) => doc?.provenance?.repo === repoName && doc?.stale !== true)?.provenance?.ref ?? 'unknown';
  const dataset = {
    name: `cognition-${safeName(repoName)}-${String(currentRef).slice(0, 7)}`,
    scope: scope.toLowerCase(),
    repo: repoName,
    current_ref: currentRef,
    authority: 'derived-shadow-index',
    canonical_write: false,
  };
  const chunks = docs.map((doc) => {
    if (!doc || typeof doc.id !== 'string' || typeof doc.text !== 'string' || !doc.text.trim()) throw new Error('projection document unavailable');
    const projectionId = crypto.createHash('sha256').update(`${scope}\0${doc.id}`).digest('hex').slice(0, 40);
    const provenance = doc.provenance ?? {};
    if (provenance.repo && String(provenance.repo).toLowerCase() !== repoName) throw new Error('projection scope mismatch');
    return {
      projection_id: projectionId,
      content: doc.text,
      metadata: {
        repo: repoName,
        ref: provenance.ref ?? null,
        path: provenance.path ?? null,
        section: provenance.section ?? null,
        observed_at: provenance.timestamp ?? null,
        stale: doc.stale === true,
        source_id: doc.id,
        projection_id: projectionId,
        scope: scope.toLowerCase(),
        canonical_write: false,
      },
    };
  });
  return { schema_version: 1, dataset, chunks };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') args.repo = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
    else throw new Error('unsupported argument');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo) throw new Error('pass --repo <pilot-checkout>');
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pilot/manifest.json'), 'utf8'));
  const docs = buildCorpus(path.resolve(args.repo), manifest);
  const projection = buildRAGFlowProjection(docs, manifest.scope);
  const rendered = `${JSON.stringify(projection, null, 2)}\n`;
  if (args.output) fs.writeFileSync(path.resolve(args.output), rendered, { mode: 0o600 });
  else process.stdout.write(rendered);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildRAGFlowProjection, safeName };

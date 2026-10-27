const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadFleetConfig } = require('./src/fleet/contracts');

test('MARTHA is registered only as a drained Windows coding node until securely provisioned', () => {
  const pathname = path.join(__dirname, 'config', 'fleet.json');
  const raw = fs.readFileSync(pathname, 'utf8');
  const config = loadFleetConfig(JSON.parse(raw));
  const matching = config.nodes.filter((node) => node.id === 'conthabil-martha');
  assert.equal(matching.length, 1);
  const [node] = matching;
  assert.equal(node.platform, 'win32');
  assert.equal(node.arch, 'x64');
  assert.equal(node.concurrencyLimit, 1);
  assert.equal(node.drained, true, 'no unverified automatic routing');
  assert.deepEqual(node.capabilities, ['git', 'node']);
  assert.ok(node.affinities.includes('background'));
  assert.ok(node.affinities.includes('tests'));
  assert.equal(/\"(?:secret|password|privateKey)\"\s*:/i.test(raw), false);
});

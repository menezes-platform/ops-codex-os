const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('retired aws-vm is not registered as an eligible fleet node', () => {
  const configPath = path.join(__dirname, 'config', 'fleet.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const retired = config.nodes.find((node) => node.id === 'aws-vm');
  assert.equal(retired, undefined, 'retired aws-vm must be removed from production fleet config');
});

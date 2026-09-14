const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMachineProviderIds, resolveMachineProviders } = require('./src/remote/machine-providers');

test('provider parsing defaults to RDC and preserves declared priority', () => {
  assert.deepEqual(parseMachineProviderIds(''), ['rdc']);
  assert.deepEqual(parseMachineProviderIds('rdc,sentinelx,menezes_remote'), ['rdc', 'sentinelx', 'menezes_remote']);
});

test('unknown provider ids fail closed', () => {
  assert.throws(() => resolveMachineProviders(['rdc', 'unknown']), /UNKNOWN_MACHINE_PROVIDER:unknown/);
});

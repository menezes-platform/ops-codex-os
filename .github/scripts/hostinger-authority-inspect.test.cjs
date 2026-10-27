'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectMetadata, inspect } = require('./hostinger-authority-inspect.cjs');

test('redacts environment-variable values and exposes names only', () => {
  const result = selectMetadata('/builds/settings/env',
    { data: [{ name: 'PERSISTFLOW_FLEET_NODE_SECRET_CONTHABIL_MARTHA', value: 'NEVER_PRINT_ME' }] });
  assert.equal(result.marthaEnvPresent, true);
  assert.equal(JSON.stringify(result).includes('NEVER_PRINT_ME'), false);
});
test('read-only inspector issues only GET requests with expected host and never outputs token', async () => {
  const requests = [];
  const origLog = console.log;
  const lines = [];
  console.log = s => lines.push(String(s));
  try {
    const count = await inspect({
      token: 'FAKE_SECRET_VALUE',
      fetchImpl: async (url, options) => {
        requests.push({ url, method: options.method });
        return { status: 200, json: async () => ({ data: [] }) };
      },
    });
    assert.equal(count, 3);
    assert.ok(requests.every(v => v.method === 'GET' && v.url.includes('/accounts/u775492464/websites/darkslategrey-raccoon-448222.hostingersite.com/nodejs/')));
    assert.equal(lines.join('\n').includes('FAKE_SECRET_VALUE'), false);
  } finally {
    console.log = origLog;
  }
});

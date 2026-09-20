const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSuccessorScript } = require('./src/browser/ego-script');

test('successor waits for exact nonce-bound CLAIM_REQUEST before reporting submitted', () => {
  const runId = 'claim-proof';
  const nonce = 'nonce-28';
  const request = `CLAIM_REQUEST ${runId} G28 ${nonce}`;
  const message = [
    'PERSISTENT CONVERSATION CONTROLLER TAKEOVER',
    `RUN_ID: ${runId}`,
    'GENERATION: 28',
    `CLAIM_NONCE: ${nonce}`,
    '',
    `CLAIM ${runId} G28`,
    request,
  ].join('\n');

  const script = buildSuccessorScript({ runId, message, nextGeneration: 28 });
  assert.match(script, /timeout: 120000/);
  assert.match(script, /requestLine:/);
  assert.match(script, /baton-visible\+claim-request-visible/);
  assert.ok(script.includes(JSON.stringify(request)));
  assert.doesNotMatch(script, /claim-marker-visible/);

  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(script));
});

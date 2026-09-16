const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseArgs, createRemoteAuthorityFromOptions } = require('./src/daemon');

test('daemon accepts remote authority URL and token file', () => {
  const parsed = parseArgs([
    '--remote-url', 'https://persist.example',
    '--remote-token-file', 'C:\\secret\\token.txt',
    '--once',
  ]);
  assert.equal(parsed.remoteUrl, 'https://persist.example');
  assert.equal(parsed.remoteTokenFile, 'C:\\secret\\token.txt');
});

test('daemon builds remote authority client from local token file', () => {
  let captured = null;
  const client = { inspectRun() {} };
  const result = createRemoteAuthorityFromOptions({ remoteUrl: 'https://persist.example', remoteTokenFile: 'token.txt' }, {
    readFileSync(file, encoding) { assert.equal(file, 'token.txt'); assert.equal(encoding, 'utf8'); return 'secret-token\n'; },
    createClient(options) { captured = options; return client; },
  });
  assert.equal(result, client);
  assert.deepEqual(captured, { baseUrl: 'https://persist.example', token: 'secret-token' });
});

test('daemon fails closed when remote authority token is unavailable', () => {
  assert.throws(() => createRemoteAuthorityFromOptions({ remoteUrl: 'https://persist.example', remoteTokenFile: path.join('missing', 'token') }, {
    readFileSync() { const error = new Error('missing'); error.code = 'ENOENT'; throw error; },
    createClient() { throw new Error('should not create'); },
  }), /REMOTE_AUTHORITY_TOKEN_REQUIRED/);
});

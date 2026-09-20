const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSuccessorMessage } = require('./src/handoff');

test('Windows successor baton avoids RDC file handles on live CONTROL authority', () => {
  const baton = buildSuccessorMessage({
    RUN_ID: 'control-read-safe',
    CLAIM_NONCE: 'nonce',
    PROJECT_ROOT: 'C:\\repo',
    CONTROL_PATH: 'C:\\state\\CONTROL.md',
  }, 2);
  assert.match(baton, /never use read_file\/read_multiple_files on the live CONTROL\.md/i);
  assert.match(baton, /short-lived read-only process/i);
  assert.match(baton, /Get-Content -Raw/i);
});

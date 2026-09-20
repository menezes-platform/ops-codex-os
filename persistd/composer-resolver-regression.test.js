const test = require('node:test');
const assert = require('node:assert/strict');
const { buildComposerResolveScript } = require('./src/browser/composer-script');
const egoScript = require('./src/browser/ego-script');
const { buildSendMessageScript } = require('./src/browser/conversation-script');

test('composer resolver tolerates selector drift and emits diagnostics', () => {
  const resolver = buildComposerResolveScript({ timeoutMs: 30000 });
  assert.match(resolver, /prompt-textarea/);
  assert.match(resolver, /mensagem\|message/i);
  assert.match(resolver, /contenteditable/);
  assert.match(resolver, /composerDiagnostics/);
  assert.match(resolver, /composerDeadline/);
});

test('successor terminal and confirmation share resilient composer resolution', () => {
  const successor = egoScript.buildSuccessorScript({ runId: 'composer-fix', message: 'baton', nextGeneration: 2 });
  const terminal = egoScript.buildTerminalScript({ runId: 'composer-fix', chatId: 'chat-2', message: 'done' });
  const confirmation = buildSendMessageScript({ runId: 'composer-fix', chatId: 'chat-2', message: 'confirm', verifyLine: 'CLAIM_CONFIRMED composer-fix G2 nonce' });
  for (const script of [successor, terminal, confirmation]) {
    assert.match(script, /composerDeadline/);
    assert.match(script, /composerDiagnostics/);
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    assert.doesNotThrow(() => new AsyncFunction(script));
  }
});

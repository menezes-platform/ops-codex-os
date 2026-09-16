const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseStartMode } = require('./src/start-entrypoint');

test('uses PersistFlow web mode when PORT is provided', () => {
  assert.equal(chooseStartMode({ PORT: '3000' }), 'web');
  assert.equal(chooseStartMode({ PORT: '0' }), 'web');
});

test('keeps Persistd daemon mode without PORT', () => {
  assert.equal(chooseStartMode({}), 'daemon');
});

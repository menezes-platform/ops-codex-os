const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseStartMode, createProductionFleetRouter } = require('./src/start-entrypoint');

test('uses PersistFlow web mode when PORT is provided', () => {
  assert.equal(chooseStartMode({ PORT: '3000' }), 'web');
  assert.equal(chooseStartMode({ PORT: '0' }), 'web');
});

test('keeps Persistd daemon mode without PORT', () => {
  assert.equal(chooseStartMode({}), 'daemon');
});

test('production fleet router is feature-flagged off by default and constructible when enabled', () => {
  const fleetConfig = { nodes: [] };
  const fleetStore = { snapshot: () => ({ nodes: [] }) };
  assert.equal(createProductionFleetRouter({ env: {}, fleetConfig, fleetStore }), null);
  const router = createProductionFleetRouter({
    env: { PERSISTFLOW_FLEET_ROUTER_ENABLED: '1' },
    fleetConfig,
    fleetStore,
  });
  assert.equal(typeof router.route, 'function');
});

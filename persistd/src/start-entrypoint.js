function chooseStartMode(env = process.env) {
  return Object.prototype.hasOwnProperty.call(env, 'PORT') ? 'web' : 'daemon';
}

function createProductionFleetRouter({ env = process.env, fleetConfig, fleetStore, clock = () => new Date() } = {}) {
  if (String(env.PERSISTFLOW_FLEET_ROUTER_ENABLED || '') !== '1') return null;
  const { FleetRouter } = require('./fleet/router');
  const { TypeSafeFleetRouter } = require('./fleet/typesafe-router');
  const typesafeRouter = new TypeSafeFleetRouter({
    apiKey: env.TYPESAFE_API_KEY,
    endpoint: env.TYPESAFE_ENDPOINT,
    model: env.TYPESAFE_MODEL,
  });
  return new FleetRouter({ fleetConfig, fleetStore, typesafeRouter, clock });
}

function startWeb() {
  const {
    createServer,
    createProductionStore,
    createProductionOAuthStore,
    createProductionFleetStore,
    loadProductionFleetConfig,
    productionFleetNodeSecrets,
  } = require('./persistflow/http-server');
  const port = Number(process.env.PORT || 3000);
  const store = createProductionStore();
  const oauthStore = createProductionOAuthStore();
  const fleetStore = createProductionFleetStore();
  const fleetConfig = loadProductionFleetConfig();
  const fleetNodeSecrets = productionFleetNodeSecrets();
  const fleetRouter = createProductionFleetRouter({ fleetConfig, fleetStore });
  const server = createServer({
    store, oauthStore, fleetStore, fleetConfig, fleetNodeSecrets, fleetRouter,
  });
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    process.stdout.write('persistflow listening on ' + address.port + ' authority=' + store.kind + '\n');
  });
  return server;
}

function start() {
  if (chooseStartMode() === 'web') return startWeb();
  require('./daemon');
  return null;
}

if (require.main === module) start();

module.exports = { chooseStartMode, createProductionFleetRouter, startWeb, start };

function chooseStartMode(env = process.env) {
  return Object.prototype.hasOwnProperty.call(env, 'PORT') ? 'web' : 'daemon';
}

function createProductionRailwayProvider({ env = process.env, provider } = {}) {
  if (String(env.PERSISTFLOW_FLEET_ROUTER_ENABLED || '') !== '1'
    || String(env.PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED || '') !== '1') return null;
  if (provider) return provider;
  const { RailwayAnonymousProvider } = require('./fleet/railway-anonymous');
  return new RailwayAnonymousProvider();
}

function createProductionFleetRouter({ env = process.env, fleetConfig, fleetStore, providerGateway = null, railwayProvider, clock = () => new Date() } = {}) {
  if (String(env.PERSISTFLOW_FLEET_ROUTER_ENABLED || '') !== '1') return null;
  const { FleetRouter } = require('./fleet/router');
  const providerGatewayRouter = providerGateway
    ? new (require('./fleet/provider-gateway-router').ProviderGatewayFleetRouter)({ providerGateway, env })
    : null;
  return new FleetRouter({
    fleetConfig, fleetStore, providerGatewayRouter,
    railwayProvider: railwayProvider || createProductionRailwayProvider({ env }),
    railwayEnabled: String(env.PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED || '') === '1',
    clock,
  });
}

function startWeb({ providerGateway } = {}) {
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
  const ephemeralEnabled = String(process.env.PERSISTFLOW_FLEET_ROUTER_ENABLED || '') === '1'
    && String(process.env.PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED || '') === '1';
  const ephemeralProvider = createProductionRailwayProvider({ env: process.env });
  const fleetRouter = createProductionFleetRouter({ fleetConfig, fleetStore, providerGateway, railwayProvider: ephemeralProvider });
  const server = createServer({
    store, oauthStore, fleetStore, fleetConfig, fleetNodeSecrets, fleetRouter,
    ephemeralProvider, ephemeralEnabled,
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

module.exports = { chooseStartMode, createProductionRailwayProvider, createProductionFleetRouter, startWeb, start };

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

function createProductionFleetRouter({ env = process.env, fleetConfig, fleetStore, railwayProvider, clock = () => new Date() } = {}) {
  if (String(env.PERSISTFLOW_FLEET_ROUTER_ENABLED || '') !== '1') return null;
  const { FleetRouter } = require('./fleet/router');
  const { TypeSafeFleetRouter } = require('./fleet/typesafe-router');
  const typesafeRouter = new TypeSafeFleetRouter({
    apiKey: env.TYPESAFE_API_KEY,
    endpoint: env.TYPESAFE_ENDPOINT,
    model: env.TYPESAFE_MODEL,
  });
  return new FleetRouter({
    fleetConfig, fleetStore, typesafeRouter,
    railwayProvider: railwayProvider || createProductionRailwayProvider({ env }),
    railwayEnabled: String(env.PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED || '') === '1',
    clock,
  });
}

function productionFleetExecutorEnabled(env = process.env) {
  return env.PERSISTFLOW_FLEET_EXECUTOR_ENABLED === '1';
}

function productionDesktopObservationConfiguration(env = process.env) {
  const disabled={enabled:false,nodes:{}};
  if(env.PERSISTFLOW_DESKTOP_OBSERVATION_ENABLED!=='1') return disabled;
  try {
    const nodes=JSON.parse(env.PERSISTFLOW_DESKTOP_OBSERVATION_NODES_JSON||'{}');
    const {OPERATIONS}=require('./fleet/observation');
    if(!nodes || Array.isArray(nodes) || typeof nodes!=='object' || Object.keys(nodes).some(id=>id!=='desktop-primary')) return disabled;
    const node=nodes['desktop-primary'];
    if(!node || node.hostname!=='DESKTOP-L6CITUI' || !Array.isArray(node.operations) || !node.operations.length
      || node.operations.some(op=>!Object.hasOwn(OPERATIONS,op))) return disabled;
    return {enabled:true,nodes};
  } catch { return disabled; }
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
  const fleetExecutorEnabled = productionFleetExecutorEnabled();
  const ephemeralEnabled = String(process.env.PERSISTFLOW_FLEET_ROUTER_ENABLED || '') === '1'
    && String(process.env.PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED || '') === '1';
  const ephemeralProvider = createProductionRailwayProvider({ env: process.env });
  const fleetRouter = createProductionFleetRouter({ fleetConfig, fleetStore, railwayProvider: ephemeralProvider });
  const observation=productionDesktopObservationConfiguration();
  const server = createServer({
    store, oauthStore, fleetStore, fleetConfig, fleetNodeSecrets, fleetRouter, fleetExecutorEnabled,
    desktopObservationEnabled:observation.enabled,
    desktopObservationNodes:observation.nodes,
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

module.exports = { chooseStartMode, createProductionRailwayProvider, createProductionFleetRouter, productionFleetExecutorEnabled, productionDesktopObservationConfiguration, startWeb, start };

function chooseStartMode(env = process.env) {
  return Object.prototype.hasOwnProperty.call(env, 'PORT') ? 'web' : 'daemon';
}

function startWeb() {
  const { createServer, createProductionStore } = require('../../server');
  const port = Number(process.env.PORT || 3000);
  const store = createProductionStore();
  const server = createServer({ store });
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

module.exports = { chooseStartMode, startWeb, start };

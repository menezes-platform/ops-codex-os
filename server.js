const { createServer, createProductionStore } = require('./persistd/src/persistflow/http-server');

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const store = createProductionStore();
  const server = createServer({ store });
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    process.stdout.write('persistflow listening on ' + address.port + ' authority=' + store.kind + '\n');
  });
}

module.exports = { createServer, createProductionStore };

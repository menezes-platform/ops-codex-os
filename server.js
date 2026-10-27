const { createServer, createProductionStore } = require('./persistd/src/persistflow/http-server');

if (require.main === module) {
  // Use the same production bootstrap as the isolated Hostinger app:
  // durable run authority, OAuth, authenticated fleet registry, and opt-in router.
  require('./persistd/src/start-entrypoint').startWeb();
}

module.exports = { createServer, createProductionStore };

function requireMethod(owner, method, name) {
  if (!owner || typeof owner[method] !== 'function') throw new Error(`${name.toUpperCase()}_INTERFACE_REQUIRED`);
}

function createAgentOS({ contextGateway, providerGateway, executionPlaneClient } = {}) {
  requireMethod(contextGateway, 'recall', 'context_gateway');
  requireMethod(providerGateway, 'infer', 'provider_gateway');
  requireMethod(executionPlaneClient, 'submitTask', 'execution_plane_client');

  return Object.freeze({
    recall(request) {
      return contextGateway.recall(request);
    },
    infer(request) {
      return providerGateway.infer(request);
    },
    submitTask(request) {
      return executionPlaneClient.submitTask(request);
    },
  });
}

module.exports = { createAgentOS };

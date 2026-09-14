const REGISTRY = Object.freeze({
  rdc: { id: 'rdc', pluginSearchName: 'Remote Desktop Commander', displayNames: ['Remote Desktop Commander', 'Desktop Commander'], capabilities: ['filesystem', 'terminal', 'process', 'readonly_probe'], attachable: true },
  sentinelx: { id: 'sentinelx', pluginSearchName: 'SentinelX', displayNames: ['SentinelX'], capabilities: ['filesystem', 'terminal', 'process', 'readonly_probe'], attachable: true },
  menezes_remote: { id: 'menezes_remote', pluginSearchName: 'Menezes Remote', displayNames: ['Menezes Remote'], capabilities: ['filesystem', 'terminal', 'process', 'readonly_probe'], attachable: false },
});

function parseMachineProviderIds(raw) {
  const ids = String(raw || 'rdc').split(',').map((v) => v.trim()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : ['rdc'];
}

function resolveMachineProviders(ids) {
  return ids.map((id) => {
    if (!REGISTRY[id]) throw new Error(`UNKNOWN_MACHINE_PROVIDER:${id}`);
    return REGISTRY[id];
  });
}

module.exports = { REGISTRY, parseMachineProviderIds, resolveMachineProviders };

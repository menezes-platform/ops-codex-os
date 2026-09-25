function generationOf(value) {
  const generation = Number(value);
  return Number.isInteger(generation) && generation > 0 ? generation : null;
}

function reconcileRemoteRun(localState = {}, remoteRun = {}) {
  const localGeneration = generationOf(localState.GENERATION);
  const remoteGeneration = generationOf(remoteRun.generation);
  if (!localGeneration || !remoteGeneration) throw new Error('REMOTE_GENERATION_INVALID');

  const base = {
    ...localState,
    REMOTE_RUN_ID: remoteRun.runId || localState.REMOTE_RUN_ID || localState.RUN_ID || 'NONE',
    REMOTE_GENERATION: String(remoteGeneration),
    REMOTE_UPDATED_AT: remoteRun.updatedAt || localState.REMOTE_UPDATED_AT || 'NONE',
  };

  if (remoteGeneration > localGeneration) return { relation: 'AHEAD', state: base };
  if (remoteGeneration < localGeneration) return { relation: 'BEHIND', state: base };

  const checkpointNext = remoteRun.latestCheckpoint?.nextSafeAction;
  return {
    relation: 'EQUAL',
    state: {
      ...base,
      CONTROLLER_HEARTBEAT_AT: remoteRun.controllerHeartbeatAt || base.CONTROLLER_HEARTBEAT_AT,
      CURRENT_STATE: remoteRun.progress ?? base.CURRENT_STATE,
      NEXT_SAFE_ACTION: remoteRun.nextSafeAction ?? checkpointNext ?? base.NEXT_SAFE_ACTION,
      LATEST_ROUTE_JSON: remoteRun.latestRoute
        ? JSON.stringify(remoteRun.latestRoute)
        : base.LATEST_ROUTE_JSON,
    },
  };
}

module.exports = { reconcileRemoteRun, generationOf };

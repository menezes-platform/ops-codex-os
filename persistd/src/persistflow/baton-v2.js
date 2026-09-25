const { resolveToolProfile } = require('./capabilities');

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function buildBatonV2(state, nextGeneration) {
  const manifest = parseJson(state.CAPABILITY_MANIFEST_JSON, {});
  const needs = parseJson(state.TOOL_NEEDS_JSON, []);
  const latestRoute = parseJson(state.LATEST_ROUTE_JSON, null);
  return {
    version: 2,
    authority: {
      runId: state.RUN_ID || null,
      generation: Number(nextGeneration),
      claimNonce: state.CLAIM_NONCE || null,
    },
    objective: state.OBJECTIVE || state.TASK_ID || null,
    dodRef: state.DOD_REF || null,
    state: {
      current: state.CURRENT_STATE || null,
      nextSafeAction: state.NEXT_SAFE_ACTION || null,
      ambiguousOperations: parseJson(state.AMBIGUOUS_OPERATIONS_JSON, []),
      cleanupDebt: parseJson(state.CLEANUP_DEBT_JSON, []),
    },
    project: {
      root: state.PROJECT_ROOT || null,
      branch: state.BRANCH || null,
      head: state.HEAD || null,
    },
    machine: {
      deviceId: state.DEVICE_ID || null,
      nodeId: latestRoute?.nodeId || null,
    },
    autonomy: { preset: state.AUTONOMY_PRESET || null },
    tools: resolveToolProfile(manifest, needs),
  };
}

module.exports = { buildBatonV2 };

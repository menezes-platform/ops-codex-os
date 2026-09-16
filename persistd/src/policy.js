const HARD_HUMAN_GATES = [
  'productionRelease',
  'financialCommitment',
  'credentialsOrIam',
  'irreversibleDataLoss',
  'publicSecurityBoundary',
  'destructiveSharedHistory',
  'materialScopeExpansion',
  'presetElevation',
];

function evaluatePolicy(action = {}) {
  if (action.automaticSpend === true) {
    return { decision: 'DENY', reason: 'no_incremental_spend' };
  }
  const gate = HARD_HUMAN_GATES.find((key) => action[key] === true);
  if (gate) return { decision: 'HUMAN', reason: `hard_gate:${gate}` };
  return { decision: 'ALLOW', reason: 'within_autonomy_envelope' };
}

function decideAction({ reversible, lowRisk, scopePreserving, logicallyDetermined }) {
  const auto = reversible === true && lowRisk === true && scopePreserving === true && logicallyDetermined === true;
  return auto
    ? { decision: 'AUTO_EXECUTE', reason: 'reversible_low_risk_logical' }
    : { decision: 'REQUIRE_USER', reason: 'risk_scope_or_ambiguity' };
}

module.exports = { evaluatePolicy, decideAction, HARD_HUMAN_GATES };

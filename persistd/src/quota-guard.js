const LEVELS = ['NORMAL', 'CONSERVE', 'PRESSURE', 'ROLLOVER', 'EMERGENCY'];

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function atLeast(current, next) {
  return LEVELS.indexOf(next) > LEVELS.indexOf(current) ? next : current;
}

function evaluateQuotaPressure(input = {}) {
  const quotaUsedPercent = numberOrNull(input.quotaUsedPercent);
  const contextTokens = numberOrNull(input.contextTokens);
  const contextWindow = numberOrNull(input.contextWindow);
  const previousQuotaUsedPercent = numberOrNull(input.previousQuotaUsedPercent);
  const sampleMinutes = numberOrNull(input.sampleMinutes);
  const contextUsedPercent = contextTokens !== null && contextWindow > 0
    ? (contextTokens / contextWindow) * 100
    : null;
  const burnRatePpPerMinute = quotaUsedPercent !== null
    && previousQuotaUsedPercent !== null
    && sampleMinutes > 0
    ? Math.max(0, (quotaUsedPercent - previousQuotaUsedPercent) / sampleMinutes)
    : null;

  let level = 'NORMAL';
  const reasons = [];
  const raise = (target, reason) => {
    const next = atLeast(level, target);
    if (next !== level || !reasons.includes(reason)) reasons.push(reason);
    level = next;
  };

  if (quotaUsedPercent !== null) {
    if (quotaUsedPercent >= 85) raise('EMERGENCY', 'quota>=85');
    else if (quotaUsedPercent >= 75) raise('ROLLOVER', 'quota>=75');
    else if (quotaUsedPercent >= 65) raise('PRESSURE', 'quota>=65');
    else if (quotaUsedPercent >= 50) raise('CONSERVE', 'quota>=50');
  }

  if (contextUsedPercent !== null) {
    if (contextUsedPercent >= 85) raise('EMERGENCY', 'context>=85');
    else if (contextUsedPercent >= 72) raise('ROLLOVER', 'context>=72');
    else if (contextUsedPercent >= 60) raise('PRESSURE', 'context>=60');
    else if (contextUsedPercent >= 45) raise('CONSERVE', 'context>=45');
  }

  if (burnRatePpPerMinute !== null && quotaUsedPercent !== null) {
    if (burnRatePpPerMinute >= 4 && quotaUsedPercent >= 35) {
      raise('EMERGENCY', 'burn>=4pp/min');
    } else if (burnRatePpPerMinute >= 2 && quotaUsedPercent >= 40) {
      raise('ROLLOVER', 'burn>=2pp/min');
    } else if (burnRatePpPerMinute >= 1 && quotaUsedPercent >= 50) {
      raise('PRESSURE', 'burn>=1pp/min');
    }
  }

  const profiles = {
    NORMAL: { maxNewHeavyAgents: null, rootMode: 'NORMAL', shouldSetContextRisk: false },
    CONSERVE: { maxNewHeavyAgents: 2, rootMode: 'TARGETED', shouldSetContextRisk: false },
    PRESSURE: { maxNewHeavyAgents: 1, rootMode: 'INTEGRATION_FIRST', shouldSetContextRisk: false },
    ROLLOVER: { maxNewHeavyAgents: 0, rootMode: 'CHECKPOINT_ONLY', shouldSetContextRisk: true },
    EMERGENCY: { maxNewHeavyAgents: 0, rootMode: 'CHECKPOINT_ONLY', shouldSetContextRisk: true },
  };
  const profile = profiles[level];

  return {
    level,
    quotaUsedPercent,
    contextUsedPercent,
    burnRatePpPerMinute,
    maxNewHeavyAgents: profile.maxNewHeavyAgents,
    rootMode: profile.rootMode,
    shouldSetContextRisk: profile.shouldSetContextRisk,
    preserveQualityGates: true,
    actions: {
      targetedReadsOnly: level !== 'NORMAL',
      summarizeWorkerReturns: level !== 'NORMAL',
      blockModelPolling: ['PRESSURE', 'ROLLOVER', 'EMERGENCY'].includes(level),
      reuseDurableEvidence: level !== 'NORMAL',
      checkpointDurableState: ['ROLLOVER', 'EMERGENCY'].includes(level),
      prepareSuccessor: ['ROLLOVER', 'EMERGENCY'].includes(level),
      stopNewHeavyModelWork: level === 'EMERGENCY',
    },
    reasons,
  };
}

function applyQuotaGuardToState(state = {}, now = new Date()) {
  const telemetryPresent = [
    state.MODEL_QUOTA_USED_PERCENT,
    state.MODEL_CONTEXT_TOKENS,
    state.MODEL_CONTEXT_WINDOW,
  ].some((value) => value !== undefined && value !== null && value !== '' && value !== 'NONE');

  if (!telemetryPresent) return { state, changed: false, evaluation: null };

  const evaluation = evaluateQuotaPressure({
    quotaUsedPercent: state.MODEL_QUOTA_USED_PERCENT,
    previousQuotaUsedPercent: state.MODEL_QUOTA_PREVIOUS_USED_PERCENT,
    sampleMinutes: state.MODEL_QUOTA_SAMPLE_MINUTES,
    contextTokens: state.MODEL_CONTEXT_TOKENS,
    contextWindow: state.MODEL_CONTEXT_WINDOW,
  });

  let next = {
    ...state,
    QUOTA_GUARD_LEVEL: evaluation.level,
    QUOTA_GUARD_EVALUATED_AT: now.toISOString(),
    QUOTA_GUARD_REASON: evaluation.reasons.join('|') || 'within_budget',
    QUOTA_GUARD_MAX_NEW_HEAVY_AGENTS: evaluation.maxNewHeavyAgents === null
      ? 'UNBOUNDED'
      : String(evaluation.maxNewHeavyAgents),
    QUOTA_GUARD_ROOT_MODE: evaluation.rootMode,
    QUOTA_GUARD_PRESERVE_QUALITY_GATES: 'true',
  };

  const protectedStatuses = new Set([
    'DONE', 'BLOCKED', 'AUTH_REQUIRED', 'WAITING_TOOL', 'WAITING_BROWSER',
    'PREPARING_TAKEOVER', 'ROLLOVER_INCOMPLETE', 'RECOVERY_REQUIRED',
  ]);
  if (evaluation.shouldSetContextRisk
      && !protectedStatuses.has(state.STATUS)
      && state.STATUS !== 'CONTEXT_RISK') {
    next = {
      ...next,
      STATUS: 'CONTEXT_RISK',
      CONTEXT_RISK_REASON: `quota_guard:${evaluation.level.toLowerCase()}`,
      CONTEXT_RISK_AT: now.toISOString(),
    };
  }

  const changed = Object.keys(next).some((key) => String(next[key]) !== String(state[key] ?? ''));
  return { state: next, changed, evaluation };
}

module.exports = { LEVELS, evaluateQuotaPressure, applyQuotaGuardToState };

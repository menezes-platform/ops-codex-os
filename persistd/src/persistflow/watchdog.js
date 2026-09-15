function parseHeartbeat(state = {}) {
  const raw = state.CONTROLLER_HEARTBEAT_AT;
  if (!raw || raw === 'NONE') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function evaluateWatchdog(state = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const heartbeat = parseHeartbeat(state);
  if (heartbeat == null) return { status: state.STATUS || 'ACTIVE', reason: 'no_heartbeat', shouldCreateSuccessor: false };
  if (options.busy === true) return { status: 'ACTIVE', reason: 'activity_observed', shouldCreateSuccessor: false };
  if (options.browserHealthy === false) return { status: 'WAITING_BROWSER', reason: 'browser_unhealthy', shouldCreateSuccessor: false };

  const stallMs = Number.isFinite(options.stallMs) ? options.stallMs : 2 * 60_000;
  const recoveryMs = Number.isFinite(options.recoveryMs) ? options.recoveryMs : 4 * 60_000;
  const ageMs = Math.max(0, now.getTime() - heartbeat);
  if (ageMs >= recoveryMs) return { status: 'RECOVERY_REQUIRED', reason: 'heartbeat_expired', ageMs, shouldCreateSuccessor: true };
  if (ageMs >= stallMs) return { status: 'SUSPECTED_STALL', reason: 'heartbeat_stale', ageMs, shouldCreateSuccessor: false };
  return { status: 'ACTIVE', reason: 'heartbeat_fresh', ageMs, shouldCreateSuccessor: false };
}

module.exports = { evaluateWatchdog, parseHeartbeat };

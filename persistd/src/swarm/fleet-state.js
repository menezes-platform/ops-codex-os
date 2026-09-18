'use strict';

const LANE_STATES = Object.freeze({
  WORKING: 'WORKING',
  IDLE: 'IDLE',
  STALE: 'STALE',
  BLOCKED: 'BLOCKED',
  OFFLINE: 'OFFLINE',
  DONE: 'DONE',
  ERROR: 'ERROR',
});

const DEFAULT_CONFIG = Object.freeze({
  heartbeatStallMs: 120_000,
  stallTtlMs: 60_000,
  leaseTtlMs: 300_000,
  redispatchWindowMs: 300_000,
  retryBackoffMs: 30_000,
  historyLimit: 100,
  reusable: true,
});

function asNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_NOW');
  return date.getTime();
}

function parseTs(value) {
  if (value === null || value === undefined) return null;
  if (value === '' || value === 'NONE' || value === '0') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function asNumber(value, name) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`INVALID_${name}`);
  return ms;
}

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    heartbeatStallMs: asNumber(config.heartbeatStallMs ?? DEFAULT_CONFIG.heartbeatStallMs, 'HEARTBEAT_STALL_MS'),
    stallTtlMs: asNumber(config.stallTtlMs ?? DEFAULT_CONFIG.stallTtlMs, 'STALL_TTL_MS'),
    leaseTtlMs: asNumber(config.leaseTtlMs ?? DEFAULT_CONFIG.leaseTtlMs, 'LEASE_TTL_MS'),
    redispatchWindowMs: asNumber(config.redispatchWindowMs ?? DEFAULT_CONFIG.redispatchWindowMs, 'REDISPATCH_WINDOW_MS'),
    retryBackoffMs: asNumber(config.retryBackoffMs ?? DEFAULT_CONFIG.retryBackoffMs, 'RETRY_BACKOFF_MS'),
    historyLimit: asNumber(config.historyLimit ?? DEFAULT_CONFIG.historyLimit, 'HISTORY_LIMIT'),
    reusable: config.reusable !== undefined ? Boolean(config.reusable) : DEFAULT_CONFIG.reusable,
  };
}

function createLane(input = {}) {
  const laneId = String(input.laneId ?? '').trim();
  if (!laneId) throw new Error('LANE_ID_REQUIRED');
  return {
    laneId,
    status: LANE_STATES[input.status] || 'IDLE',
    pid: input.pid ?? null,
    leaseOwner: input.leaseOwner ?? null,
    leaseExpiresAt: input.leaseExpiresAt ?? null,
    lastHeartbeatAt: input.lastHeartbeatAt ?? null,
    lastProgressAt: input.lastProgressAt ?? null,
    progressEvidence: input.progressEvidence ?? null,
    blockedGateOpen: Boolean(input.blockedGateOpen ?? false),
    gateReleasedBy: input.gateReleasedBy ?? null,
    doneAt: input.doneAt ?? null,
    errorAt: input.errorAt ?? null,
    lastError: input.lastError ?? null,
    attempts: Number(input.attempts ?? 0),
    dispatches: Number(input.dispatches ?? 0),
    lastTransitionAt: input.lastTransitionAt ?? null,
    generative: Boolean(input.generative ?? false),
    completed: Boolean(input.completed ?? false),
    disposable: Boolean(input.disposable ?? false),
    history: Array.isArray(input.history) ? [...input.history] : [],
  };
}

function withHistory(lane, entry, limit) {
  if (!entry) return lane;
  const next = [...lane.history, entry];
  if (next.length > limit) next.splice(0, next.length - limit);
  return { ...lane, history: next };
}

function transitioned(lane, status, reason, nowMs, limit) {
  if (lane.status === status) return lane;
  return withHistory({
    ...lane,
    status,
    lastTransitionAt: new Date(nowMs).toISOString(),
  }, {
    at: new Date(nowMs).toISOString(),
    from: lane.status,
    to: status,
    reason,
  }, limit);
}

function clearLease(lane) {
  return { ...lane, leaseOwner: null, leaseExpiresAt: null };
}

function leaseRevoked(lane, nowMs) {
  const expiry = parseTs(lane.leaseExpiresAt);
  return Boolean(lane.leaseOwner) && (expiry === null || expiry <= nowMs);
}

function leaseHeldBy(lane, owner) {
  return Boolean(owner) && lane.leaseOwner === owner;
}

function isTimestampFresh(tsMs, nowMs, ttlMs) {
  return tsMs !== null && nowMs - tsMs < ttlMs;
}

function summarize(lane, extra = {}) {
  return {
    alive: extra.alive,
    heartbeatFresh: extra.heartbeatFresh,
    progressFresh: extra.progressFresh,
    leaseOwner: lane.leaseOwner,
    leaseRevoked: leaseRevoked(lane, extra.nowMs),
    leaseExpired: leaseRevoked(lane, extra.nowMs),
    clockSkewMs: extra.clockSkewMs,
    redispatchEligible: extra.redispatchEligible ?? false,
    retryEligible: extra.retryEligible ?? false,
    dispatches: Number(lane.dispatches || 0),
    attempts: Number(lane.attempts || 0),
  };
}

function tickLane(lane, observation = {}, config = {}, pnow = new Date()) {
  const current = lane && lane.laneId ? lane : createLane(lane);
  const nowMs = asNow(pnow);
  const cfg = mergeConfig(config);

  const heartbeatMs = parseTs(observation.heartbeatAt ?? current.lastHeartbeatAt);
  const progressMs = parseTs(observation.progressAt ?? current.lastProgressAt);
  const evidence = observation.progressEvidence ?? current.progressEvidence;
  const alive = observation.processAlive !== undefined
    ? Boolean(observation.processAlive)
    : (Boolean(current.pid) && current.pid !== 'NONE');

  const heartbeatFresh = isTimestampFresh(heartbeatMs, nowMs, cfg.heartbeatStallMs);
  const progressFresh = isTimestampFresh(progressMs, nowMs, cfg.stallTtlMs);
  const clockSkewMs = Math.max(
    heartbeatMs === null ? 0 : Math.max(0, heartbeatMs - nowMs),
    progressMs === null ? 0 : Math.max(0, progressMs - nowMs),
  );

  const base = {
    ...current,
    pid: observation.pid ?? current.pid,
    lastHeartbeatAt: heartbeatMs === null ? current.lastHeartbeatAt : new Date(heartbeatMs).toISOString(),
    lastProgressAt: progressMs === null ? current.lastProgressAt : new Date(progressMs).toISOString(),
    progressEvidence: evidence,
  };

  const common = {
    alive,
    heartbeatFresh,
    progressFresh,
    nowMs,
    clockSkewMs,
  };

  if (current.status === 'BLOCKED') {
    if (!current.blockedGateOpen) {
      return { ...summarize(base, common), laneId: laneIdOf(current), status: 'BLOCKED', action: 'ESCALATE_REQUIRED', reason: 'human_gate_blocked', lane: base };
    }
    const released = withHistory({
      ...clearLease(base),
      status: 'IDLE',
      gateReleasedBy: current.gateReleasedBy,
      lastTransitionAt: new Date(nowMs).toISOString(),
    }, { at: new Date(nowMs).toISOString(), from: 'BLOCKED', to: 'IDLE', reason: 'human_gate_released', by: current.gateReleasedBy }, cfg.historyLimit);
    return { ...summarize(released, common), laneId: laneIdOf(current), status: 'IDLE', action: 'RELEASE_GATE_CLEAR', reason: 'human_gate_released', lane: released };
  }

  if (current.status === 'DONE') {
    const doneMs = parseTs(current.doneAt);
    const age = doneMs === null ? Number.POSITIVE_INFINITY : nowMs - doneMs;
    const redispatchEligible = cfg.reusable && !current.completed && age >= cfg.redispatchWindowMs;
    if (redispatchEligible) {
      const requeued = clearLease({
        ...base,
        status: 'IDLE',
        doneAt: null,
        errorAt: null,
        lastError: null,
        attempts: 0,
        lastTransitionAt: new Date(nowMs).toISOString(),
      });
      const lane = withHistory(requeued, { at: new Date(nowMs).toISOString(), from: 'DONE', to: 'IDLE', reason: 'redispatch_eligible' }, cfg.historyLimit);
      return { ...summarize(lane, { ...common, redispatchEligible: true }), laneId: laneIdOf(current), status: 'IDLE', action: 'REDISPATCH', reason: 'redispatch_eligible', lane };
    }
    return {
      ...summarize(base, { ...common, redispatchEligible: false }),
      laneId: laneIdOf(current),
      status: 'DONE',
      action: 'TERMINAL_DONE',
      reason: 'done',
      lane: base,
    };
  }

  if (current.status === 'ERROR') {
    const errorMs = parseTs(current.errorAt);
    const age = errorMs === null ? Number.POSITIVE_INFINITY : nowMs - errorMs;
    const retryEligible = age >= cfg.retryBackoffMs;
    if (retryEligible) {
      const retryable = {
        ...base,
        status: 'IDLE',
        errorAt: null,
        lastError: null,
        lastTransitionAt: new Date(nowMs).toISOString(),
      };
      const lane = withHistory(retryable, { at: new Date(nowMs).toISOString(), from: 'ERROR', to: 'IDLE', reason: 'retry_backoff_elapsed' }, cfg.historyLimit);
      return { ...summarize(lane, { ...common, retryEligible: true }), laneId: laneIdOf(current), status: 'IDLE', action: 'RETRY_ELIGIBLE', reason: 'retry_backoff_elapsed', lane };
    }
    return {
      ...summarize(base, { ...common, retryEligible: false }),
      laneId: laneIdOf(current),
      status: 'ERROR',
      action: 'TERMINAL_ERROR',
      reason: 'waiting_retry_backoff',
      lane: base,
    };
  }

  const leaseExpired = leaseRevoked(base, nowMs);
  const activeLease = Boolean(base.leaseOwner) && !leaseExpired;

  if (!alive) {
    const lane = transitioned(base, 'OFFLINE', 'process_gone', nowMs, cfg.historyLimit);
    return { ...summarize(lane, common), laneId: laneIdOf(current), status: 'OFFLINE', action: 'OFFLINE', reason: 'process_gone', lane };
  }

  if (progressFresh) {
    const reason = leaseExpired ? 'lease_revoked_evidence_fresh' : 'fresh_evidence';
    const lane = transitioned(base, 'WORKING', reason, nowMs, cfg.historyLimit);
    return {
      ...summarize(lane, common),
      laneId: laneIdOf(current),
      status: 'WORKING',
      action: leaseExpired ? 'LEASE' : 'ACTIVE',
      reason,
      lane,
    };
  }

  if (!heartbeatFresh) {
    const lane = transitioned(base, 'STALE', leaseExpired ? 'heartbeat_stale_lease_expired' : 'heartbeat_stale', nowMs, cfg.historyLimit);
    return { ...summarize(lane, common), laneId: laneIdOf(current), status: 'STALE', action: 'STALLED', reason: 'heartbeat_stale', lane };
  }

  if (activeLease) {
    const lane = transitioned(base, 'STALE', leaseExpired ? 'progress_stalled_lease_expired' : 'progress_stalled', nowMs, cfg.historyLimit);
    return { ...summarize(lane, common), laneId: laneIdOf(current), status: 'STALE', action: 'STALLED', reason: 'progress_stalled', lane };
  }

  const idle = transitioned(base, 'IDLE', leaseExpired ? 'lease_expired_idle' : 'idle', nowMs, cfg.historyLimit);
  const idleLane = clearLease(idle);
  return {
    ...summarize(idleLane, common),
    laneId: laneIdOf(current),
    status: 'IDLE',
    action: leaseExpired || !current.leaseOwner ? 'DISPATCH_CANDIDATE' : 'IDLE',
    reason: 'idle',
    lane: idleLane,
  };
}

function laneIdOf(lane) {
  return lane.laneId;
}

function tickFleet(lanes, observations = {}, config = {}, now = new Date()) {
  const entries = Array.isArray(lanes) ? lanes : Object.values(lanes);
  const results = entries.map((lane) => tickLane(lane, observations[lane.laneId] ?? observations, config, now));
  const summary = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    if (result.action === 'STALLED') acc.stalled.push(result.laneId);
    if (result.action === 'OFFLINE') acc.offline.push(result.laneId);
    if (result.action === 'REDISPATCH') acc.redispatchEligible.push(result.laneId);
    if (result.action === 'RETRY_ELIGIBLE') acc.retryEligible.push(result.laneId);
    if (result.action === 'ESCALATE_REQUIRED') acc.blocked.push(result.laneId);
    if (result.action === 'DISPATCH_CANDIDATE') acc.dispatchCandidates.push(result.laneId);
    return acc;
  }, {
    stalled: [], offline: [], redispatchEligible: [], retryEligible: [], blocked: [], dispatchCandidates: [],
  });
  return { results, summary };
}

function activateLane(lane, options = {}) {
  const { now = new Date(), leaseOwner = null, leaseTtlMs = DEFAULT_CONFIG.leaseTtlMs, dispatchAt = now } = options;
  if (!leaseOwner) throw new Error('LEASE_OWNER_REQUIRED');
  const nowMs = asNow(now);
  const dispatchMs = asNow(dispatchAt);
  const ttl = asNumber(leaseTtlMs, 'LEASE_TTL_MS');
  const current = lane && lane.laneId ? lane : createLane(lane);
  return {
    ...current,
    status: 'WORKING',
    leaseOwner,
    leaseExpiresAt: new Date(nowMs + ttl).toISOString(),
    lastHeartbeatAt: new Date(nowMs).toISOString(),
    lastProgressAt: new Date(dispatchMs).toISOString(),
    progressEvidence: current.progressEvidence || 'dispatched',
    dispatches: Number(current.dispatches || 0) + 1,
    attempts: 0,
    lastTransitionAt: new Date(nowMs).toISOString(),
  };
}

function markDone(lane, { now = new Date(), evidence = null, completed = false, disposable = false } = {}) {
  const nowMs = asNow(now);
  const current = lane && lane.laneId ? lane : createLane(lane);
  const updated = clearLease({
    ...current,
    status: 'DONE',
    lastProgressAt: new Date(nowMs).toISOString(),
    progressEvidence: evidence ?? current.progressEvidence ?? 'done',
    doneAt: new Date(nowMs).toISOString(),
    errorAt: null,
    lastError: null,
    completed: Boolean(completed),
    disposable: Boolean(disposable),
    lastTransitionAt: new Date(nowMs).toISOString(),
  });
  return withHistory(updated, { at: new Date(nowMs).toISOString(), from: current.status, to: 'DONE', reason: 'mark_done' }, DEFAULT_CONFIG.historyLimit);
}

function markError(lane, { now = new Date(), error = null, humanHalt = false } = {}) {
  const nowMs = asNow(now);
  const current = lane && lane.laneId ? lane : createLane(lane);
  const nextStatus = humanHalt ? 'BLOCKED' : 'ERROR';
  const updated = clearLease({
    ...current,
    status: nextStatus,
    lastError: error ?? current.lastError ?? 'error',
    errorAt: new Date(nowMs).toISOString(),
    doneAt: null,
    attempts: Number(current.attempts || 0) + 1,
    blockedGateOpen: false,
    gateReleasedBy: null,
    lastTransitionAt: new Date(nowMs).toISOString(),
  });
  return withHistory(updated, { at: new Date(nowMs).toISOString(), from: current.status, to: nextStatus, reason: humanHalt ? 'human_halt' : 'mark_error' }, DEFAULT_CONFIG.historyLimit);
}

function humanRelease(lane, { now = new Date(), by = 'human-1' } = {}) {
  const nowMs = asNow(now);
  const current = lane && lane.laneId ? lane : createLane(lane);
  const released = {
    ...clearLease(current),
    status: 'IDLE',
    blockedGateOpen: true,
    gateReleasedBy: by,
    doneAt: null,
    lastTransitionAt: new Date(nowMs).toISOString(),
  };
  return withHistory(released, { at: new Date(nowMs).toISOString(), from: current.status, to: 'IDLE', reason: 'human_release', by }, DEFAULT_CONFIG.historyLimit);
}

module.exports = {
  LANE_STATES,
  DEFAULT_CONFIG,
  createLane,
  tickLane,
  tickFleet,
  activateLane,
  markDone,
  markError,
  humanRelease,
  leaseHeldBy,
  leaseRevoked,
  isTimestampFresh,
};
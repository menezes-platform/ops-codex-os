const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('./src/swarm/fleet-state');

const T0 = new Date('2026-09-18T12:00:00.000Z');
const iso = (ms) => new Date(T0.getTime() + ms).toISOString();
const now = (ageMs) => new Date(T0.getTime() + ageMs);

const CFG = {
  heartbeatStallMs: 60_000,
  stallTtlMs: 30_000,
  leaseTtlMs: 60_000,
  redispatchWindowMs: 120_000,
  retryBackoffMs: 60_000,
};

function baseLane(overrides = {}) {
  return createLane({ laneId: 'lane-a', ...overrides });
}

test('LANE_STATES covers every required lane state', () => {
  for (const state of ['WORKING', 'IDLE', 'STALE', 'BLOCKED', 'OFFLINE', 'DONE', 'ERROR']) {
    assert.equal(LANE_STATES[state], state);
  }
  assert.equal(Object.keys(LANE_STATES).length, 7);
});

test('createLane requires a lane id and defaults to IDLE', () => {
  assert.throws(() => createLane(), /LANE_ID_REQUIRED/);
  assert.throws(() => createLane({ laneId: '   ' }), /LANE_ID_REQUIRED/);
  const lane = createLane({ laneId: 'alpha' });
  assert.equal(lane.status, 'IDLE');
  assert.equal(lane.dispatches, 0);
  assert.equal(lane.attempts, 0);
  assert.equal(lane.blockedGateOpen, false);
});

test('fresh evidence keeps a lane WORKING even with an unowned lease', () => {
  const lane = baseLane({
    pid: 4242,
    status: 'WORKING',
    lastHeartbeatAt: iso(-5_000),
    lastProgressAt: iso(0),
    progressEvidence: 'commit-e7f9',
  });
  const r = tickLane(lane, {
    processAlive: true,
    heartbeatAt: iso(-1_000),
    progressAt: iso(0),
  }, CFG, now(0));
  assert.equal(r.status, 'WORKING');
  assert.equal(r.action, 'ACTIVE');
  assert.equal(r.reason, 'fresh_evidence');
  assert.equal(r.alive, true);
  assert.equal(r.progressFresh, true);
  assert.equal(r.lane.progressEvidence, 'commit-e7f9');
});

test('process presence alone NEVER counts as WORKING', () => {
  const leased = baseLane({
    status: 'IDLE',
    pid: 8123,
    leaseOwner: 'sup-1',
    leaseExpiresAt: iso(60_000),
    lastHeartbeatAt: iso(-1_000),
  });
  const r = tickLane(leased, {
    processAlive: true,
    heartbeatAt: iso(0),
    progressAt: iso(-999_000),
  }, CFG, now(0));
  assert.equal(r.status, 'STALE');
  assert.notEqual(r.status, 'WORKING');
  assert.equal(r.reason, 'progress_stalled');
  assert.equal(r.progressFresh, false);

  const unleased = baseLane({
    status: 'IDLE',
    pid: 8124,
    lastHeartbeatAt: iso(-1_000),
  });
  const candidate = tickLane(unleased, { processAlive: true, heartbeatAt: iso(0) }, CFG, now(0));
  assert.equal(candidate.status, 'IDLE');
  assert.equal(candidate.action, 'DISPATCH_CANDIDATE');
  assert.equal(candidate.lane.leaseOwner, null);
});

test('a fast heartbeat with unchanged stale progress stalls to STALE', () => {
  const lane = baseLane({
    status: 'WORKING',
    leaseOwner: 'sup-v1',
    leaseExpiresAt: iso(60_000),
    lastHeartbeatAt: iso(-1_000),
    lastProgressAt: iso(-35_000),
    progressEvidence: 'old-evidence',
  });
  const r = tickLane(lane, {
    processAlive: true,
    heartbeatAt: iso(-1_000),
    progressAt: iso(-35_000),
  }, CFG, now(0));
  assert.equal(r.status, 'STALE');
  assert.equal(r.action, 'STALLED');
  assert.equal(r.reason, 'progress_stalled');
  assert.equal(r.progressFresh, false);
});

test('stale heartbeats transition WORKING to STALE and survive repeated ticks', () => {
  const lane = baseLane({
    status: 'WORKING',
    lastHeartbeatAt: iso(-90_000),
    lastProgressAt: iso(-90_000),
    progressEvidence: 'evidence-1',
  });
  const first = tickLane(lane, { processAlive: true }, CFG, now(0));
  assert.equal(first.status, 'STALE');
  assert.equal(first.reason, 'heartbeat_stale');
  assert.equal(first.lane.status, 'STALE');

  const second = tickLane(first.lane, { processAlive: true }, CFG, now(5_000));
  assert.equal(second.status, 'STALE');
  assert.equal(second.action, 'STALLED');
  assert.equal(second.lane.lastTransitionAt, first.lane.lastTransitionAt);
});

test('a live process with a fresh heartbeat and no progress is IDLE, never WORKING', () => {
  const lane = baseLane({
    status: 'WORKING',
    lastHeartbeatAt: iso(-1_000),
    lastProgressAt: iso(0),
    progressEvidence: 'fresh',
  });
  const r = tickLane(lane, {
    processAlive: true,
    heartbeatAt: iso(0),
    progressAt: iso(-60_000),
  }, CFG, now(0));
  assert.equal(r.status, 'IDLE');
  assert.equal(r.action, 'DISPATCH_CANDIDATE');
  assert.equal(r.lane.leaseOwner, null);
});

test('a dead WORKING worker goes OFFLINE', () => {
  const lane = baseLane({
    status: 'WORKING',
    pid: 999,
    leaseOwner: 'sup-1',
    leaseExpiresAt: iso(60_000),
    lastHeartbeatAt: iso(-1_000),
    lastProgressAt: iso(-1_000),
  });
  const r = tickLane(lane, { processAlive: false }, CFG, now(0));
  assert.equal(r.status, 'OFFLINE');
  assert.equal(r.action, 'OFFLINE');
  assert.equal(r.reason, 'process_gone');
  assert.equal(r.alive, false);
  assert.equal(r.leaseRevoked, false);
});

test('an unobserved or pidless lane is treated as OFFLINE', () => {
  const lane = baseLane({ status: 'IDLE', pid: null });
  const r = tickLane(lane, {}, CFG, now(0));
  assert.equal(r.status, 'OFFLINE');
  assert.equal(r.action, 'OFFLINE');
});

test('WORKING -> STALE -> OFFLINE on process death', () => {
  const stale = tickLane(baseLane({
    status: 'WORKING',
    lastHeartbeatAt: iso(-90_000),
    lastProgressAt: iso(-90_000),
  }), { processAlive: true }, CFG, now(0));
  assert.equal(stale.status, 'STALE');
  const offline = tickLane(stale.lane, { processAlive: false }, CFG, now(5_000));
  assert.equal(offline.status, 'OFFLINE');
});

test('expired leases held by another owner remain WORKING only with fresh evidence', () => {
  const lane = baseLane({
    status: 'WORKING',
    leaseOwner: 'sup-2',
    leaseExpiresAt: iso(-5_000),
    lastHeartbeatAt: iso(0),
    lastProgressAt: iso(0),
    progressEvidence: 'fresh-work',
  });
  const r = tickLane(lane, {
    processAlive: true,
    heartbeatAt: iso(0),
    progressAt: iso(0),
  }, CFG, now(0));
  assert.equal(r.leaseRevoked, true);
  assert.equal(r.leaseExpired, true);
  assert.equal(r.status, 'WORKING');
  assert.equal(r.action, 'LEASE');
  assert.equal(r.reason, 'lease_revoked_evidence_fresh');
});

test('expired leases with stale evidence become STALLED', () => {
  const lane = baseLane({
    status: 'WORKING',
    leaseOwner: 'sup-3',
    leaseExpiresAt: iso(-5_000),
    lastHeartbeatAt: iso(-120_000),
    lastProgressAt: iso(-120_000),
  });
  const r = tickLane(lane, { processAlive: true }, CFG, now(0));
  assert.equal(r.status, 'STALE');
  assert.equal(r.action, 'STALLED');
});

test('activateLane claims a lease and marks the lane WORKING', () => {
  const lane = createLane({ laneId: 'lane-b' });
  const active = activateLane(lane, { now: now(0), leaseOwner: 'sup-1', leaseTtlMs: 60_000 });
  assert.equal(active.status, 'WORKING');
  assert.equal(active.leaseOwner, 'sup-1');
  assert.equal(active.dispatches, 1);
  assert.equal(active.attempts, 0);
  assert.equal(leaseHeldBy(active, 'sup-1'), true);
  assert.equal(leaseHeldBy(active, 'sup-2'), false);
  assert.equal(leaseRevoked(active, now(0)), false);
  assert.equal(leaseRevoked(active, now(65_000)), true);
  assert.throws(() => activateLane(lane, { now: now(0), leaseOwner: null }), /LEASE_OWNER_REQUIRED/);
});

test('a DONE lane waits then becomes redispatch eligible', () => {
  const done = markDone(baseLane({ progressEvidence: 'feature-shipped' }), { now: now(0) });
  assert.equal(done.status, 'DONE');
  assert.equal(done.doneAt, iso(0));

  const early = tickLane(done, { processAlive: true }, CFG, now(60_000));
  assert.equal(early.status, 'DONE');
  assert.equal(early.redispatchEligible, false);
  assert.equal(early.action, 'TERMINAL_DONE');

  const eligible = tickLane(done, { processAlive: true }, CFG, now(120_000));
  assert.equal(eligible.status, 'IDLE');
  assert.equal(eligible.redispatchEligible, true);
  assert.equal(eligible.action, 'REDISPATCH');
  assert.equal(eligible.reason, 'redispatch_eligible');
  assert.equal(eligible.lane.attempts, 0);
});

test('completed lanes stay DONE forever and never redispatch', () => {
  const done = markDone(baseLane({ progressEvidence: 'final' }), { now: now(0), completed: true });
  const r = tickLane(done, { processAlive: false }, CFG, now(9_999_999));
  assert.equal(r.status, 'DONE');
  assert.equal(r.action, 'TERMINAL_DONE');
  assert.equal(r.redispatchEligible, false);
});

test('ERROR lanes wait for backoff then become retry eligible even if the process died', () => {
  const failed = markError(baseLane({ progressEvidence: 'partial' }), {
    now: now(0), error: 'worker-2-crashed',
  });
  assert.equal(failed.status, 'ERROR');
  assert.equal(failed.attempts, 1);

  const waiting = tickLane(failed, { processAlive: false }, CFG, now(30_000));
  assert.equal(waiting.status, 'ERROR');
  assert.equal(waiting.retryEligible, false);
  assert.equal(waiting.action, 'TERMINAL_ERROR');

  const ready = tickLane(failed, { processAlive: false }, CFG, now(60_000));
  assert.equal(ready.status, 'IDLE');
  assert.equal(ready.retryEligible, true);
  assert.equal(ready.action, 'RETRY_ELIGIBLE');
  assert.equal(ready.reason, 'retry_backoff_elapsed');
  assert.equal(ready.lane.errorAt, null);
});

test('a BLOCKED lane stays BLOCKED until a true human opens the gate', () => {
  const blocked = markError(baseLane(), { now: now(0), humanHalt: true });
  assert.equal(blocked.status, 'BLOCKED');

  const machine = tickLane(blocked, { processAlive: true, gateOpen: false }, CFG, now(5_000));
  assert.equal(machine.status, 'BLOCKED');
  assert.equal(machine.action, 'ESCALATE_REQUIRED');
  assert.equal(machine.reason, 'human_gate_blocked');

  const released = humanRelease(blocked, { now: now(10_000), by: 'human-gal' });
  assert.equal(released.status, 'IDLE');
  assert.equal(released.blockedGateOpen, true);
  assert.equal(released.gateReleasedBy, 'human-gal');

  const cleared = tickLane(released, {
    processAlive: true,
    gateOpen: true,
    heartbeatAt: iso(10_000),
  }, CFG, now(10_000));
  assert.equal(cleared.status, 'IDLE');
  assert.equal(cleared.action, 'DISPATCH_CANDIDATE');

  const rechecked = tickLane(released, {
    processAlive: true,
    gateOpen: false,
    heartbeatAt: iso(10_000),
  }, CFG, now(10_000));
  assert.equal(rechecked.status, 'IDLE');
  assert.equal(rechecked.action, 'DISPATCH_CANDIDATE');
});

test('a dead process cannot release or bypass a blocked human gate', () => {
  const blocked = markError(baseLane(), { now: now(0), humanHalt: true });
  const r = tickLane(blocked, { processAlive: false }, CFG, now(0));
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.action, 'ESCALATE_REQUIRED');

  const gateOpened = tickLane({ ...r.lane, blockedGateOpen: true, gateReleasedBy: 'human-gal' }, {
    processAlive: false,
    gateOpen: true,
  }, CFG, now(0));
  assert.equal(gateOpened.status, 'IDLE');
  assert.equal(gateOpened.action, 'RELEASE_GATE_CLEAR');
  assert.equal(gateOpened.reason, 'human_gate_released');
});

test('clock skew with a future timestamp keeps fresh evidence WORKING and reports skew', () => {
  const lane = baseLane({
    status: 'WORKING',
    lastHeartbeatAt: iso(5_000),
    lastProgressAt: iso(5_000),
  });
  const r = tickLane(lane, { processAlive: true }, CFG, now(0));
  assert.equal(r.status, 'WORKING');
  assert.equal(r.clockSkewMs, 5_000);
});

test('invalid and sentinel timestamps are treated as absent evidence', () => {
  const cases = [null, '', 'NONE', 'garbage', 'not-a-date'];
  for (const bad of cases) {
    const lane = baseLane({
      status: 'WORKING',
      lastHeartbeatAt: bad,
      lastProgressAt: bad,
    });
    const r = tickLane(lane, { processAlive: true }, CFG, now(0));
    assert.equal(r.status, 'STALE', `worker with timestamp ${JSON.stringify(bad)}`);
    assert.match(r.reason, /heartbeat_stale/);
  }
});

test('invalid input timestamps and TTLs fail loudly', () => {
  const invalidNow = baseLane({ status: 'IDLE' });
  assert.throws(() => tickLane(invalidNow, {}, CFG, new Date('bad')), /INVALID_NOW/);
  assert.throws(() => tickLane(invalidNow, {}, { stallTtlMs: -1 }, now(0)), /INVALID_STALL_TTL_MS/);
});

test('isTimestampFresh respects the configurable TTL bound', () => {
  assert.equal(isTimestampFresh(T0.getTime(), T0.getTime(), 1_000), true);
  assert.equal(isTimestampFresh(T0.getTime(), T0.getTime() + 1_000, 1_000), false);
  assert.equal(isTimestampFresh(null, T0.getTime(), 1_000), false);
});

test('working lanes remain WORKING when terminal flags are absent', () => {
  const lane = activateLane(createLane({ laneId: 'lane-z' }), {
    now: now(0), leaseOwner: 'sup-9', leaseTtlMs: 360_000,
  });
  const r = tickLane(lane, { processAlive: true }, CFG, now(10_000));
  assert.equal(r.status, 'WORKING');
  assert.equal(r.action, 'ACTIVE');
});

test('tickFleet aggregates statuses and supervisor queues per lane id', () => {
  const tickMs = T0.getTime() + 120_000;
  const lanes = [
    baseLane({
      laneId: 'w1', status: 'WORKING', pid: 101,
      leaseOwner: 'sup-1', leaseExpiresAt: iso(150_000),
      lastHeartbeatAt: iso(119_000), lastProgressAt: iso(119_000),
    }),
    baseLane({
      laneId: 'w2', status: 'WORKING', pid: 202,
      leaseOwner: 'sup-2', leaseExpiresAt: iso(150_000),
      lastHeartbeatAt: iso(30_000), lastProgressAt: iso(30_000),
    }),
    baseLane({ laneId: 'w3', status: 'STALE' }),
    baseLane({ laneId: 'w4', status: 'DONE', doneAt: iso(0) }),
  ];
  const { results, summary } = tickFleet(lanes, {
    w1: { processAlive: true },
    w2: { processAlive: true },
    w3: { processAlive: false },
    w4: { processAlive: true },
  }, CFG, new Date(tickMs));

  assert.equal(summary.WORKING, 1);
  assert.equal(summary.STALE, 1);
  assert.equal(summary.OFFLINE, 1);
  assert.deepEqual(summary.stalled, ['w2']);
  assert.deepEqual(summary.offline, ['w3']);
  assert.deepEqual(summary.redispatchEligible, ['w4']);
  assert.equal(results.length, 4);
});

test('reconfigurable TTLs shift state timing', () => {
  const lane = baseLane({
    status: 'WORKING',
    lastHeartbeatAt: iso(-10_000),
    lastProgressAt: iso(-10_000),
  });
  const strict = tickLane(lane, { processAlive: true }, {
    heartbeatStallMs: 5_000, stallTtlMs: 5_000,
  }, now(0));
  assert.equal(strict.status, 'STALE');

  const lenient = tickLane(lane, { processAlive: true }, {
    heartbeatStallMs: 30_000, stallTtlMs: 30_000,
  }, now(0));
  assert.equal(lenient.status, 'WORKING');
});

test('lane history is bounded and records transitions', () => {
  let lane = activateLane(createLane({ laneId: 'hist' }), {
    now: now(-120_000), leaseOwner: 'sup-1',
  });
  lane = tickLane(lane, { processAlive: true, progressAt: iso(-120_000) }, { ...CFG, historyLimit: 5 }, now(-120_000)).lane;
  lane = tickLane(lane, { processAlive: true }, { ...CFG, historyLimit: 5 }, now(0)).lane;
  const staleEntries = lane.history.filter((entry) => entry.to === 'STALE' && entry.reason === 'heartbeat_stale');
  assert.equal(lane.status, 'STALE');
  assert.equal(staleEntries.length, 1);
  assert.equal(lane.history[0].from, 'WORKING');
  assert.equal(lane.history[0].to, 'STALE');
  assert.ok(lane.history.every((entry) => entry && entry.at && entry.reason));
  assert.ok(lane.history.length <= 5);
});

test('reusable false keeps DONE lanes terminal forever', () => {
  const done = markDone(baseLane({ progressEvidence: 'non-reusable' }), { now: now(0) });
  const r = tickLane(done, { processAlive: true }, { ...CFG, reusable: false }, now(9_999_999));
  assert.equal(r.status, 'DONE');
  assert.equal(r.redispatchEligible, false);
  assert.equal(r.action, 'TERMINAL_DONE');
});
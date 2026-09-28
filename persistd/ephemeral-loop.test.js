const test = require('node:test');
const assert = require('node:assert/strict');
const { EphemeralWorkerLoop } = require('./src/fleet/ephemeral-loop');

function worker(id, expires) {
  return {
    id,
    provider: 'railway-anonymous',
    buildExpiresAt: expires,
  };
}

test('loop acquires successor before releasing predecessor and resumes from checkpoint', async () => {
  const actions = [];
  const releases = [];
  const workers = [
    worker('w1', '2026-09-27T05:00:00.000Z'),
    worker('w2', '2026-09-27T06:00:00.000Z'),
  ];
  const provider = {
    acquire: async () => {
      const next = workers.shift();
      actions.push('acquire:' + next.id);
      return next;
    },
    release: async (value) => {
      actions.push('release:' + value.id);
      releases.push(value.id);
    },
    describe: (value) => ({ id: value.id, provider: value.provider, buildExpiresAt: value.buildExpiresAt }),
  };
  const events = [];
  const resumes = [];
  const loop = new EphemeralWorkerLoop({
    provider,
    maxWorkers: 3,
    handoffLeadMs: 8 * 60_000,
    clock: () => new Date('2026-09-27T04:00:00.000Z'),
    checkpoint: async (event) => events.push(event.type),
  });
  const result = await loop.run({ id: 'task-1' }, {
    executeWorker: async ({ attempt, resume, handoffAt }) => {
      resumes.push({ attempt, resume, handoffAt });
      if (attempt === 1) return { status: 'handoff', resume: { commit: 'abc', step: 7 } };
      return { status: 'completed', result: { commit: 'def' } };
    },
    finalizeHandoff: async ({ predecessor, successor }) => {
      actions.push('finalize:' + predecessor.id + '->' + successor.id);
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.attempts, 2);
  assert.deepEqual(resumes[1].resume, { commit: 'abc', step: 7 });
  assert.deepEqual(actions.slice(0, 4), [
    'acquire:w1',
    'acquire:w2',
    'finalize:w1->w2',
    'release:w1',
  ]);
  assert.deepEqual(releases, ['w1', 'w2']);
  assert.ok(events.includes('ephemeral.worker.successor_ready'));
  assert.ok(events.includes('ephemeral.worker.handoff'));
  assert.equal(resumes[0].handoffAt, '2026-09-27T04:52:00.000Z');
});

test('loop stops instead of silently exceeding its worker budget', async () => {
  const provider = {
    acquire: async ({ attempt }) => worker('w' + attempt, '2026-09-27T05:00:00.000Z'),
    release: async () => {},
  };
  const events = [];
  const loop = new EphemeralWorkerLoop({
    provider,
    maxWorkers: 1,
    checkpoint: async (event) => events.push(event.type),
    clock: () => new Date('2026-09-27T04:00:00.000Z'),
  });
  await assert.rejects(
    () => loop.run({ id: 'task-2' }, {
      executeWorker: async () => ({ status: 'handoff', resume: { step: 1 } }),
    }),
    /BUDGET_EXHAUSTED/,
  );
  assert.ok(events.includes('ephemeral.worker.budget_exhausted'));
});

test('loop preserves predecessor when successor acquisition fails', async () => {
  let count = 0;
  const released = [];
  const provider = {
    acquire: async () => {
      count += 1;
      if (count === 1) return worker('w1', '2026-09-27T05:00:00.000Z');
      throw new Error('NO_CAPACITY');
    },
    release: async (value) => released.push(value.id),
  };
  const loop = new EphemeralWorkerLoop({
    provider,
    maxWorkers: 3,
    checkpoint: async () => {},
    clock: () => new Date('2026-09-27T04:00:00.000Z'),
  });
  await assert.rejects(
    () => loop.run({ id: 'task-3' }, {
      executeWorker: async () => ({ status: 'handoff', resume: { step: 1 } }),
    }),
    /NO_CAPACITY/,
  );
  assert.deepEqual(released, []);
});

test('loop preserves predecessor and releases the unused successor when finalize fails', async () => {
  let acquisitions = 0;
  const released = [];
  const provider = {
    acquire: async () => worker('w' + (++acquisitions), '2026-09-27T05:00:00.000Z'),
    release: async (value) => released.push(value.id),
  };
  const events = [];
  const loop = new EphemeralWorkerLoop({ provider, checkpoint: async (event) => events.push(event.type) });
  await assert.rejects(() => loop.run({ id: 'finalize-fail' }, {
    executeWorker: async ({ attempt }) => attempt === 1
      ? { status: 'handoff', resume: { step: 2 } }
      : { status: 'completed' },
    finalizeHandoff: async () => { throw new Error('FINALIZE_DENIED'); },
  }), /FINALIZE_DENIED/);
  assert.equal(acquisitions, 2);
  assert.deepEqual(released, ['w2']);
  assert.ok(events.includes('ephemeral.worker.handoff_failed'));
  assert.ok(!events.includes('ephemeral.worker.handoff'));
});

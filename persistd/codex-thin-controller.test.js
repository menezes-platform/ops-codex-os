const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendWorkerEvent,
  compactSuccessorPrompt,
  effectiveQuotaAfterReset,
  eligibleForSuccessor,
  extractPersistflowRunId,
  preToolDecision,
  recentRecords,
  requestRollover,
  telemetryFromRecords,
  wakeMessage,
} = require('./src/codex-thin-controller');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thin-controller-'));
}

function tokenRecord({ quota = 98, input = 64635, cached = 64512, output = 104 } = {}) {
  return {
    timestamp: '2026-09-19T20:28:10.290Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
        model_context_window: 258400,
      },
      rate_limits: {
        primary: { used_percent: quota, resets_at: 1789864499 },
        secondary: { used_percent: 31, resets_at: 1790432341 },
      },
    },
  };
}

test('recognizes the real emergency quota shape without counting cache as free', () => {
  const telemetry = telemetryFromRecords([tokenRecord()], {});
  assert.equal(telemetry.level, 'EMERGENCY');
  assert.equal(telemetry.quotaUsedPercent, 98);
  assert.equal(telemetry.contextTokens, 64635);
  assert.equal(telemetry.cachedInputTokens, 64512);
  assert.equal(telemetry.primaryResetAt, '2026-09-20T00:34:59.000Z');
});

test('combines latest usage with the latest token record that still carries rate limits', () => {
  const withRate = tokenRecord();
  const withoutRate = {
    ...tokenRecord({ input: 64700, cached: 64600, output: 20 }),
    timestamp: '2026-09-19T20:28:10.636Z',
  };
  delete withoutRate.payload.rate_limits;
  const telemetry = telemetryFromRecords([withRate, withoutRate], {});
  assert.equal(telemetry.quotaUsedPercent, 98);
  assert.equal(telemetry.contextTokens, 64700);
  assert.equal(telemetry.sampledAt, withRate.timestamp);
});

test('adaptive transcript tail expands until it finds quota telemetry', () => {
  const dir = tempHome();
  const file = path.join(dir, 'session.jsonl');
  const token = JSON.stringify(tokenRecord());
  const hugeLaterRecord = JSON.stringify({ type: 'response_item', payload: { blob: 'z'.repeat(3 * 1024 * 1024) } });
  fs.writeFileSync(file, token + '\n' + hugeLaterRecord + '\n', 'utf8');
  const records = recentRecords(file);
  assert.equal(telemetryFromRecords(records, {}).quotaUsedPercent, 98);
});

test('extracts Persistflow run ids from nested escaped tool arguments', () => {
  const records = [{
    payload: {
      input: 'const r = await tool({\\"runId\\":\\"tiktok-live-dungeon-dod-20260914\\"})',
    },
  }];
  assert.equal(extractPersistflowRunId(records), 'tiktok-live-dungeon-dod-20260914');
});

test('managed parent cannot poll subagents with wait_agent', () => {
  const state = { sessionId: 'root-1', managed: true };
  const denied = preToolDecision({ tool_name: 'wait_agent' }, state);
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /event/i);
  assert.equal(preToolDecision({ tool_name: 'spawn_agent' }, state), null);
  assert.equal(preToolDecision({ tool_name: 'wait_agent' }, { ...state, managed: false }), null);
});

test('worker payload stays on disk while parent wake message stays tiny', () => {
  const home = tempHome();
  const state = { sessionId: 'root-2', managed: true, persistflowRunId: 'demo-run' };
  const heavy = 'x'.repeat(20000);
  const { file } = appendWorkerEvent({
    agent_id: 'worker-1',
    agent_type: 'review',
    last_assistant_message: heavy,
  }, state, home);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.lastAssistantMessage.length, 20000);
  const wake = wakeMessage(file, state);
  assert.ok(wake.length < 800);
  assert.equal(wake.includes(heavy.slice(0, 100)), false);
});

test('rollover is automatic only for durable managed runs', () => {
  const home = tempHome();
  const base = {
    sessionId: 'root-3',
    managed: true,
    autoRollover: true,
    telemetry: { level: 'ROLLOVER' },
  };
  const requested = requestRollover(base, home, new Date('2026-09-19T20:30:00Z'));
  assert.equal(requested.rolloverReason, 'quota_guard:rollover');
  const unmanaged = requestRollover({ ...base, managed: false, sessionId: 'root-4' }, home);
  assert.equal(unmanaged.rolloverRequestedAt, undefined);
  const nondurable = requestRollover({ ...base, autoRollover: false, sessionId: 'root-5' }, home);
  assert.equal(nondurable.rolloverRequestedAt, undefined);
});

test('emergency rollover waits for quota reset before successor becomes eligible', () => {
  const state = {
    sessionId: 'root-6',
    autoRollover: true,
    cwd: process.cwd(),
    rolloverRequestedAt: '2026-09-19T20:30:00Z',
    telemetry: {
      level: 'EMERGENCY',
      quotaUsedPercent: 98,
      primaryResetAt: '2026-09-20T00:34:59.000Z',
    },
  };
  assert.equal(eligibleForSuccessor(state, new Date('2026-09-20T00:34:00Z')), false);
  assert.equal(effectiveQuotaAfterReset(state, new Date('2026-09-20T00:35:30Z')), 0);
  assert.equal(eligibleForSuccessor(state, new Date('2026-09-20T00:35:30Z')), true);
});

test('successor baton points to durable state instead of predecessor transcript', () => {
  const prompt = compactSuccessorPrompt({
    thinGeneration: 3,
    persistflowRunId: 'demo-run',
    cwd: 'C:/repo',
  }, 'C:/events/root');
  assert.match(prompt, /Persistflow run: demo-run/);
  assert.match(prompt, /Git plus the latest durable Persistflow checkpoint/);
  assert.match(prompt, /do not read the predecessor transcript/i);
  assert.match(prompt, /Never poll workers with wait_agent/);
  assert.ok(prompt.length < 1400);
});

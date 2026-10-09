const test = require('node:test');
const assert = require('node:assert/strict');

const orchestrator = require('./src/orchestrator');

test('formats a human chat title before and after final generation is known', () => {
  assert.equal(typeof orchestrator.buildChatTitle, 'function');
  assert.equal(orchestrator.buildChatTitle('Conthabil', 1), 'Conthabil 1');
  assert.equal(orchestrator.buildChatTitle('Conthabil', 1, 4), 'Conthabil 1 de 4');
  assert.equal(orchestrator.buildChatTitle('Conthabil', 4, 4), 'Conthabil 4 de 4');
});

test('appends persistd-created chats without losing the legacy CHAT_ID', () => {
  assert.equal(typeof orchestrator.appendChatHistory, 'function');
  const first = orchestrator.appendChatHistory({ CHAT_ID: 'legacy-final' }, 'chat-a');
  const second = orchestrator.appendChatHistory(first, 'chat-b');
  const duplicate = orchestrator.appendChatHistory(second, 'chat-b');

  assert.equal(duplicate.CHAT_ID, 'legacy-final');
  assert.deepEqual(JSON.parse(duplicate.CHAT_HISTORY_JSON), [
    { index: 1, chatId: 'chat-a' },
    { index: 2, chatId: 'chat-b' },
  ]);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveRun } = require('./src/resolver');

test('resolves only explicitly pending post-DONE lifecycle work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-lifecycle-'));
  const legacyDir = path.join(root, 'legacy');
  fs.mkdirSync(legacyDir);
  fs.writeFileSync(path.join(legacyDir, 'CONTROL.md'), 'RUN_ID: legacy\nSTATUS: DONE\nNOTIFICATION_STATUS: SENT\n');
  assert.equal(resolveRun(root, { includePendingDone: true }), null);

  const runDir = path.join(root, 'new-run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, 'CONTROL.md'), [
    'RUN_ID: new-run', 'STATUS: DONE', 'NOTIFICATION_STATUS: SENT',
    'CHAT_TITLE_STATUS: PENDING', 'BROWSER_CLEANUP_STATUS: PENDING', '',
  ].join('\n'));
  assert.equal(resolveRun(root, { includePendingDone: true }).RUN_ID, 'new-run');
});

const { readControl, writeControlAtomic, replaceFileWithRetry } = require('./src/control-state');
const { acquireLock } = require('./src/lease');

function makeRun(root, state) {
  const runDir = path.join(root, state.RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const controlPath = path.join(runDir, 'CONTROL.md');
  writeControlAtomic(controlPath, state);
  return controlPath;
}

test('retries transient Windows atomic replace errors but not real failures', () => {
  assert.equal(typeof replaceFileWithRetry, 'function');
  let attempts = 0;
  const sleeps = [];
  replaceFileWithRetry('tmp', 'CONTROL.md', {
    rename: () => {
      attempts++;
      if (attempts < 3) { const error = new Error('locked'); error.code = 'EPERM'; throw error; }
    },
    sleep: (ms) => sleeps.push(ms), retries: 4, baseDelayMs: 5,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [5, 10]);
  const fatal = new Error('disk'); fatal.code = 'ENOSPC';
  assert.throws(() => replaceFileWithRetry('tmp', 'CONTROL.md', { rename: () => { throw fatal; }, sleep: () => {} }), /disk/);
});

test('preserves existing CONTROL when Windows persistently blocks atomic replace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-control-fallback-'));
  const controlPath = path.join(root, 'CONTROL.md');
  fs.writeFileSync(controlPath, 'RUN_ID: old\nSTATUS: ACTIVE\n');
  let renameAttempts = 0;
  const lockedRename = () => {
    renameAttempts++;
    const error = new Error('destination held open'); error.code = 'EPERM'; throw error;
  };
  assert.throws(() => writeControlAtomic(controlPath, { RUN_ID: 'new', STATUS: 'ACTIVE', GENERATION: '2' }, {
    rename: lockedRename, sleep: () => {}, retries: 1, baseDelayMs: 1,
  }), /CONTROL_REPLACE_BLOCKED/);
  assert.equal(renameAttempts, 2);
  assert.equal(readControl(controlPath).RUN_ID, 'old');
  assert.ok(fs.readdirSync(root).some((name) => name.includes('.pending-')));
});

test('recovers a stale persistd lock only when its owner process is dead', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-stale-lock-'));
  const lockPath = path.join(root, '.persistd.lock');
  fs.writeFileSync(lockPath, '424242\n');
  const release = acquireLock(lockPath, { isProcessAlive: (pid) => pid !== 424242 });
  assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
  release();
  assert.equal(fs.existsSync(lockPath), false);

  fs.writeFileSync(lockPath, '777\n');
  assert.throws(() => acquireLock(lockPath, { isProcessAlive: () => true }), /LOCKED/);
  fs.unlinkSync(lockPath);
});

test('records and names a successor only after durable claim, without coupling rename to takeover', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-rollover-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'conthabil-test', GENERATION: '1', STATUS: 'CONTEXT_RISK',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z',
    DISPLAY_NAME: 'Conthabil', PROJECT_ROOT: 'C:\\repo', TASK_ID: 'task',
  });
  const renameCalls = [];
  const browser = {
    async createSuccessor({ state, nextGeneration, controlPath: pathToControl }) {
      writeControlAtomic(pathToControl, {
        ...state, GENERATION: String(nextGeneration), STATUS: 'ACTIVE',
        CLAIMED_AT: '2026-09-01T12:01:00Z', LEASE_OWNER: `G${nextGeneration}`,
      });
      return { chatId: 'chat-2', taskSpaceId: 42, evidence: 'test-claim' };
    },
    async renameChat(payload) {
      renameCalls.push(payload);
      throw new Error('rename-ui-changed');
    },
  };
  const result = await orchestrator.tick({
    root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z'),
  });
  const final = readControl(controlPath);
  assert.equal(result.action, 'ROLLED_OVER');
  assert.equal(final.GENERATION, '2');
  assert.equal(final.STATUS, 'ACTIVE');
  assert.deepEqual(JSON.parse(final.CHAT_HISTORY_JSON), [{ index: 1, chatId: 'chat-2' }]);
  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0].chatId, 'chat-2');
  assert.equal(renameCalls[0].title, 'Conthabil 1');
  assert.equal(String(renameCalls[0].state.GENERATION), '2');
});

test('finalizes DONE by skipping historical rename and closing its task space', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-done-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'conthabil-done', GENERATION: '4', STATUS: 'DONE',
    DISPLAY_NAME: 'Conthabil', PROJECT_ROOT: 'C:\\repo', TASK_ID: 'task',
    NOTIFICATION_STATUS: 'SENT', CHAT_TITLE_STATUS: 'PENDING',
    BROWSER_CLEANUP_STATUS: 'PENDING',
    CHAT_HISTORY_JSON: JSON.stringify([
      { index: 1, chatId: 'chat-a' }, { index: 2, chatId: 'chat-b' },
    ]),
  });
  const calls = [];
  const browser = {
    async renameChats(payload) { calls.push(['rename', payload]); return { renamed: 2 }; },
    async cleanupRun(payload) { calls.push(['cleanup', payload]); return { closed: true }; },
  };
  const result = await orchestrator.tick({
    root, browser, notifier: { terminal: async () => { throw new Error('duplicate notification'); } },
    clock: () => new Date('2026-09-01T13:00:00Z'),
  });
  const final = readControl(controlPath);
  assert.equal(result.action, 'FINALIZED');
  assert.equal(final.CHAT_TITLE_STATUS, 'SKIPPED_SAFE');
  assert.equal(final.BROWSER_CLEANUP_STATUS, 'SENT');
  assert.deepEqual(calls.map((item) => item[0]), ['cleanup']);
});

const egoScript = require('./src/browser/ego-script');

test('builds isolated rename and cleanup browser scripts', () => {
  assert.equal(typeof egoScript.buildRenameChatsScript, 'function');
  assert.equal(typeof egoScript.buildCleanupScript, 'function');
  const rename = egoScript.buildRenameChatsScript({
    runId: 'abc', chats: [{ chatId: 'id-1', title: 'Conthabil 1 de 1' }],
  });
  const cleanup = egoScript.buildCleanupScript({ runId: 'abc' });
  assert.doesNotMatch(rename, /backend-api/);
  assert.match(rename, /Abrir opções de conversa para/);
  assert.match(rename, /\.hover\(\)/);
  assert.match(rename, /Renomear/);
  assert.match(rename, /menuReady/);
  assert.match(rename, /attempt < 3/);
  assert.match(rename, /keyboard\.press\('Escape'\)/);
  assert.match(rename, /input\.waitFor/);
  assert.match(rename, /Título do chat/);
  assert.match(rename, /press\('Enter'\)/);
  assert.match(rename, /Conthabil 1 de 1/);
  assert.match(cleanup, /taskSpaces\.complete/);
  assert.match(cleanup, /keep: false/);
});

const { createEgoBrowserTransport, resolvePersistdBrowserEnv } = require('./src/browser/ego-browser');

test('browser transport exposes cosmetic rename and isolated cleanup operations', async () => {
  const scripts = [];
  const transport = createEgoBrowserTransport({
    runner: async (script) => {
      scripts.push(script);
      if (script.includes('taskSpaces.complete')) return { closed: true };
      return { ok: true, renamed: 1 };
    },
  });
  assert.equal(typeof transport.renameChat, 'function');
  assert.equal(typeof transport.renameChats, 'function');
  assert.equal(typeof transport.cleanupRun, 'function');
  await transport.renameChat({ state: { RUN_ID: 'abc' }, chatId: 'id-1', title: 'Conthabil 1' });
  await transport.renameChats({ state: { RUN_ID: 'abc' }, chats: [{ chatId: 'id-1', title: 'Conthabil 1 de 1' }] });
  await transport.cleanupRun({ state: { RUN_ID: 'abc' } });
  assert.equal(scripts.length, 3);
  assert.match(scripts[0], /Conthabil 1/);
  assert.match(scripts[1], /1 de 1/);
  assert.match(scripts[2], /taskSpaces\.complete/);
});

test('persistd recovers Edge when PROGRAMFILES(X86) is absent', () => {
  assert.equal(typeof resolvePersistdBrowserEnv, 'function');
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const env = resolvePersistdBrowserEnv({
    platform: 'win32',
    env: { SystemDrive: 'C:', PROGRAMFILES: 'C:\\Program Files' },
    exists: (candidate) => candidate === edge,
  });
  assert.equal(env.EGO_HOST_BROWSER_PATH, edge);
});

test('legacy pending cosmetic rename is skipped safely and cleanup still runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-giveup-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'conthabil-giveup', GENERATION: '4', STATUS: 'DONE', DISPLAY_NAME: 'Conthabil',
    PROJECT_ROOT: 'C:\\repo', TASK_ID: 'task', NOTIFICATION_STATUS: 'SENT',
    CHAT_TITLE_STATUS: 'FAILED', CHAT_TITLE_ATTEMPTS: '2', BROWSER_CLEANUP_STATUS: 'PENDING',
    CHAT_HISTORY_JSON: JSON.stringify([{ index: 1, chatId: 'chat-a' }]),
  });
  let cleanupCalls = 0;
  const result = await orchestrator.tick({
    root,
    browser: {
      async renameChats() { throw new Error('rename failed'); },
      async cleanupRun() { cleanupCalls++; return { closed: true }; },
    },
    notifier: {}, clock: () => new Date('2026-09-01T13:10:00Z'),
  });
  const final = readControl(controlPath);
  assert.equal(result.action, 'FINALIZED');
  assert.equal(final.STATUS, 'DONE');
  assert.equal(final.GENERATION, '4');
  assert.equal(final.CHAT_TITLE_STATUS, 'SKIPPED_SAFE');
  assert.equal(final.BROWSER_CLEANUP_STATUS, 'SENT');
  assert.equal(cleanupCalls, 1);
});

test('prefers an explicit human display name and has a safe legacy fallback', () => {
  assert.equal(typeof orchestrator.resolveDisplayName, 'function');
  assert.equal(orchestrator.resolveDisplayName({ DISPLAY_NAME: 'Conthabil', RUN_ID: 'X' }), 'Conthabil');
  assert.equal(orchestrator.resolveDisplayName({ RUN_ID: 'CONTHABIL-MOTION-20260831' }), 'Conthabil');
  assert.equal(orchestrator.resolveDisplayName({
    RUN_ID: 'MENEZESDEV-BROWSER-QA-20260830', TASK_ID: 'MenezesDev Tools Phase 10-12',
  }), 'MenezesDev');
});

const { buildSuccessorMessage } = require('./src/handoff');

test('successor baton carries the human display name and lifecycle metadata forward', () => {
  const message = buildSuccessorMessage({
    RUN_ID: 'conthabil', CLAIM_NONCE: 'nonce', DISPLAY_NAME: 'Conthabil',
    CHAT_HISTORY_JSON: '[{"index":1,"chatId":"abc"}]',
    CHAT_TITLE_STATUS: 'PENDING', BROWSER_CLEANUP_STATUS: 'PENDING',
  }, 3);
  assert.match(message, /Display name: Conthabil/);
  assert.match(message, /preserve DISPLAY_NAME, CHAT_HISTORY_JSON/);
});

const claimGeneration = require('./src/claim-generation');

test('claim helper promotes only the expected successor nonce', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-claim-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'claim-test', GENERATION: '2', STATUS: 'PREPARING_TAKEOVER',
    CLAIM_NONCE: 'nonce-3', NEXT_GENERATION: '3', LEASE_OWNER: 'G2',
    DISPLAY_NAME: 'Geometria', CHAT_HISTORY_JSON: '[]',
  });
  const claimed = claimGeneration.claimGeneration({
    controlPath, generation: 3, nonce: 'nonce-3',
    now: new Date('2026-09-01T21:00:00Z'),
  });
  assert.equal(claimed.GENERATION, '3');
  assert.equal(claimed.STATUS, 'ACTIVE');
  assert.equal(claimed.CLAIM_NONCE, 'nonce-3');
  assert.equal(claimed.LEASE_OWNER, 'G3');
  assert.equal(claimed.DISPLAY_NAME, 'Geometria');
});

test('claim helper rejects a stale nonce without mutating control', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-stale-'));
  const controlPath = makeRun(root, { RUN_ID: 'stale', GENERATION: '2', STATUS: 'PREPARING_TAKEOVER', CLAIM_NONCE: 'fresh', NEXT_GENERATION: '3' });
  assert.throws(() => claimGeneration.claimGeneration({ controlPath, generation: 3, nonce: 'stale' }), /NONCE_MISMATCH/);
  assert.equal(readControl(controlPath).GENERATION, '2');
});

test('successor baton requests nonce-bound promotion before project work', () => {
  const message = buildSuccessorMessage({
    RUN_ID: 'geometry-run', CLAIM_NONCE: 'nonce-3',
    CONTROL_PATH: 'C:\\state\\CONTROL.md', PROJECT_ROOT: 'C:\\repo',
  }, 3);
  assert.match(message, /CLAIM geometry-run G3/);
  assert.match(message, /CLAIM_REQUEST geometry-run G3 nonce-3/);
  assert.match(message, /wait for CLAIM_CONFIRMED geometry-run G3 nonce-3/i);
  assert.doesNotMatch(message, /claim-generation\.js/);
  assert.ok(
    message.indexOf('CLAIM_REQUEST geometry-run G3 nonce-3') < message.indexOf('reconstruct project state'),
    'nonce-bound request must precede project reconstruction',
  );
});

test('fairly services the stalest ACTIVE run instead of starving it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-fairness-'));
  const a = makeRun(root, { RUN_ID: 'run-a', GENERATION: '1', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\a' });
  const b = makeRun(root, { RUN_ID: 'run-b', GENERATION: '1', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\b' });
  const old = new Date('2026-09-01T20:00:00Z');
  const fresh = new Date('2026-09-01T20:10:00Z');
  fs.utimesSync(a, old, old);
  fs.utimesSync(b, fresh, fresh);
  assert.equal(resolveRun(root).RUN_ID, 'run-a');
  fs.utimesSync(a, new Date('2026-09-01T20:20:00Z'), new Date('2026-09-01T20:20:00Z'));
  assert.equal(resolveRun(root).RUN_ID, 'run-b');
});

test('discovery only reconciles taskspace metadata and cannot mutate chat authority', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-reconcile-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'geometry-run', GENERATION: '4', STATUS: 'ACTIVE', DISPLAY_NAME: 'Geometria',
    PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-01T20:00:00Z', CLAIMED_AT: '2026-09-01T20:50:00Z',
    CLAIM_NONCE: 'keep-me', CHAT_ID: '6a9761e1', CHAT_HISTORY_JSON: '[{"index":1,"chatId":"6a9761e1"}]',
    CHAT_TITLE_STATUS: 'PENDING', BROWSER_CLEANUP_STATUS: 'PENDING',
  });
  const renamed = [];
  const browser = {
    async discoverRunChats() { return { taskSpaceId: 38, chats: [
      { chatId: '6a976d5d', title: 'Execução bloqueada Task 6' },
      { chatId: '6a976179', title: 'Desenho Arquitetural Gamificado' },
      { chatId: '6a9761e1', title: 'Design de arquitetura adaptativa' },
    ] }; },
    async renameChats(payload) { renamed.push(...payload.chats); return { ok: true, renamed: payload.chats.length }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, clock: () => new Date('2026-09-01T20:55:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'WATCHING');
  assert.equal(final.GENERATION, '4');
  assert.equal(final.CLAIM_NONCE, 'keep-me');
  assert.equal(final.CHAT_ID, '6a9761e1');
  assert.deepEqual(JSON.parse(final.CHAT_HISTORY_JSON).map(x => x.chatId), ['6a9761e1']);
  assert.equal(final.BROWSER_TASKSPACE_ID, '38');
  assert.deepEqual(renamed, []);
});
test('browser transport can discover conversation tabs in one persist task space without page scans', async () => {
  const egoScript = require('./src/browser/ego-script');
  assert.equal(typeof egoScript.buildDiscoverRunChatsScript, 'function');
  const script = egoScript.buildDiscoverRunChatsScript({ runId: 'geometry-run' });
  assert.match(script, /browser\.listTabs/);
  assert.match(script, /persist:geometry-run/);
  const seen = [];
  const transport = createEgoBrowserTransport({ runner: async (code) => { seen.push(code); return { chats: [] }; } });
  assert.equal(typeof transport.discoverRunChats, 'function');
  await transport.discoverRunChats({ state: { RUN_ID: 'geometry-run' } });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /browser\.listTabs/);
});

test('builds a fail-closed active-run tab pruner that keeps only the exact current chat', () => {
  assert.equal(typeof egoScript.buildPruneRunTabsScript, 'function');
  const script = egoScript.buildPruneRunTabsScript({ runId: 'geometry-run', keepChatId: 'chat-current' });
  assert.match(script, /browser\.listTabs/);
  assert.match(script, /browser\.closeTab\(tab\.targetId\)/);
  assert.match(script, /KEEP_TAB_MISSING/);
  assert.match(script, /chat-current/);
  assert.doesNotMatch(script, /taskSpaces\.complete/);
});

test('browser transport exposes active-run tab pruning', async () => {
  const scripts = [];
  const transport = createEgoBrowserTransport({ runner: async (script) => {
    scripts.push(script);
    return { status: 'PRUNED', ok: true, closed: 3, remaining: 1 };
  } });
  assert.equal(typeof transport.pruneRunTabs, 'function');
  const result = await transport.pruneRunTabs({ state: { RUN_ID: 'geometry-run' }, keepChatId: 'chat-current' });
  assert.equal(result.ok, true);
  assert.match(scripts[0], /chat-current/);
  assert.match(scripts[0], /browser\.closeTab/);
});

test('prunes predecessor tabs only after durable claim and never couples pruning failure to takeover', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-prune-rollover-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'geometry-prune', GENERATION: '1', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'Geometria',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  const pruneCalls = [];
  const browser = {
    async createSuccessor({ state, nextGeneration, controlPath: pathToControl }) {
      writeControlAtomic(pathToControl, { ...state, GENERATION: String(nextGeneration), STATUS: 'ACTIVE',
        CLAIMED_AT: '2026-09-01T12:01:00Z', LEASE_OWNER: `G${nextGeneration}` });
      return { chatId: 'chat-current', taskSpaceId: 99, evidence: 'durable-claim' };
    },
    async pruneRunTabs(payload) { pruneCalls.push(payload); throw new Error('cosmetic-prune-failed'); },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'ROLLED_OVER');
  assert.equal(final.GENERATION, '2');
  assert.equal(final.STATUS, 'ACTIVE');
  assert.equal(final.CHAT_ID, 'chat-current');
  assert.equal(pruneCalls.length, 1);
  assert.equal(pruneCalls[0].keepChatId, 'chat-current');
});

test('retries a pending active-run prune on the next tick without creating another rollover', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-prune-retry-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'geometry-prune-retry', GENERATION: '2', STATUS: 'ACTIVE', DISPLAY_NAME: 'Geometria',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:59:00Z', PROJECT_ROOT: 'C:\\repo',
    CHAT_ID: 'chat-current', BROWSER_PRUNE_STATUS: 'FAILED', BROWSER_PRUNE_CHAT_ID: 'chat-current',
  });
  let pruneCalls = 0;
  const result = await orchestrator.tick({ root, browser: {
    async pruneRunTabs({ keepChatId }) { pruneCalls++; assert.equal(keepChatId, 'chat-current'); return { ok: true, closed: 4, remaining: 1 }; },
  }, notifier: {}, rolloverMinutes: 20, clock: () => new Date('2026-09-01T13:00:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'WATCHING');
  assert.equal(final.GENERATION, '2');
  assert.equal(final.BROWSER_PRUNE_STATUS, 'SENT');
  assert.equal(pruneCalls, 1);
});

test('filters resolver to one explicit run id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-run-filter-'));
  makeRun(root, {
    RUN_ID: 'other-run', STATUS: 'ACTIVE', GENERATION: '1',
    PROJECT_ROOT: 'C:\\other', STARTED_AT: '2026-09-01T10:00:00Z',
  });
  makeRun(root, {
    RUN_ID: 'target-run', STATUS: 'ACTIVE', GENERATION: '2',
    PROJECT_ROOT: 'C:\\target', STARTED_AT: '2026-09-01T11:00:00Z',
  });

  assert.equal(resolveRun(root, { runId: 'target-run' }).RUN_ID, 'target-run');
  assert.equal(resolveRun(root, { runId: 'missing-run' }), null);
});

test('daemon accepts an explicit run-id filter', () => {
  const { parseArgs } = require('./src/daemon');
  const parsed = parseArgs(['--root', 'C:\\runs', '--run-id', 'target-run', '--once']);
  assert.equal(parsed.root, 'C:\\runs');
  assert.equal(parsed.runId, 'target-run');
  assert.equal(parsed.once, true);
});


test('closes the exact failed successor tab before retrying an unclaimed takeover', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-failed-tab-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'fisco-failed-tab', GENERATION: '4', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'FiscoBR',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  const closed = [];
  const browser = {
    async createSuccessor() { return { chatId: 'failed-g5', taskSpaceId: 37, evidence: 'baton-visible' }; },
    async closeRunChat({ chatId }) { closed.push(chatId); return { ok: true, closed: 1 }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z') });
  assert.equal(result.action, 'ROLLOVER_INCOMPLETE');
  assert.deepEqual(closed, ['failed-g5']);
  assert.equal(readControl(controlPath).GENERATION, '4');
});

test('finishes an in-progress takeover before servicing passive ACTIVE runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-takeover-priority-'));
  makeRun(root, { RUN_ID: 'active-run', GENERATION: '6', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\active' });
  makeRun(root, { RUN_ID: 'takeover-run', GENERATION: '4', STATUS: 'PREPARING_TAKEOVER', PROJECT_ROOT: 'C:\\takeover' });
  assert.equal(resolveRun(root).RUN_ID, 'takeover-run');
});

test('successor browser script reports structured BROWSER_ERROR with exact tab identity', () => {
  const script = egoScript.buildSuccessorScript({
    runId: 'fisco-browser-error', message: 'baton', nextGeneration: 5,
  });
  assert.match(script, /catch \(error\)/);
  assert.match(script, /status: 'BROWSER_ERROR'/);
  assert.match(script, /targetId/);
  assert.match(script, /chatId/);
  assert.match(script, /PERSISTD_RESULT/);
});

test('browser transport can close one exact failed target without touching sibling tabs', async () => {
  const scripts = [];
  const transport = createEgoBrowserTransport({ runner: async (script) => {
    scripts.push(script); return { status: 'CLOSED_TARGET', ok: true, closed: 1 };
  } });
  assert.equal(typeof transport.closeRunTarget, 'function');
  await transport.closeRunTarget({ state: { RUN_ID: 'fisco' }, targetId: 'target-123' });
  assert.match(scripts[0], /target-123/);
  assert.match(scripts[0], /browser\.closeTab/);
});

test('cleans an exact scratch target when successor returns BROWSER_ERROR before durable claim', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-browser-error-target-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'fisco-browser-error', GENERATION: '4', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'FiscoBR',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  const closed = [];
  const browser = {
    async createSuccessor() { return { status: 'BROWSER_ERROR', targetId: 'scratch-target', chatId: null }; },
    async closeRunTarget({ targetId }) { closed.push(targetId); return { ok: true, closed: 1 }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'ROLLOVER_INCOMPLETE');
  assert.deepEqual(closed, ['scratch-target']);
  assert.equal(final.GENERATION, '4');
  assert.equal(final.BLOCKED_REASON, 'BROWSER_ERROR');
});

test('successor transport timeout exceeds its internal browser wait budget', async () => {
  const calls = [];
  const transport = createEgoBrowserTransport({ runner: async (_script, options) => {
    calls.push(options); return { status: 'BROWSER_ERROR', targetId: 'tab-x' };
  } });
  await transport.createSuccessor({
    state: { RUN_ID: 'timeout-budget' }, message: 'baton', nextGeneration: 2,
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].timeoutMs >= 180000, `timeout was ${calls[0].timeoutMs}`);
});

test('generated successor browser script is valid async JavaScript', () => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const script = egoScript.buildSuccessorScript({
    runId: 'syntax-check', message: 'baton', nextGeneration: 2,
  });
  assert.doesNotThrow(() => new AsyncFunction(script));
});

test('two-phase claim protocol builds and parses exact request and confirmation lines', () => {
  const protocol = require('./src/claim-protocol');
  assert.equal(typeof protocol.buildClaimRequestLine, 'function');
  assert.equal(typeof protocol.parseClaimRequestLine, 'function');
  const request = protocol.buildClaimRequestLine('fisco-run', 5, 'nonce-5');
  assert.equal(request, 'CLAIM_REQUEST fisco-run G5 nonce-5');
  assert.deepEqual(protocol.parseClaimRequestLine(request), {
    runId: 'fisco-run', generation: 5, nonce: 'nonce-5', line: request,
  });
  assert.equal(protocol.parseClaimRequestLine(request + ' extra'), null);
  assert.equal(
    protocol.buildClaimConfirmationLine('fisco-run', 5, 'nonce-5'),
    'CLAIM_CONFIRMED fisco-run G5 nonce-5',
  );
});

test('successor baton requests two-phase claim and no longer asks worker to run claim helper', () => {
  const message = buildSuccessorMessage({
    RUN_ID: 'fisco-run', CLAIM_NONCE: 'nonce-5', CONTROL_PATH: 'C:\\state\\CONTROL.md',
    PROJECT_ROOT: 'C:\\repo', DISPLAY_NAME: 'FiscoBR',
  }, 5);
  assert.match(message, /CLAIM_REQUEST fisco-run G5 nonce-5/);
  assert.match(message, /wait for CLAIM_CONFIRMED fisco-run G5 nonce-5/i);
  assert.doesNotMatch(message, /claim-generation\.js/);
  assert.doesNotMatch(message, /start_process/i);
});

test('successor wake marker is followed by exact nonce-bound request verification', () => {
  const script = egoScript.buildSuccessorScript({
    runId: 'fisco-run', message: 'baton', nextGeneration: 5,
  });
  assert.match(script, /CLAIM fisco-run G5/);
  const verify = require('./src/browser/conversation-script').buildFindAssistantLineScript({
    runId: 'fisco-run', chatId: 'chat-5', line: 'CLAIM_REQUEST fisco-run G5 nonce-5',
  });
  assert.match(verify, /CLAIM_REQUEST fisco-run G5 nonce-5/);
  assert.match(verify, /LINE_FOUND/);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(script));
  assert.doesNotThrow(() => new AsyncFunction(verify));
});

test('browser transport can send claim confirmation to the exact successor chat', async () => {
  const scripts = [];
  const transport = createEgoBrowserTransport({ runner: async (script) => {
    scripts.push(script);
    return { status: 'CLAIM_CONFIRMED_SENT', ok: true };
  } });
  assert.equal(typeof transport.sendClaimConfirmation, 'function');
  const result = await transport.sendClaimConfirmation({
    state: { RUN_ID: 'fisco-run' }, chatId: 'chat-5', generation: 5, nonce: 'nonce-5',
  });
  assert.equal(result.ok, true);
  assert.match(scripts[0], /chat-5/);
  assert.match(scripts[0], /CLAIM_CONFIRMED fisco-run G5 nonce-5/);
});

test('persistd locally promotes a valid claim request before confirming successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-two-phase-valid-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'fisco-two-phase', GENERATION: '4', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'FiscoBR',
    STARTED_AT: '2026-09-02T10:00:00Z', CLAIMED_AT: '2026-09-02T10:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  const confirmations = [];
  const browser = {
    async createSuccessor({ state, nextGeneration }) {
      return {
        status: 'CLAIM_REQUESTED', chatId: 'chat-5', targetId: 'target-5', taskSpaceId: 37,
        requestLine: `CLAIM_REQUEST ${state.RUN_ID} G${nextGeneration} ${state.CLAIM_NONCE}`,
      };
    },
    async sendClaimConfirmation(payload) { confirmations.push(payload); return { ok: true, status: 'CLAIM_CONFIRMED_SENT' }; },
    async pruneRunTabs() { return { ok: true, closed: 1, remaining: 1 }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'ROLLED_OVER');
  assert.equal(final.GENERATION, '5');
  assert.equal(final.STATUS, 'ACTIVE');
  assert.equal(final.CHAT_ID, 'chat-5');
  assert.equal(final.CLAIM_CONFIRM_STATUS, 'SENT');
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].chatId, 'chat-5');
});

test('persistd rejects a mismatched claim request and closes the exact successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-two-phase-bad-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'fisco-two-phase-bad', GENERATION: '4', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'FiscoBR',
    STARTED_AT: '2026-09-02T10:00:00Z', CLAIMED_AT: '2026-09-02T10:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  const closed = [];
  const browser = {
    async createSuccessor() {
      return { status: 'CLAIM_REQUESTED', chatId: 'bad-chat', targetId: 'bad-target', taskSpaceId: 37,
        requestLine: 'CLAIM_REQUEST wrong-run G5 wrong-nonce' };
    },
    async closeRunChat({ chatId }) { closed.push(chatId); return { ok: true }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'ROLLOVER_INCOMPLETE');
  assert.equal(final.GENERATION, '4');
  assert.deepEqual(closed, ['bad-chat']);
});

test('confirmation failure preserves durable promoted generation for retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-two-phase-confirm-fail-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'confirm-fail', GENERATION: '4', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'FiscoBR',
    STARTED_AT: '2026-09-02T10:00:00Z', CLAIMED_AT: '2026-09-02T10:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });  const browser = {
    async createSuccessor({ state, nextGeneration }) {
      return { status: 'CLAIM_REQUESTED', chatId: 'chat-5', targetId: 'target-5', taskSpaceId: 37,
        requestLine: `CLAIM_REQUEST ${state.RUN_ID} G${nextGeneration} ${state.CLAIM_NONCE}` };
    },
    async sendClaimConfirmation() { throw new Error('ui-down'); },
    async pruneRunTabs() { return { ok: true, closed: 0, remaining: 1 }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'CLAIM_CONFIRM_RETRY');
  assert.equal(final.GENERATION, '5');
  assert.equal(final.STATUS, 'ACTIVE');
  assert.equal(final.CLAIM_CONFIRM_STATUS, 'FAILED');
  assert.equal(final.CLAIM_CONFIRM_CHAT_ID, 'chat-5');
});

test('next tick retries failed claim confirmation without opening another successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-two-phase-confirm-retry-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'confirm-retry', GENERATION: '5', STATUS: 'ACTIVE', DISPLAY_NAME: 'FiscoBR',
    STARTED_AT: '2026-09-02T10:00:00Z', CLAIMED_AT: '2026-09-02T10:01:00Z', PROJECT_ROOT: 'C:\\repo',
    CLAIM_NONCE: 'nonce-5', CHAT_ID: 'chat-5', CLAIM_CONFIRM_STATUS: 'FAILED', CLAIM_CONFIRM_CHAT_ID: 'chat-5',
  });
  let creates = 0;
  let confirms = 0;
  const result = await orchestrator.tick({ root, browser: {
    async createSuccessor() { creates++; throw new Error('must not create'); },
    async sendClaimConfirmation() { confirms++; return { ok: true, status: 'CLAIM_CONFIRMED_SENT' }; },
  }, notifier: {}, rolloverMinutes: 20, clock: () => new Date('2026-09-02T10:02:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'WATCHING');
  assert.equal(final.GENERATION, '5');
  assert.equal(final.CLAIM_CONFIRM_STATUS, 'SENT');
  assert.equal(confirms, 1);
  assert.equal(creates, 0);
});

test('assistant line verifier waits for hydrated conversation content', () => {
  const script = require('./src/browser/conversation-script').buildFindAssistantLineScript({
    runId: 'hydrate-run', chatId: 'chat-2', line: 'CLAIM_REQUEST hydrate-run G2 nonce-2',
  });
  assert.match(script, /waitForFunction/);
  assert.match(script, /timeout:\s*10000/);
});
test('claim confirmation reattaches Remote Desktop Commander and waits for successor turn to start', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'resume-run', chatId: 'chat-2', message: 'confirm', verifyLine: 'CLAIM_CONFIRMED resume-run G2 nonce-2',
    attachCommander: true, waitForAssistantStart: true,
  });
  assert.match(script, /Remote Desktop Commander/);
  assert.match(script, /beforeAssistant/);
  assert.match(script, /assistantStarted/);
  assert.match(script, /waitForFunction/);
});

test('claim confirmation transport requires the successor assistant turn to start', async () => {
  let captured = '';
  const transport = createEgoBrowserTransport({ runner: async (script) => { captured = script; return { ok: true, status: 'ASSISTANT_STARTED' }; } });
  const result = await transport.sendClaimConfirmation({ state: { RUN_ID: 'resume-run' }, chatId: 'chat-2', generation: 2, nonce: 'nonce-2' });
  assert.equal(result.ok, true);
  assert.match(captured, /Remote Desktop Commander/);
  assert.match(captured, /assistantStarted/);
});
test('persistd finishes cosmetic tab work before releasing successor to resume', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-confirm-order-'));
  makeRun(root, {
    RUN_ID: 'order-run', GENERATION: '1', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'Order',
    STARTED_AT: '2026-09-02T10:00:00Z', CLAIMED_AT: '2026-09-02T10:00:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  const events = [];
  const browser = {
    async createSuccessor({ state, nextGeneration }) {
      return { status: 'CLAIM_REQUESTED', chatId: 'chat-2', taskSpaceId: 99,
        requestLine: `CLAIM_REQUEST ${state.RUN_ID} G${nextGeneration} ${state.CLAIM_NONCE}` };
    },
    async renameChat() { events.push('rename'); return { ok: true }; },
    async pruneRunTabs() { events.push('prune'); return { ok: true, remaining: 1 }; },
    async sendClaimConfirmation() { events.push('confirm'); return { ok: true }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  assert.equal(result.action, 'ROLLED_OVER');
  assert.deepEqual(events, ['rename', 'prune', 'confirm']);
});
test('claim confirmation is monotonic after a verified assistant start', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-confirm-monotonic-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'mono-run', GENERATION: '5', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo',
    CLAIMED_AT: '2026-09-02T10:00:00.000Z', CLAIM_NONCE: 'nonce-5',
    CLAIM_CONFIRM_STATUS: 'FAILED', CLAIM_CONFIRM_CHAT_ID: 'chat-5',
    CLAIM_RESUMED_AT: '2026-09-02T10:00:30.000Z',
  });
  let confirmations = 0;
  const result = await orchestrator.tick({ root, browser: {
    async sendClaimConfirmation() { confirmations++; return { ok: false }; },
  }, notifier: {}, rolloverMinutes: 9999, clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'WATCHING');
  assert.equal(final.CLAIM_CONFIRM_STATUS, 'SENT');
  assert.equal(confirmations, 0);
});
test('claim confirmation retry detects an already resumed last confirmation without resending', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'resume-run', chatId: 'chat-2', message: 'confirm', verifyLine: 'CLAIM_CONFIRMED resume-run G2 nonce-2',
    attachCommander: true, waitForAssistantStart: true,
  });
  assert.match(script, /ALREADY_RESUMED/);
  assert.match(script, /lastUserIndex/);
  assert.match(script, /confirmationIndex/);
  assert.match(script, /stop-button/);
});
test('generated claim confirmation browser script is valid async JavaScript', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'compile-run', chatId: 'chat-2', message: 'confirm',
    verifyLine: 'CLAIM_CONFIRMED compile-run G2 nonce-2',
    attachCommander: true, waitForAssistantStart: true,
  });
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(script));
});

test('rollover age starts when the claimed generation actually resumes', () => {
  const state = {
    STATUS: 'ACTIVE',
    STARTED_AT: '2026-09-02T10:00:00Z',
    CLAIMED_AT: '2026-09-02T10:10:00Z',
    CLAIM_RESUMED_AT: '2026-09-02T10:29:00Z',
  };
  assert.equal(orchestrator.isRolloverDue(state, new Date('2026-09-02T10:30:00Z'), 20), false);
  assert.equal(orchestrator.isRolloverDue(state, new Date('2026-09-02T10:50:00Z'), 20), true);
});

test('does not start or retry rollover while current assistant turn is active', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-worker-busy-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'busy-run', GENERATION: '5', STATUS: 'ROLLOVER_INCOMPLETE', PROJECT_ROOT: 'C:\\repo',
    CHAT_ID: 'chat-5', CLAIM_NONCE: 'nonce-5', NEXT_GENERATION: '6', ROLLOVER_ATTEMPTS: '2',
    CLAIM_CONFIRM_STATUS: 'SENT', CLAIM_RESUMED_AT: '2026-09-02T10:00:30Z',
  });
  let creates = 0;
  const result = await orchestrator.tick({ root, browser: {
    async isRunChatBusy() { return { ok: true, busy: true, chatId: 'chat-5' }; },
    async createSuccessor() { creates++; throw new Error('must not create while worker is busy'); },
  }, notifier: {}, rolloverMinutes: 9999, clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'WORKER_BUSY');
  assert.equal(final.GENERATION, '5');
  assert.equal(final.STATUS, 'ROLLOVER_INCOMPLETE');
  assert.equal(final.ROLLOVER_ATTEMPTS, '2');
  assert.equal(creates, 0);
});

test('browser transport can check whether the exact current run chat is busy', async () => {
  assert.equal(typeof egoScript.buildRunChatActivityScript, 'function');
  const script = egoScript.buildRunChatActivityScript({ runId: 'busy-run', chatId: 'chat-5' });
  assert.match(script, /chat-5/);
  assert.match(script, /stop-button/);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(script));
  const seen = [];
  const transport = createEgoBrowserTransport({ runner: async (code) => { seen.push(code); return { ok: true, busy: false }; } });
  const result = await transport.isRunChatBusy({ state: { RUN_ID: 'busy-run' }, chatId: 'chat-5' });
  assert.equal(result.busy, false);
  assert.equal(seen.length, 1);
});

test('new generation cannot inherit predecessor claim resume timestamps', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-fresh-generation-handshake-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'fresh-generation', GENERATION: '5', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'Fresh',
    STARTED_AT: '2026-09-02T09:00:00Z', CLAIMED_AT: '2026-09-02T09:30:00Z', PROJECT_ROOT: 'C:\\repo',
    CHAT_ID: 'chat-5', CLAIM_CONFIRM_STATUS: 'SENT', CLAIM_CONFIRM_CHAT_ID: 'chat-5',
    CLAIM_CONFIRMED_AT: '2026-09-02T09:31:00Z', CLAIM_RESUMED_AT: '2026-09-02T09:31:00Z',
  });
  let creates = 0;
  let confirms = 0;
  const browser = {
    async createSuccessor({ state, nextGeneration }) {
      creates++;
      return { status: 'CLAIM_REQUESTED', chatId: `chat-${nextGeneration}`, taskSpaceId: 91,
        requestLine: `CLAIM_REQUEST ${state.RUN_ID} G${nextGeneration} ${state.CLAIM_NONCE}` };
    },
    async renameChat() { return { ok: true }; },
    async pruneRunTabs() { return { ok: true, remaining: 1 }; },
    async sendClaimConfirmation() { confirms++; return { ok: true, status: 'ASSISTANT_STARTED' }; },
  };
  const first = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 20,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  const promoted = readControl(controlPath);
  assert.equal(first.action, 'ROLLED_OVER');
  assert.equal(promoted.GENERATION, '6');
  assert.equal(confirms, 1);
  assert.equal(promoted.CLAIM_CONFIRMED_AT, '2026-09-02T10:01:00.000Z');
  assert.equal(promoted.CLAIM_RESUMED_AT, '2026-09-02T10:01:00.000Z');
  const second = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 20,
    clock: () => new Date('2026-09-02T10:02:00Z') });
  assert.equal(second.action, 'WATCHING');
  assert.equal(creates, 1);
});
test('claim confirmation rate limit backs off without burning rollover attempts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-rate-limit-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'rate-run', GENERATION: '6', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo', CHAT_ID: 'chat-6',
    CLAIM_NONCE: 'nonce-6', CLAIM_CONFIRM_STATUS: 'PENDING', CLAIM_CONFIRM_CHAT_ID: 'chat-6',
    CLAIM_RESUMED_AT: 'NONE', ROLLOVER_ATTEMPTS: '0',
  });
  let confirms = 0;
  const first = await orchestrator.tick({ root, browser: {
    async sendClaimConfirmation() { confirms++; return { ok: false, status: 'RATE_LIMITED', rateLimited: true }; },
  }, notifier: {}, rolloverMinutes: 20, clock: () => new Date('2026-09-02T13:00:00Z') });
  const limited = readControl(controlPath);
  assert.equal(first.action, 'RATE_LIMIT_BACKOFF');
  assert.equal(limited.CLAIM_CONFIRM_STATUS, 'RATE_LIMITED');
  assert.equal(limited.ROLLOVER_ATTEMPTS, '0');
  assert.ok(Date.parse(limited.RATE_LIMIT_UNTIL) > Date.parse('2026-09-02T13:00:00Z'));
  const second = await orchestrator.tick({ root, browser: {
    async sendClaimConfirmation() { confirms++; throw new Error('must not retry inside cooldown'); },
  }, notifier: {}, rolloverMinutes: 20, clock: () => new Date('2026-09-02T13:01:00Z') });
  assert.equal(second.action, 'RATE_LIMIT_BACKOFF');
  assert.equal(confirms, 1);
});
test('claim confirmation browser script surfaces ChatGPT too-many-requests as rate limited', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'rate-ui', chatId: 'chat-rate', message: 'confirm',
    verifyLine: 'CLAIM_CONFIRMED rate-ui G2 nonce', attachCommander: true, waitForAssistantStart: true,
  });
  assert.match(script, /too many requests/i);
  assert.match(script, /RATE_LIMITED/);
  assert.match(script, /rateLimited/);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(script));
});
test('claim confirmation uses the stable ChatGPT composer plus button', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'tool-ui', chatId: 'chat-tool', message: 'confirm', verifyLine: 'CLAIM_CONFIRMED tool-ui G2 nonce',
    attachCommander: true, waitForAssistantStart: true,
  });
  assert.match(script, /composer-plus-btn/);
});
test('claim confirmation enters cooldown instead of hammering ChatGPT rate limit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-rate-limit-confirm-'));
  const controlPath = makeRun(root, {
    RUN_ID:'rate-confirm', GENERATION:'6', STATUS:'ACTIVE', PROJECT_ROOT:'C:\\repo', CHAT_ID:'chat-6',
    CLAIMED_AT:'2026-09-02T10:00:00Z', CLAIM_NONCE:'nonce-6', CLAIM_CONFIRM_STATUS:'FAILED',
    CLAIM_CONFIRM_CHAT_ID:'chat-6', CLAIM_CONFIRMED_AT:'NONE', CLAIM_RESUMED_AT:'NONE', ROLLOVER_ATTEMPTS:'0',
  });
  let sends = 0;
  const browser = { async sendClaimConfirmation(){ sends++; return { ok:false, status:'RATE_LIMITED', rateLimited:true }; } };
  const first = await orchestrator.tick({ root, browser, notifier:{}, rolloverMinutes:20, clock:()=>new Date('2026-09-02T10:01:00Z') });
  let state = readControl(controlPath);
  assert.equal(first.action, 'RATE_LIMIT_BACKOFF');
  assert.equal(state.RATE_LIMIT_UNTIL, '2026-09-02T10:03:00.000Z');
  assert.equal(state.ROLLOVER_ATTEMPTS, '0');
  const second = await orchestrator.tick({ root, browser, notifier:{}, rolloverMinutes:20, clock:()=>new Date('2026-09-02T10:02:00Z') });
  state = readControl(controlPath);
  assert.equal(second.action, 'RATE_LIMIT_BACKOFF');
  assert.equal(sends, 1);
  assert.equal(state.GENERATION, '6');
});

test('claim confirmation script detects rate limit and uses current composer plus button', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId:'rate-ui', chatId:'chat-6', message:'confirm', verifyLine:'CLAIM_CONFIRMED rate-ui G6 nonce', attachCommander:true, waitForAssistantStart:true,
  });
  assert.match(script, /composer-plus-btn/);
  assert.match(script, /excesso de solicita/i);
  assert.match(script, /RATE_LIMITED/);
  assert.match(script, /\.evaluate\(\(el\) => el\.click\(\)\)/);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(script));
});
test('claim confirmation recognizes current Desktop Commander attachment label', () => {
  const script = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'tool-label', chatId: 'chat-tool', message: 'confirm', verifyLine: 'CLAIM_CONFIRMED tool-label G2 nonce',
    attachCommander: true, waitForAssistantStart: true,
  });
  assert.match(script, /includes\('Desktop Commander'\)/);
});
test('discovery cannot authorize or rename unknown chat ids', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-discovery-safe-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'safe-run', GENERATION: '4', STATUS: 'ACTIVE', DISPLAY_NAME: 'Safe', PROJECT_ROOT: 'C:\\repo',
    CHAT_ID: 'known-chat', CHAT_HISTORY_JSON: JSON.stringify([{ index: 1, chatId: 'known-chat' }]),
    CLAIM_CONFIRM_STATUS: 'SENT', CLAIM_RESUMED_AT: '2026-09-02T10:00:00Z',
  });
  const renamed = [];
  const browser = {
    async discoverRunChats() { return { taskSpaceId: 77, chats: [
      { chatId: 'known-chat', title: 'Known' }, { chatId: 'foreign-chat', title: 'Private chat' },
    ] }; },
    async renameChats({ chats }) { renamed.push(...chats); return { ok: true }; },
  };
  await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 9999,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.deepEqual(JSON.parse(final.CHAT_HISTORY_JSON), [{ index: 1, chatId: 'known-chat' }]);
  assert.equal(final.CHAT_ID, 'known-chat');
  assert.equal(renamed.some((item) => item.chatId === 'foreign-chat'), false);
});

test('DONE cleanup never waits for or invokes historical bulk rename', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-done-safe-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'done-safe', GENERATION: '8', STATUS: 'DONE', DISPLAY_NAME: 'DoneSafe', PROJECT_ROOT: 'C:\\repo',
    NOTIFICATION_STATUS: 'SENT', CHAT_TITLE_STATUS: 'PENDING', BROWSER_CLEANUP_STATUS: 'PENDING',
    CHAT_HISTORY_JSON: JSON.stringify([{ index: 1, chatId: 'foreign-polluted' }, { index: 2, chatId: 'owned' }]),
  });
  let renameCalls = 0; let cleanupCalls = 0;
  const browser = {
    async renameChats() { renameCalls++; throw new Error('must not bulk rename'); },
    async cleanupRun() { cleanupCalls++; return { closed: true }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 9999,
    clock: () => new Date('2026-09-02T10:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'FINALIZED');
  assert.equal(renameCalls, 0);
  assert.equal(cleanupCalls, 1);
  assert.equal(final.CHAT_TITLE_STATUS, 'SKIPPED_SAFE');
  assert.equal(final.BROWSER_CLEANUP_STATUS, 'SENT');
});

test('successor reuses tracked about blank bootstrap with a known target id', () => {
  const script = egoScript.buildSuccessorScript({ runId: 'blank-run', message: 'baton', nextGeneration: 2 });
  assert.match(script, /listTabs\(\{ includeChrome: true \}\)/);
  assert.match(script, /about:blank/);
  assert.match(script, /successorTargetId = scratch\.targetId/);
  assert.match(script, /page\.goto\('https:\/\/chatgpt\.com\/'/);
});

test('run tab cleanup can see internal tabs instead of filtering about blank away', () => {
  const prune = egoScript.buildPruneRunTabsScript({ runId: 'blank-run', keepChatId: 'chat-current' });
  const close = egoScript.buildCloseRunTargetScript({ runId: 'blank-run', targetId: 'scratch-target' });
  assert.match(prune, /listTabs\(\{ includeChrome: true \}\)/);
  assert.match(close, /listTabs\(\{ includeChrome: true \}\)/);
});
test('active tick removes only run scratch tabs before continuing work', async () => {
  assert.equal(typeof egoScript.buildCleanupRunScratchTabsScript, 'function');
  const script = egoScript.buildCleanupRunScratchTabsScript({ runId: 'scratch-run' });
  assert.match(script, /listTabs\(\{ includeChrome: true \}\)/);
  assert.match(script, /about:/);
  assert.match(script, /chatgpt\.com/);
  assert.match(script, /browser\.closeTab/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-scratch-clean-'));
  makeRun(root, { RUN_ID: 'scratch-run', GENERATION: '1', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo' });
  let cleans = 0;
  const result = await orchestrator.tick({ root, browser: {
    async cleanupRunScratchTabs() { cleans++; return { ok: true, closed: 1 }; },
  }, notifier: {}, rolloverMinutes: 9999, clock: () => new Date('2026-09-02T18:00:00Z') });
  assert.equal(result.action, 'WATCHING');
  assert.equal(cleans, 1);
});
test('failed successor also sweeps residual internal scratch tabs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-browser-error-sweep-'));
  makeRun(root, { RUN_ID: 'sweep-run', GENERATION: '4', STATUS: 'CONTEXT_RISK', PROJECT_ROOT: 'C:\\repo' });
  let sweeps = 0;
  const result = await orchestrator.tick({ root, browser: {
    async createSuccessor() { return { status: 'BROWSER_ERROR', targetId: 'scratch-target' }; },
    async closeRunTarget() { return { ok: true, closed: 1 }; },
    async cleanupRunScratchTabs() { sweeps++; return { ok: true, closed: 1 }; },
  }, notifier: {}, rolloverMinutes: 0, clock: () => new Date('2026-09-02T18:00:00Z') });
  assert.equal(result.action, 'ROLLOVER_INCOMPLETE');
  assert.ok(sweeps >= 1);
});

test('DONE browser cleanup debt never becomes terminally forgotten', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-cleanup-debt-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'cleanup-debt', GENERATION: '7', STATUS: 'DONE', PROJECT_ROOT: 'C:\\repo',
    NOTIFICATION_STATUS: 'SENT', CHAT_TITLE_STATUS: 'SKIPPED_SAFE', BROWSER_CLEANUP_STATUS: 'PENDING',
  });
  let nowMs = Date.parse('2026-09-02T20:00:00Z');
  const browser = { async cleanupRun() { throw new Error('transient close failure'); } };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = await orchestrator.tick({ root, browser, notifier: {}, clock: () => new Date(nowMs), runId: 'cleanup-debt' });
    const state = readControl(controlPath);
    assert.equal(result.action, 'BROWSER_CLEANUP_RETRY');
    assert.equal(state.BROWSER_CLEANUP_STATUS, 'RETRY_SCHEDULED');
    assert.equal(state.BROWSER_CLEANUP_ATTEMPTS, String(attempt));
    assert.notEqual(state.CLEANUP_DEBT_SINCE, 'NONE');
    assert.notEqual(state.BROWSER_CLEANUP_NEXT_AT, 'NONE');
    nowMs = Date.parse(state.BROWSER_CLEANUP_NEXT_AT) + 1;
  }
  assert.notEqual(readControl(controlPath).BROWSER_CLEANUP_STATUS, 'GAVE_UP');
});

test('resolver services due cleanup debt but not future cleanup debt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-cleanup-resolver-'));
  makeRun(root, {
    RUN_ID: 'future-debt', STATUS: 'DONE', NOTIFICATION_STATUS: 'SENT', CHAT_TITLE_STATUS: 'SKIPPED_SAFE',
    BROWSER_CLEANUP_STATUS: 'RETRY_SCHEDULED', BROWSER_CLEANUP_NEXT_AT: '2999-01-01T00:00:00.000Z',
  });
  makeRun(root, {
    RUN_ID: 'due-debt', STATUS: 'DONE', NOTIFICATION_STATUS: 'SENT', CHAT_TITLE_STATUS: 'SKIPPED_SAFE',
    BROWSER_CLEANUP_STATUS: 'RETRY_SCHEDULED', BROWSER_CLEANUP_NEXT_AT: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(resolveRun(root, { includePendingDone: true }).RUN_ID, 'due-debt');
});


test('submitted successor preserves exact target id for cleanup fallback', () => {
  const script = egoScript.buildSuccessorScript({ runId: 'submitted-target', message: 'baton', nextGeneration: 2 });
  assert.match(script, /status: 'SUBMITTED',\s*taskSpaceId: task.id,\s*targetId: successorTargetId,\s*chatId:/);
});

test('failed successor falls back to exact target when chat close is not verified', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-close-fallback-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'close-fallback', GENERATION: '4', STATUS: 'CONTEXT_RISK', PROJECT_ROOT: 'C:\\repo',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z',
  });
  const calls = [];
  const browser = {
    async createSuccessor() { return { status: 'BROWSER_ERROR', chatId: 'failed-chat', targetId: 'failed-target' }; },
    async closeRunChat() { calls.push('chat'); return { ok: false, status: 'CLOSE_INCOMPLETE' }; },
    async closeRunTarget({ targetId }) { calls.push(`target:${targetId}`); return { ok: true, status: 'CLOSED_TARGET' }; },
    async cleanupRunScratchTabs() { calls.push('scratch'); return { ok: true }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z') });
  assert.equal(result.action, 'ROLLOVER_INCOMPLETE');
  assert.deepEqual(calls, ['scratch', 'chat', 'target:failed-target', 'scratch']);
  assert.equal(readControl(controlPath).GENERATION, '4');
});

test('unverified failed-successor target becomes durable orphan cleanup debt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-orphan-debt-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'orphan-debt', GENERATION: '4', STATUS: 'CONTEXT_RISK', PROJECT_ROOT: 'C:\\repo',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z',
  });
  const browser = {
    async createSuccessor() { return { status: 'BROWSER_ERROR', chatId: 'bad-chat', targetId: 'bad-target' }; },
    async closeRunChat() { return { ok: false }; },
    async closeRunTarget() { return { ok: false }; },
    async cleanupRunScratchTabs() { return { ok: true }; },
  };
  await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z') });
  const state = readControl(controlPath);
  assert.equal(state.BROWSER_ORPHAN_TARGET_ID, 'bad-target');
  assert.equal(state.BROWSER_ORPHAN_STATUS, 'RETRY_SCHEDULED');
  assert.notEqual(state.BROWSER_ORPHAN_DEBT_SINCE, 'NONE');
});

test('orphan cleanup debt is paid before normal active-run work resumes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-orphan-retry-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'orphan-retry', GENERATION: '4', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo',
    STARTED_AT: '2026-09-02T20:00:00Z', CLAIMED_AT: '2026-09-02T20:00:00Z',
    BROWSER_ORPHAN_TARGET_ID: 'stale-target', BROWSER_ORPHAN_STATUS: 'RETRY_SCHEDULED',
    BROWSER_ORPHAN_NEXT_AT: '2000-01-01T00:00:00.000Z', BROWSER_ORPHAN_ATTEMPTS: '2',
  });
  const calls = [];
  const browser = {
    async closeRunTarget({ targetId }) { calls.push(targetId); return { ok: true }; },
    async cleanupRunScratchTabs() { return { ok: true }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 20,
    clock: () => new Date('2026-09-02T20:01:00Z') });
  const state = readControl(controlPath);
  assert.equal(result.action, 'WATCHING');
  assert.deepEqual(calls, ['stale-target']);
  assert.equal(state.BROWSER_ORPHAN_STATUS, 'SENT');
  assert.equal(state.BROWSER_ORPHAN_TARGET_ID, 'NONE');
});

test('successor and claim confirmation embed the same Commander bootstrap primitive', () => {
  const { buildCommanderSetupScript } = require('./src/browser/commander-script');
  const shared = buildCommanderSetupScript().trim();
  const successor = egoScript.buildSuccessorScript({ runId: 'shared-commander', message: 'baton', nextGeneration: 2 });
  const confirmation = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'shared-commander', chatId: 'chat-2', message: 'confirm',
    verifyLine: 'CLAIM_CONFIRMED shared-commander G2 nonce', attachCommander: true, waitForAssistantStart: true,
  });
  assert.ok(successor.includes(shared));
  assert.ok(confirmation.includes(shared));
  assert.match(shared, /composer-plus-btn/);
  assert.match(shared, /Desktop Commander/);
  assert.match(shared, /Remote Desktop Commander/);
});

test('first-party Edge launch policy starts CDP without a bootstrap page', () => {
  const { buildEdgeLaunchArgs } = require('./src/browser/edge-host');
  const args = buildEdgeLaunchArgs({ port: 9522, userDataDir: 'C:\\state\\profile' });
  assert.ok(args.includes('--remote-debugging-port=9522'));
  assert.ok(args.includes('--user-data-dir=C:\\state\\profile'));
  assert.ok(args.includes('--no-startup-window'));
  assert.equal(args.includes('about:blank'), false);
});

test('ego transport ensures the first-party Edge host before vendor execution', async () => {
  const { EventEmitter } = require('node:events');
  const { runEgoScript } = require('./src/browser/ego-browser');
  const order = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = { end() { setImmediate(() => { child.stdout.emit('data', 'PERSISTD_RESULT:{\"ok\":true}\n'); child.emit('close', 0); }); } };
  child.kill = () => {};
  const result = await runEgoScript('test-script', { command: process.execPath,
    ensureBrowser: async () => { order.push('ensure'); },
    spawnFn: () => { order.push('spawn'); return child; } });
  assert.deepEqual(order, ['ensure', 'spawn']);
  assert.deepEqual(result, { ok: true });
});


test('successor and confirmation share one Commander bootstrap implementation', () => {
  const { buildCommanderSetupScript } = require('./src/browser/commander-script');
  const shared = buildCommanderSetupScript();
  const successor = egoScript.buildSuccessorScript({ runId: 'bootstrap-shared', message: 'baton', nextGeneration: 2 });
  const confirmation = require('./src/browser/conversation-script').buildSendMessageScript({
    runId: 'bootstrap-shared', chatId: 'chat-2', message: 'confirm', verifyLine: 'CLAIM_CONFIRMED bootstrap-shared G2 nonce', attachCommander: true,
  });
  assert.match(shared, /PERSISTD_COMMANDER_BOOTSTRAP_V1/);
  assert.match(shared, /composer-plus-btn/);
  assert.match(shared, /Desktop Commander/);
  assert.ok(successor.includes(shared));
  assert.ok(confirmation.includes(shared));
});

test('rollover preflight blocks before nonce when browser control is unhealthy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-health-block-'));
  const controlPath = makeRun(root, { RUN_ID: 'health-block', GENERATION: '2', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-02T20:00:00Z' });
  let creates = 0;
  const result = await orchestrator.tick({ root, browser: { async createSuccessor() { creates++; } }, notifier: {}, rolloverMinutes: 0,
    remoteHealth: { async preflight() { return { ok: false, browser: 'UNHEALTHY', desktop: 'UNKNOWN', repaired: false }; } },
    clock: () => new Date('2026-09-02T20:30:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'REMOTE_CONTROL_RETRY');
  assert.equal(creates, 0);
  assert.equal(final.STATUS, 'WAITING_TOOL');
  assert.equal(final.REMOTE_BROWSER_HEALTH, 'UNHEALTHY');
  assert.equal(final.CLAIM_NONCE, undefined);
});
test('rollover preflight surfaces an authentication boundary without remote-control retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-health-auth-'));
  const controlPath = makeRun(root, { RUN_ID: 'health-auth', GENERATION: '2', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-02T20:00:00Z' });
  let creates = 0;
  const result = await orchestrator.tick({ root, browser: { async createSuccessor() { creates++; } }, notifier: {}, rolloverMinutes: 0,
    remoteHealth: { async preflight() { return { ok: false, browser: 'AUTH_REQUIRED', desktop: 'HEALTHY', repaired: false }; } },
    clock: () => new Date('2026-09-02T20:30:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'AUTH_REQUIRED');
  assert.equal(creates, 0);
  assert.equal(final.STATUS, 'AUTH_REQUIRED');
  assert.equal(final.BLOCKED_REASON, 'AUTH_REQUIRED');
  assert.equal(final.REMOTE_BROWSER_HEALTH, 'AUTH_REQUIRED');
});

test('rollover preflight records successful desktop self-heal and continues', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-health-repair-'));
  const controlPath = makeRun(root, { RUN_ID: 'health-repair', GENERATION: '2', STATUS: 'ACTIVE', PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-02T20:00:00Z' });
  const browser = { async createSuccessor() { return { status: 'BROWSER_ERROR', targetId: 'scratch' }; }, async closeRunTarget() { return { ok: true, closed: 1 }; } };
  await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    remoteHealth: { async preflight() { return { ok: true, browser: 'HEALTHY', desktop: 'HEALTHY', repaired: true }; } },
    clock: () => new Date('2026-09-02T20:31:00Z') });
  const final = readControl(controlPath);
  assert.equal(final.REMOTE_BROWSER_HEALTH, 'HEALTHY');
  assert.equal(final.REMOTE_DESKTOP_HEALTH, 'HEALTHY');
  assert.equal(final.REMOTE_HEALTH_REPAIRED, 'true');
});
test('browser transport archives one authoritative predecessor chat', async () => {
  const egoScript = require('./src/browser/ego-script');
  assert.equal(typeof egoScript.buildArchiveRunChatScript, 'function');
  const script = egoScript.buildArchiveRunChatScript({ runId: 'archive-run', chatId: 'chat-old' });
  assert.match(script, /chat-old/);
  assert.match(script, /Arquivar|Archive/);
  const seen = [];
  const transport = createEgoBrowserTransport({ runner: async (code) => {
    seen.push(code);
    return { status: 'ARCHIVED', ok: true, chatId: 'chat-old' };
  } });
  assert.equal(typeof transport.archiveRunChat, 'function');
  const result = await transport.archiveRunChat({ state: { RUN_ID: 'archive-run' }, chatId: 'chat-old' });
  assert.equal(result.ok, true);
  assert.match(seen[0], /chat-old/);
});

test('archives predecessor only after durable successor promotion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-archive-rollover-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'archive-rollover', GENERATION: '1', STATUS: 'CONTEXT_RISK', DISPLAY_NAME: 'Archive',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:00:00Z',
    CHAT_ID: 'chat-old', PROJECT_ROOT: 'C:\\repo',
  });
  const archiveCalls = [];
  const browser = {
    async createSuccessor({ state, nextGeneration, controlPath: pathToControl }) {
      writeControlAtomic(pathToControl, { ...state, GENERATION: String(nextGeneration), STATUS: 'ACTIVE',
        CLAIMED_AT: '2026-09-01T12:01:00Z', LEASE_OWNER: `G${nextGeneration}` });
      return { chatId: 'chat-new', taskSpaceId: 99, evidence: 'durable-claim' };
    },
    async archiveRunChat(payload) { archiveCalls.push(payload); return { ok: true, status: 'ARCHIVED' }; },
    async pruneRunTabs() { return { ok: true, closed: 1, remaining: 1 }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 0,
    clock: () => new Date('2026-09-01T12:01:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'ROLLED_OVER');
  assert.equal(final.GENERATION, '2');
  assert.equal(final.BROWSER_ARCHIVE_STATUS, 'SENT');
  assert.equal(final.BROWSER_ARCHIVE_CHAT_ID, 'chat-old');
  assert.equal(archiveCalls.length, 1);
  assert.equal(archiveCalls[0].chatId, 'chat-old');
});

test('archive failure becomes durable debt and retries on the next tick', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-archive-retry-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'archive-retry', GENERATION: '2', STATUS: 'ACTIVE', DISPLAY_NAME: 'Archive',
    STARTED_AT: '2026-09-01T12:00:00Z', CLAIMED_AT: '2026-09-01T12:59:00Z',
    CHAT_ID: 'chat-new', BROWSER_ARCHIVE_STATUS: 'FAILED', BROWSER_ARCHIVE_CHAT_ID: 'chat-old',
    BROWSER_ARCHIVE_DEBT_SINCE: '2026-09-01T12:58:00Z', PROJECT_ROOT: 'C:\\repo',
  });
  let archiveCalls = 0;
  const browser = {
    async archiveRunChat({ chatId }) {
      archiveCalls++;
      assert.equal(chatId, 'chat-old');
      return { ok: true, status: 'ARCHIVED' };
    },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, rolloverMinutes: 20,
    clock: () => new Date('2026-09-01T13:00:00Z') });
  const final = readControl(controlPath);
  assert.equal(result.action, 'WATCHING');
  assert.equal(archiveCalls, 1);
  assert.equal(final.BROWSER_ARCHIVE_STATUS, 'SENT');
  assert.equal(final.BROWSER_ARCHIVE_DEBT_SINCE, 'NONE');
});

test('remote authority heartbeat drives the local watchdog before rollover decisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-remote-heartbeat-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'local-run', REMOTE_RUN_ID: 'remote-run', GENERATION: '2', STATUS: 'ACTIVE',
    PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-16T11:59:00Z',
    CONTROLLER_HEARTBEAT_AT: '2026-09-16T12:02:30Z', CURRENT_STATE: 'local old',
  });
  const remoteAuthority = {
    async inspectRun(runId) {
      assert.equal(runId, 'remote-run');
      return { runId, generation: 2, status: 'ACTIVE', controllerHeartbeatAt: '2026-09-16T12:00:00Z',
        progress: 'remote fresh', nextSafeAction: 'resume safely', updatedAt: '2026-09-16T12:00:01Z' };
    },
  };
  const result = await orchestrator.tick({ root, browser: {}, notifier: {}, remoteAuthority,
    clock: () => new Date('2026-09-16T12:03:00Z'), rolloverMinutes: 20,
    watchdogStallMs: 2 * 60_000, watchdogRecoveryMs: 4 * 60_000 });
  const final = readControl(controlPath);
  assert.equal(result.action, 'SUSPECTED_STALL');
  assert.equal(final.CONTROLLER_HEARTBEAT_AT, '2026-09-16T12:00:00Z');
  assert.equal(final.CURRENT_STATE, 'remote fresh');
  assert.equal(final.NEXT_SAFE_ACTION, 'resume safely');
});

test('remote generation ahead fails closed without creating a successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-remote-ahead-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'local-ahead', REMOTE_RUN_ID: 'remote-ahead', GENERATION: '2', STATUS: 'ACTIVE',
    PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-16T12:00:00Z',
  });
  let creates = 0;
  const remoteAuthority = {
    async inspectRun() { return { runId: 'remote-ahead', generation: 3, status: 'ACTIVE' }; },
  };
  const result = await orchestrator.tick({ root, browser: { async createSuccessor() { creates++; } }, notifier: {},
    remoteAuthority, clock: () => new Date('2026-09-16T12:10:00Z'), rolloverMinutes: 0 });
  const final = readControl(controlPath);
  assert.equal(result.action, 'REMOTE_GENERATION_AHEAD');
  assert.equal(creates, 0);
  assert.equal(final.GENERATION, '2');
  assert.equal(final.REMOTE_GENERATION, '3');
});

test('successful local rollover advances the mapped remote generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-remote-sync-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'local-sync', REMOTE_RUN_ID: 'remote-sync', GENERATION: '2', STATUS: 'CONTEXT_RISK',
    PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-16T12:00:00Z', CLAIMED_AT: '2026-09-16T12:00:00Z',
    CHAT_ID: 'chat-g2', CURRENT_STATE: 'before rollover', NEXT_SAFE_ACTION: 'continue',
  });
  const syncCalls = [];
  const remoteAuthority = {
    async inspectRun() { return { runId: 'remote-sync', generation: 2, status: 'ACTIVE', controllerHeartbeatAt: '2026-09-16T11:50:00Z' }; },
    async syncGeneration(runId, input) { syncCalls.push({ runId, input }); return { runId, generation: 3, status: 'ACTIVE' }; },
  };
  const browser = {
    async createSuccessor({ state, nextGeneration, controlPath: target }) {
      writeControlAtomic(target, { ...state, GENERATION: String(nextGeneration), STATUS: 'ACTIVE',
        CLAIMED_AT: '2026-09-16T12:10:00Z', LEASE_OWNER: `G${nextGeneration}` });
      return { chatId: 'chat-g3', taskSpaceId: 99, evidence: 'durable-claim' };
    },
    async archiveRunChat() { return { ok: true }; },
    async pruneRunTabs() { return { ok: true, closed: 1, remaining: 1 }; },
  };
  const result = await orchestrator.tick({ root, browser, notifier: {}, remoteAuthority,
    clock: () => new Date('2026-09-16T12:10:00Z'), rolloverMinutes: 0 });
  assert.equal(result.action, 'ROLLED_OVER');
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].runId, 'remote-sync');
  assert.equal(syncCalls[0].input.expectedGeneration, 2);
  assert.equal(syncCalls[0].input.generation, 3);
  assert.equal(readControl(controlPath).REMOTE_SYNC_STATUS, 'SENT');
});

test('remote sync debt retries without creating another successor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persistd-remote-sync-retry-'));
  const controlPath = makeRun(root, {
    RUN_ID: 'local-retry', REMOTE_RUN_ID: 'remote-retry', GENERATION: '3', STATUS: 'ACTIVE',
    PROJECT_ROOT: 'C:\\repo', STARTED_AT: '2026-09-16T12:00:00Z', CLAIMED_AT: '2026-09-16T12:09:00Z',
    CLAIM_RESUMED_AT: '2026-09-16T12:09:30Z', REMOTE_SYNC_STATUS: 'FAILED', CHAT_ID: 'chat-g3',
    CONTROLLER_HEARTBEAT_AT: '2026-09-16T12:09:30Z', CURRENT_STATE: 'g3 alive', NEXT_SAFE_ACTION: 'continue g3',
  });
  let creates = 0; let syncs = 0;
  const remoteAuthority = {
    async inspectRun() { return { runId: 'remote-retry', generation: 2, status: 'ACTIVE' }; },
    async syncGeneration(runId, input) {
      syncs++; assert.equal(runId, 'remote-retry'); assert.equal(input.expectedGeneration, 2); assert.equal(input.generation, 3);
      return { runId, generation: 3, status: 'ACTIVE', updatedAt: '2026-09-16T12:10:00Z' };
    },
  };
  const result = await orchestrator.tick({ root, browser: { async createSuccessor() { creates++; } }, notifier: {}, remoteAuthority,
    clock: () => new Date('2026-09-16T12:10:00Z'), rolloverMinutes: 20 });
  assert.equal(result.action, 'WATCHING');
  assert.equal(syncs, 1);
  assert.equal(creates, 0);
  assert.equal(readControl(controlPath).REMOTE_SYNC_STATUS, 'SENT');
});

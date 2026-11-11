const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ensureEdgeBrowser, pruneManagedEdgeTargets } = require('./src/browser/edge-host');

function unavailableFetch() {
  return Promise.resolve({ ok: false });
}

function baseOptions(child) {
  return {
    platform: 'win32',
    env: { EGO_HOST_DEBUG_PORT: '9877', LOCALAPPDATA: process.cwd() },
    browserPath: 'fake-edge.exe',
    fetchFn: unavailableFetch,
    spawnFn: () => child,
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test('Edge spawn errors reject ensureEdgeBrowser instead of escaping as an unhandled event', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const promise = ensureEdgeBrowser({ ...baseOptions(child), timeoutMs: 1000 });
  setImmediate(() => child.emit('error', new Error('spawn boom')));
  await assert.rejects(promise, /PERSISTD_EDGE_SPAWN_ERROR:spawn boom/);
});
test('Edge startup timeout terminates the child process created by persistd', async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  let killCalls = 0;
  child.kill = () => {
    killCalls += 1;
    setImmediate(() => child.emit('close', 1));
    return true;
  };
  await assert.rejects(
    ensureEdgeBrowser({ ...baseOptions(child), timeoutMs: 5 }),
    /PERSISTD_EDGE_CDP_TIMEOUT:9877/,
  );
  assert.equal(killCalls, 1);
});
test('managed preservation sweep closes scratch and stale chats but keeps Gn', async () => {
  const closed = [];
  const fetchFn = async (url) => {
    if (url.endsWith('/json/list')) return { ok: true, json: async () => [
      { id: 'keep', type: 'page', url: 'https://chatgpt.com/c/chat-6' },
      { id: 'old', type: 'page', url: 'https://chatgpt.com/c/chat-5' },
      { id: 'scratch', type: 'page', url: 'about:blank' },
      { id: 'other', type: 'page', url: 'https://example.com/' },
    ] };
    const match = /\/json\/close\/(.+)$/.exec(url);
    if (match) { closed.push(decodeURIComponent(match[1])); return { ok: true, status: 200 }; }
    return { ok: false, status: 404 };
  };
  const result = await pruneManagedEdgeTargets({
    env: { EGO_HOST_DEBUG_PORT: '9522' }, keepChatId: 'chat-6', staleChatIds: ['chat-5'], fetchFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.closed, 2);
  assert.deepEqual(closed.sort(), ['old', 'scratch']);
});

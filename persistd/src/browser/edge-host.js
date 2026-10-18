const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_PORT = 9522;
const DEFAULT_WINDOW = { width: 1440, height: 960 };

function buildEdgeLaunchArgs({ port = DEFAULT_PORT, userDataDir, windowSize = DEFAULT_WINDOW, headless = false }) {
  if (!userDataDir) throw new Error('EDGE_USER_DATA_DIR_REQUIRED');
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${windowSize.width},${windowSize.height}`,
    ...(headless ? ['--headless=new'] : []),
    '--no-startup-window',
  ];
}

async function browserEndpoint(port = DEFAULT_PORT, fetchFn = fetch) {
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) return null;
    const info = await response.json();
    return typeof info?.webSocketDebuggerUrl === 'string' ? info : null;
  } catch { return null; }
}
function resolveStateDir(env = process.env) {
  if (env.EGO_HOST_STATE_DIR) return env.EGO_HOST_STATE_DIR;
  const local = env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(local, 'ego-windows-host');
}

async function stopOwnedChild(child, { sleep, timeoutMs = 5000 } = {}) {
  if (!child || typeof child.kill !== 'function') return true;
  if (child.exitCode !== undefined && child.exitCode !== null) return true;
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let closed = false;
  let resolveClosed;
  const closePromise = new Promise((resolve) => { resolveClosed = resolve; });
  if (typeof child.once === 'function') child.once('close', () => { closed = true; resolveClosed(); });
  let signaled = false;
  try { signaled = child.kill() !== false; } catch { signaled = false; }
  if (!signaled) return false;
  await Promise.race([closePromise, wait(timeoutMs)]);
  return closed || (child.exitCode !== undefined && child.exitCode !== null);
}

async function ensureEdgeBrowser(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { launched: false, skipped: true };
  const env = options.env || process.env;
  const port = Number(env.EGO_HOST_DEBUG_PORT) || DEFAULT_PORT;
  const fetchFn = options.fetchFn || fetch;
  const existing = await browserEndpoint(port, fetchFn);
  if (existing) return { endpoint: existing, launched: false };
  const browserPath = options.browserPath || env.EGO_HOST_BROWSER_PATH;
  if (!browserPath) throw new Error('PERSISTD_EDGE_BROWSER_PATH_MISSING');
  const userDataDir = path.join(resolveStateDir(env), 'profile');
  fs.mkdirSync(userDataDir, { recursive: true });
  const args = buildEdgeLaunchArgs({ port, userDataDir, headless: env.EGO_HOST_HEADLESS === '1' || env.EGO_HOST_HEADLESS === 'true' });
  const spawnFn = options.spawnFn || spawn;
  const child = spawnFn(browserPath, args, { detached: true, stdio: 'ignore' });
  let spawnError = null;
  if (child?.on) child.on('error', (error) => { spawnError = error; });
  if (child?.unref) child.unref();
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.timeoutMs || 20000);
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`PERSISTD_EDGE_SPAWN_ERROR:${spawnError.message || spawnError}`);
    const endpoint = await browserEndpoint(port, fetchFn);
    if (endpoint) return { endpoint, launched: true, args, userDataDir };
    await sleep(250);
  }
  if (spawnError) throw new Error(`PERSISTD_EDGE_SPAWN_ERROR:${spawnError.message || spawnError}`);
  const stopped = await stopOwnedChild(child, { sleep, timeoutMs: options.cleanupTimeoutMs || 5000 });
  if (!stopped) throw new Error(`PERSISTD_EDGE_CLEANUP_TIMEOUT:${port}`);
  throw new Error(`PERSISTD_EDGE_CDP_TIMEOUT:${port}`);
}

function chatIdFromUrl(url) {
  const match = /\/c\/([^/?#]+)/.exec(String(url || ''));
  return match ? match[1] : null;
}

function isManagedScratchUrl(url) {
  const value = String(url || '').toLowerCase();
  return value === '' || value === 'about:blank' || value === 'data:,'
    || value.startsWith('edge://newtab') || value.startsWith('chrome://newtab');
}

async function pruneManagedEdgeTargets({ env = process.env, keepChatId = null, staleChatIds = [], fetchFn = fetch } = {}) {
  const port = Number(env.EGO_HOST_DEBUG_PORT) || DEFAULT_PORT;
  let response;
  try { response = await fetchFn(`http://127.0.0.1:${port}/json/list`); }
  catch (error) { return { ok: false, closed: 0, considered: 0, error: error?.message || String(error) }; }
  if (!response?.ok) return { ok: false, closed: 0, considered: 0, error: `CDP_LIST_HTTP_${response?.status || 'ERROR'}` };
  let targets;
  try { targets = await response.json(); }
  catch (error) { return { ok: false, closed: 0, considered: 0, error: `CDP_LIST_INVALID:${error?.message || error}` }; }
  if (!Array.isArray(targets)) return { ok: false, closed: 0, considered: 0, error: 'CDP_LIST_NOT_ARRAY' };
  const stale = new Set((staleChatIds || []).filter(Boolean).map(String));
  const candidates = targets.filter((target) => {
    if (target?.type && target.type !== 'page') return false;
    const id = target?.id || target?.targetId;
    if (!id) return false;
    const chatId = chatIdFromUrl(target?.url);
    if (chatId && keepChatId && chatId === String(keepChatId)) return false;
    return isManagedScratchUrl(target?.url) || Boolean(chatId && stale.has(chatId));
  });
  let closed = 0;
  const errors = [];
  for (const target of candidates) {
    const id = target.id || target.targetId;
    try {
      const close = await fetchFn(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`);
      if (close?.ok) closed += 1;
      else errors.push(`${id}:HTTP_${close?.status || 'ERROR'}`);
    } catch (error) { errors.push(`${id}:${error?.message || error}`); }
  }
  return { ok: errors.length === 0, closed, considered: candidates.length, errors };
}
module.exports = {
  DEFAULT_PORT,
  buildEdgeLaunchArgs,
  browserEndpoint,
  resolveStateDir,
  ensureEdgeBrowser,
  chatIdFromUrl,
  isManagedScratchUrl,
  pruneManagedEdgeTargets,
};

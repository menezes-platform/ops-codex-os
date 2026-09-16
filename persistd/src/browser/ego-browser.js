const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const {
  buildSuccessorScript, buildTerminalScript, buildRenameChatsScript, buildArchiveRunChatScript, buildDiscoverRunChatsScript, buildCloseRunChatScript, buildCloseRunTargetScript, buildCleanupRunScratchTabsScript, buildPruneRunTabsScript, buildRunChatActivityScript, buildCleanupScript, buildHealthScript, parseEgoResult,
} = require('./ego-script');
const { buildFindAssistantLineScript, buildSendMessageScript } = require('./conversation-script');
const { ensureEdgeBrowser } = require('./edge-host');

function parseWindowsShim(text) {
  const match = text.match(/^\s*"([^"\r\n]*node\.exe)"\s+"([^"\r\n]+\.mjs)"\s+%\*\s*$/mi);
  if (!match) throw new Error('EGO_WINDOWS_SHIM_UNSUPPORTED');
  return { command: match[1], prefixArgs: [match[2]] };
}

function resolveWindowsShim(command) {
  let target = command;
  if (!/[\\/]/.test(command)) {
    const candidates = execFileSync('where.exe', [command], { encoding: 'utf8' })
      .split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    target = candidates.find((item) => /\.cmd$/i.test(item)) || candidates[0];
  }
  if (!target) throw new Error(`EGO_COMMAND_NOT_FOUND:${command}`);
  if (/\.cmd$/i.test(target)) return parseWindowsShim(fs.readFileSync(target, 'utf8'));
  return { command: target, prefixArgs: [] };
}

function buildInvocation({ command, platform = process.platform, resolveWindowsShim: resolveShim = resolveWindowsShim }) {
  if (platform === 'win32') {
    const resolved = resolveShim(command);
    return {
      command: resolved.command,
      args: [...(resolved.prefixArgs || []), 'nodejs'],
      pipeStdin: true,
      shell: false,
    };
  }
  return { command, args: ['nodejs'], pipeStdin: true, shell: false };
}

function resolvePersistdBrowserEnv({ env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  const next = { ...env };
  if (platform !== 'win32' || next.EGO_HOST_BROWSER_PATH) return next;
  const drive = next.SystemDrive || 'C:';
  const roots = [
    next['PROGRAMFILES(X86)'],
    path.win32.join(`${drive}\\`, 'Program Files (x86)'),
    next.PROGRAMFILES,
    path.win32.join(`${drive}\\`, 'Program Files'),
  ].filter(Boolean);
  for (const root of [...new Set(roots)]) {
    const candidate = path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (exists(candidate)) { next.EGO_HOST_BROWSER_PATH = candidate; break; }
  }
  return next;
}

async function runEgoScript(script, { command = 'ego-browser', timeoutMs = 120000, env = process.env, ensureBrowser = ensureEdgeBrowser, spawnFn = spawn } = {}) {
  const browserEnv = resolvePersistdBrowserEnv({ env });
  await ensureBrowser({ env: browserEnv });
  return new Promise((resolve, reject) => {
    const invocation = buildInvocation({ command });
    const child = spawnFn(invocation.command, invocation.args, {
      shell: invocation.shell,
      windowsHide: true,
      env: browserEnv,
      stdio: [invocation.pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`EGO_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const result = parseEgoResult(stdout);
        if (code !== 0 && !result) throw new Error(`EGO_EXIT_${code}:${stderr}`);
        resolve(result);
      } catch (error) {
        reject(new Error(`EGO_EXIT_${code}:${error.message}:${stderr || stdout}`));
      }
    });
    if (invocation.pipeStdin) child.stdin.end(script);
  });
}

function createEgoBrowserTransport(options = {}) {
  const { runner = runEgoScript, ...runOptions } = options;
  const run = (script, overrides = {}) => runner(script, { ...runOptions, ...overrides });
  const successorTimeoutMs = Math.max(Number(runOptions.timeoutMs) || 0, 210000);
  return {
    async createSuccessor({ state, message, nextGeneration }) {
      return run(buildSuccessorScript({ runId: state.RUN_ID, message, nextGeneration }), { timeoutMs: successorTimeoutMs });
    },
    async healthCheck({ state } = {}) {
      return run(buildHealthScript({ runId: state?.RUN_ID || 'health' }), { timeoutMs: 15000 });
    },
    async sendTerminalNotification({ state, message }) {
      if (!state.CHAT_ID || state.CHAT_ID === 'NONE') return { sent: false, status: 'CHAT_ID_MISSING' };
      return run(buildTerminalScript({ runId: state.RUN_ID, chatId: state.CHAT_ID, message }));
    },
    async verifyAssistantLine({ state, chatId, line }) {
      return run(buildFindAssistantLineScript({ runId: state.RUN_ID, chatId, line }));
    },
    async sendClaimConfirmation({ state, chatId, generation, nonce }) {
      const line = `CLAIM_CONFIRMED ${state.RUN_ID} G${generation} ${nonce}`;
      const message = `${line}\n\nThe durable controller promotion is recorded. Continue the exact project work from the baton now.`;
      return run(buildSendMessageScript({ runId: state.RUN_ID, chatId, message, verifyLine: line, attachCommander: true, waitForAssistantStart: true }));
    },
    async renameChat({ state, chatId, title }) {
      return run(buildRenameChatsScript({ runId: state.RUN_ID, chats: [{ chatId, title }] }));
    },
    async renameChats({ state, chats }) {
      return run(buildRenameChatsScript({ runId: state.RUN_ID, chats }));
    },
    async archiveRunChat({ state, chatId }) {
      return run(buildArchiveRunChatScript({ runId: state.RUN_ID, chatId }));
    },
    async discoverRunChats({ state }) {
      return run(buildDiscoverRunChatsScript({ runId: state.RUN_ID }));
    },
    async closeRunChat({ state, chatId }) {
      return run(buildCloseRunChatScript({ runId: state.RUN_ID, chatId }));
    },
    async closeRunTarget({ state, targetId }) {
      return run(buildCloseRunTargetScript({ runId: state.RUN_ID, targetId }));
    },
    async cleanupRunScratchTabs({ state }) {
      return run(buildCleanupRunScratchTabsScript({ runId: state.RUN_ID }));
    },
    async pruneRunTabs({ state, keepChatId }) {
      return run(buildPruneRunTabsScript({ runId: state.RUN_ID, keepChatId }));
    },
    async isRunChatBusy({ state, chatId }) {
      return run(buildRunChatActivityScript({ runId: state.RUN_ID, chatId }));
    },
    async cleanupRun({ state }) {
      return run(buildCleanupScript({ runId: state.RUN_ID }));
    },
  };
}

module.exports = {
  parseWindowsShim,
  resolveWindowsShim,
  buildInvocation,
  resolvePersistdBrowserEnv,
  runEgoScript,
  createEgoBrowserTransport,
};

#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = os.homedir();
const codexDir = path.join(home, '.codex');
const hooksPath = path.join(codexDir, 'hooks.json');
const thinHook = path.join(home, '.agents', 'persistd', 'src', 'codex-thin-controller-hook.js');
const optimizer = path.join(home, '.agents', 'skills', 'token-optimizer', 'scripts', 'codex_hook_bridge.py');
const python = process.env.THIN_CONTROLLER_PYTHON || 'python';
const node = process.execPath;

function quote(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

function loadHooks() {
  try { return JSON.parse(fs.readFileSync(hooksPath, 'utf8')); } catch { return { hooks: {} }; }
}

function saveHooks(config) {
  fs.mkdirSync(codexDir, { recursive: true });
  const tmp = hooksPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, hooksPath);
}

function commandHook(command, timeout = 8) {
  return { type: 'command', command, commandWindows: command, timeout };
}

function signature(entry) {
  return JSON.stringify(entry);
}

function ensureEvent(config, event) {
  config.hooks ||= {};
  config.hooks[event] ||= [];
  return config.hooks[event];
}

function addUnique(config, event, entry) {
  const group = ensureEvent(config, event);
  const wanted = signature(entry);
  if (!group.some((item) => signature(item) === wanted)) group.push(entry);
}

function pruneBrokenRunnerEntries(config) {
  let removed = 0;
  for (const [event, groups] of Object.entries(config.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((hook) => {
        const command = String(hook.commandWindows || hook.command || '');
        return !/\.agents[\\/]hooks[\\/]run\.py/i.test(command);
      });
      removed += before - group.hooks.length;
    }
    config.hooks[event] = groups.filter((group) => Array.isArray(group?.hooks) && group.hooks.length > 0);
  }
  return removed;
}

function addOptimizerBridge(config, event, mode, timeout) {
  if (!fs.existsSync(optimizer)) return false;
  const command = quote(python) + ' ' + quote(optimizer) + ' ' + mode;
  addUnique(config, event, { hooks: [commandHook(command, timeout)] });
  return true;
}

function addThinHook(config, event, mode, { matcher = null, timeout = 8 } = {}) {
  const command = quote(node) + ' ' + quote(thinHook) + ' ' + mode;
  const entry = { hooks: [commandHook(command, timeout)] };
  if (matcher) entry.matcher = matcher;
  addUnique(config, event, entry);
}

const config = loadHooks();
const removedBroken = pruneBrokenRunnerEntries(config);
const optimizerAdded = [
  addOptimizerBridge(config, 'SessionStart', 'session-start', 12),
  addOptimizerBridge(config, 'UserPromptSubmit', 'user-prompt-submit', 12),
  addOptimizerBridge(config, 'SubagentStart', 'subagent-start', 6),
  addOptimizerBridge(config, 'SubagentStop', 'subagent-stop', 6),
].filter(Boolean).length;

addThinHook(config, 'SessionStart', 'session-start', { timeout: 5 });
addThinHook(config, 'UserPromptSubmit', 'user-prompt', { timeout: 5 });
addThinHook(config, 'SubagentStart', 'subagent-start', { timeout: 5 });
addThinHook(config, 'SubagentStop', 'subagent-stop', { timeout: 8 });
addThinHook(config, 'PreToolUse', 'pre-tool', { matcher: 'wait_agent', timeout: 5 });
addThinHook(config, 'Stop', 'stop', { timeout: 5 });

saveHooks(config);
process.stdout.write(JSON.stringify({ hooksPath, removedBroken, optimizerAdded, thinHook }) + '\n');

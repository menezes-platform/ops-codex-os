const fs = require('node:fs');
const path = require('node:path');

function parseControl(text) {
  const state = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+):\s*(.*)$/.exec(line);
    if (match) state[match[1]] = match[2].trim();
  }
  return state;
}

function serializeControl(state) {
  return Object.entries(state).map(([key, value]) => `${key}: ${value ?? ''}`).join('\n') + '\n';
}

function readControl(filePath) {
  return parseControl(fs.readFileSync(filePath, 'utf8'));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replaceFileWithRetry(tmp, filePath, {
  rename = fs.renameSync, sleep = sleepSync, retries = 12, baseDelayMs = 25,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmp, filePath);
      return;
    } catch (error) {
      const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
      if (!transient || attempt >= retries) throw error;
      sleep(Math.min(baseDelayMs * (attempt + 1), 250));
    }
  }
}

function writeControlAtomic(filePath, state, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = serializeControl(state);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    replaceFileWithRetry(tmp, filePath, options);
    return;
  } catch (error) {
    const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
    if (!transient) {
      try { fs.unlinkSync(tmp); } catch {}
      throw error;
    }
    const pending = `${filePath}.pending-${process.pid}-${Date.now()}`;
    try { fs.renameSync(tmp, pending); } catch {}
    const blocked = new Error(`CONTROL_REPLACE_BLOCKED:${error.code || 'UNKNOWN'}`);
    blocked.cause = error;
    blocked.pendingPath = fs.existsSync(pending) ? pending : (fs.existsSync(tmp) ? tmp : null);
    throw blocked;
  }
}

module.exports = { parseControl, serializeControl, readControl, replaceFileWithRetry, writeControlAtomic };

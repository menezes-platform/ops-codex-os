const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function syncDirectory(directory, { io = fs, platform = process.platform } = {}) {
  let fd;
  try {
    fd = io.openSync(directory, 'r');
    io.fsyncSync(fd);
    return true;
  } catch (error) {
    // Windows does not expose a directory flush through Node's file descriptors.
    // Never turn an actual I/O failure into an affirmative durability claim.
    if (['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)
      || platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return false;
    throw error;
  } finally { if (fd !== undefined) io.closeSync(fd); }
}

function ensureDurableDirectory(directory, options = {}) {
  const io = options.io || fs;
  const created = io.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (created) {
    const stop = path.dirname(path.toNamespacedPath(path.resolve(created)));
    for (let current = path.toNamespacedPath(path.resolve(directory)); ; current = path.dirname(current)) {
      syncDirectory(current, options);
      if (current.toLowerCase() === stop.toLowerCase()) break;
      if (path.dirname(current) === current) throw new Error('DIRECTORY_SYNC_PATH_MISMATCH');
    }
  }
}

function writeExclusiveJson(target, value, options = {}) {
  const io = options.io || fs;
  const fd = io.openSync(target, 'wx', 0o600);
  try { io.writeFileSync(fd, JSON.stringify(value) + '\n'); io.fsyncSync(fd); }
  finally { io.closeSync(fd); }
  return syncDirectory(path.dirname(target), options);
}

function writeAtomicJson(target, value, options = {}) {
  const io = options.io || fs;
  ensureDurableDirectory(path.dirname(target), options);
  const temp = target + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  const fd = io.openSync(temp, 'wx', 0o600);
  try { io.writeFileSync(fd, JSON.stringify(value) + '\n'); io.fsyncSync(fd); }
  finally { io.closeSync(fd); }
  io.renameSync(temp, target);
  // A failure here is an uncertain commit: callers must reconcile the target,
  // not report success or delete state. Orphan temps are retained for inspection.
  return syncDirectory(path.dirname(target), options);
}

module.exports = { syncDirectory, ensureDurableDirectory, writeExclusiveJson, writeAtomicJson };

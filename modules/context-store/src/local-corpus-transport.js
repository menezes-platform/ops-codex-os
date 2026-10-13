'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomBytes } = require('node:crypto');

// Offline test adapter only. Durable production corpus authority remains Drive.
const KEY = /^projects\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/(?:corpus\/[a-f0-9]{64}|manifests\/[a-f0-9]{64}\.json|receipts\/[a-f0-9]{64}\.json)$/;
function components(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('CORPUS_OBJECT_KEY_INVALID');
  return key.split('/');
}

async function createLocalCorpusObjectTransport({ root } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !root.trim()) throw new Error('CORPUS_ROOT_REQUIRED');
  await fs.mkdir(root, { recursive: true });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('CORPUS_OBJECT_PATH_UNSAFE');
  const base = await fs.realpath(root);

  async function parentFor(key, create) {
    const parts = components(key);
    let current = base;
    for (const part of parts.slice(0, -1)) {
      const next = path.join(current, part);
      if (create) {
        try { await fs.mkdir(next, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      let stat;
      try { stat = await fs.lstat(next); }
      catch (error) { if (!create && error.code === 'ENOENT') return null; throw error; }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('CORPUS_OBJECT_PATH_UNSAFE');
      current = next;
    }
    return { parent: current, target: path.join(current, parts.at(-1)) };
  }

  async function assertNotSymlink(target) {
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('CORPUS_OBJECT_PATH_UNSAFE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  return Object.freeze({
    async putObjectIfAbsent({ key, content } = {}) {
      const paths = await parentFor(key, true);
      if (!Buffer.isBuffer(content) && !(content instanceof Uint8Array)) throw new Error('CORPUS_OBJECT_BYTES_INVALID');
      await assertNotSymlink(paths.target);
      // Create-only hard link publishes completed object bytes atomically;
      // never use rename(), which can replace a prior immutable artifact.
      const temp = path.join(paths.parent, '.staging-' + randomBytes(16).toString('hex'));
      let handle;
      try {
        handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(content);
        await handle.sync();
        await handle.close(); handle = null;
        try { await fs.link(temp, paths.target); }
        catch (error) { if (error.code !== 'EEXIST') throw error; await assertNotSymlink(paths.target); }
      } finally {
        if (handle) await handle.close();
        await fs.unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    },
    async getObject({ key } = {}) {
      const paths = await parentFor(key, false);
      if (!paths) return null;
      await assertNotSymlink(paths.target);
      let handle;
      try {
        handle = await fs.open(paths.target, constants.O_RDONLY | constants.O_NOFOLLOW);
        return await handle.readFile();
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        if (error.code === 'ELOOP') throw new Error('CORPUS_OBJECT_PATH_UNSAFE');
        throw error;
      } finally { if (handle) await handle.close(); }
    },
  });
}

module.exports = { createLocalCorpusObjectTransport };

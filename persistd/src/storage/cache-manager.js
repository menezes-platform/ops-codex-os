const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hashFile, parseObjectRef } = require('./object-store');

const GiB = 1024 ** 3;

function evictionReserves(totalBytes) {
  return {
    startReserve: Math.max(50 * GiB, Math.floor(Number(totalBytes) * 0.10)),
    targetReserve: Math.max(80 * GiB, Math.floor(Number(totalBytes) * 0.15)),
  };
}

class CacheManager {
  constructor({
    cacheRoot,
    driveClient = null,
    statfs = fs.promises.statfs,
    now = () => new Date(),
    maxBytes = process.env.GABRIEL_CACHE_MAX_BYTES
      ? Number(process.env.GABRIEL_CACHE_MAX_BYTES)
      : Number.POSITIVE_INFINITY,
  } = {}) {
    if (!cacheRoot) throw new Error('CACHE_ROOT_REQUIRED');
    this.cacheRoot = String(cacheRoot);
    this.driveClient = driveClient;
    this.statfs = statfs;
    this.now = now;
    this.maxBytes = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : Number.POSITIVE_INFINITY;
  }

  get indexPath() { return path.join(this.cacheRoot, 'index.json'); }
  get objectsDir() { return path.join(this.cacheRoot, 'objects'); }

  readIndex() {
    try {
      const value = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      return { entries: value?.entries && typeof value.entries === 'object' ? value.entries : {} };
    } catch (error) {
      if (error?.code === 'ENOENT') return { entries: {} };
      throw error;
    }
  }

  writeIndex(index) {
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    const temp = this.indexPath + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(index) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.indexPath);
  }

  async acquire(ref, fetcher) {
    const sha256 = parseObjectRef(ref);
    const targetPath = path.join(this.objectsDir, sha256);
    fs.mkdirSync(this.objectsDir, { recursive: true });
    const index = this.readIndex();

    if (fs.existsSync(targetPath)) {
      const current = await hashFile(targetPath);
      if (current.sha256 === sha256) {
        const row = index.entries[sha256] || {
          sha256, fileId: null, size: current.size, pinnedCount: 0, verifiedAt: this.now().toISOString(),
        };
        row.lastAccessAt = this.now().toISOString();
        row.size = current.size;
        index.entries[sha256] = row;
        this.writeIndex(index);
        return targetPath;
      }
      await fs.promises.rm(targetPath, { force: true });
      delete index.entries[sha256];
      this.writeIndex(index);
    }

    let lastFileId = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const fetched = await fetcher({ sha256, targetPath, attempt });
      const partialPath = typeof fetched === 'string' ? fetched : fetched?.partialPath;
      lastFileId = typeof fetched === 'object' ? fetched?.fileId || lastFileId : lastFileId;
      if (!partialPath) throw new Error('CACHE_FETCH_RESULT_INVALID');
      const actual = await hashFile(partialPath);
      if (actual.sha256 !== sha256) {
        await fs.promises.rm(partialPath, { force: true }).catch(() => {});
        if (attempt === 2) {
          if (lastFileId && this.driveClient?.updateAppProperties) {
            await this.driveClient.updateAppProperties(lastFileId, { gdb_quarantine: 'hash_mismatch' });
          }
          throw new Error('OBJECT_HASH_MISMATCH');
        }
        continue;
      }

      await fs.promises.rm(targetPath, { force: true }).catch(() => {});
      await fs.promises.rename(partialPath, targetPath);
      index.entries[sha256] = {
        sha256,
        fileId: lastFileId,
        size: actual.size,
        lastAccessAt: this.now().toISOString(),
        pinnedCount: Number(index.entries[sha256]?.pinnedCount || 0),
        verifiedAt: this.now().toISOString(),
      };
      this.writeIndex(index);
      return targetPath;
    }
    throw new Error('OBJECT_HASH_MISMATCH');
  }

  async pin(ref) {
    const sha256 = parseObjectRef(ref);
    const index = this.readIndex();
    const row = index.entries[sha256];
    if (!row) throw new Error('CACHE_OBJECT_NOT_FOUND');
    row.pinnedCount = Number(row.pinnedCount || 0) + 1;
    row.lastAccessAt = this.now().toISOString();
    this.writeIndex(index);
    return row.pinnedCount;
  }

  async unpin(ref) {
    const sha256 = parseObjectRef(ref);
    const index = this.readIndex();
    const row = index.entries[sha256];
    if (!row) throw new Error('CACHE_OBJECT_NOT_FOUND');
    row.pinnedCount = Math.max(0, Number(row.pinnedCount || 0) - 1);
    row.lastAccessAt = this.now().toISOString();
    this.writeIndex(index);
    return row.pinnedCount;
  }

  async evictFor(requiredBytes = 0) {
    const disk = await this.statfs(this.cacheRoot);
    const freeBytes = Number(disk.bsize) * Number(disk.bavail);
    const totalBytes = Number(disk.bsize) * Number(disk.blocks);
    const required = Number(requiredBytes || 0);
    const { startReserve, targetReserve } = evictionReserves(totalBytes);
    const index = this.readIndex();

    let cacheBytes = Object.values(index.entries).reduce((sum, row) => sum + Number(row.size || 0), 0);
    const mustEvict = freeBytes - required < startReserve || cacheBytes > this.maxBytes;
    if (!mustEvict) return { evicted: [], freeBytes, cacheBytes };

    let projectedFree = freeBytes;
    const evicted = [];
    const candidates = Object.values(index.entries)
      .filter((row) => Number(row.pinnedCount || 0) === 0)
      .sort((a, b) => {
        const byTime = String(a.lastAccessAt || '').localeCompare(String(b.lastAccessAt || ''));
        return byTime || String(a.sha256).localeCompare(String(b.sha256));
      });

    for (const row of candidates) {
      const enoughDisk = projectedFree - required >= targetReserve;
      const enoughCache = cacheBytes <= this.maxBytes;
      if (enoughDisk && enoughCache) break;
      await fs.promises.rm(path.join(this.objectsDir, row.sha256), { force: true });
      delete index.entries[row.sha256];
      const size = Number(row.size || 0);
      projectedFree += size;
      cacheBytes = Math.max(0, cacheBytes - size);
      evicted.push(row.sha256);
    }
    this.writeIndex(index);

    if (projectedFree - required < targetReserve || cacheBytes > this.maxBytes) {
      throw new Error('INSUFFICIENT_LOCAL_CAPACITY');
    }
    return { evicted, freeBytes: projectedFree, cacheBytes };
  }
}

module.exports = { CacheManager, evictionReserves, GiB };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DriveObjectStore, hashFile } = require('./src/storage/object-store');
const { CacheManager, evictionReserves } = require('./src/storage/cache-manager');

function tempFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-object-'));
  const filePath = path.join(dir, 'input.bin');
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test('DriveObjectStore is idempotent by SHA and creates one companion manifest', async () => {
  const filePath = tempFile('hello-drive');
  const sha = crypto.createHash('sha256').update('hello-drive').digest('hex');
  const calls = [];
  const files = [];
  const client = {
    async searchByHash(hash, options) {
      calls.push(['search', hash, options]);
      return files.filter((f) => f.appProperties.gdb_sha256 === hash
        && (!options?.record || f.appProperties.gdb_record === options.record));
    },
    async startResumableUpload(input) { calls.push(['start', input]); return 'session'; },
    async uploadFileResumable() {
      const file = { id: 'blob-b', size: '11', appProperties: { gdb_sha256: sha, gdb_record: 'object' } };
      files.push(file); return file;
    },
    async createJsonFile(input) {
      const file = { id: 'manifest-1', size: '1', appProperties: input.appProperties };
      files.push(file); calls.push(['manifest', input]); return file;
    },
  };
  const store = new DriveObjectStore({ client, rootId: 'root-1', clock: () => new Date('2026-09-24T17:00:00Z') });
  const first = await store.put(filePath, { namespace: 'tests', kind: 'artifact', label: 'x' });
  const second = await store.put(filePath, { namespace: 'tests', kind: 'artifact', label: 'x' });
  assert.equal(first.ref, 'sha256:' + sha);
  assert.equal(second.fileId, first.fileId);
  assert.equal(calls.filter(([kind]) => kind === 'start').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'manifest').length, 1);
  assert.ok(calls.some(([kind,, options]) => kind === 'search' && options?.record === 'object'));
  assert.equal(first.durable, true);
});

test('DriveObjectStore refuses secret-looking manifest metadata', async () => {
  const filePath = tempFile('secret-test');
  const store = new DriveObjectStore({
    client: { searchByHash: async () => [] },
    rootId: 'root',
  });
  await assert.rejects(() => store.put(filePath, { apiToken: 'nope' }), /OBJECT_METADATA_SECRET_FORBIDDEN/);
});

test('CacheManager verifies downloads, retries once, quarantines second mismatch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-cache-'));
  const expected = crypto.createHash('sha256').update('correct').digest('hex');
  let attempts = 0;
  const quarantined = [];
  const manager = new CacheManager({
    cacheRoot: root,
    driveClient: { updateAppProperties: async (id, patch) => quarantined.push({ id, patch }) },
    statfs: async () => ({ bsize: 1, bavail: 200 * 1024 ** 3, blocks: 500 * 1024 ** 3 }),
    now: () => new Date('2026-09-24T17:00:00Z'),
  });
  await assert.rejects(() => manager.acquire('sha256:' + expected, async ({ targetPath }) => {
    attempts += 1;
    const partial = targetPath + '.download-' + attempts;
    fs.mkdirSync(path.dirname(partial), { recursive: true });
    fs.writeFileSync(partial, 'wrong-' + attempts);
    return { partialPath: partial, fileId: 'drive-file-1' };
  }), /OBJECT_HASH_MISMATCH/);
  assert.equal(attempts, 2);
  assert.deepEqual(quarantined, [{ id: 'drive-file-1', patch: { gdb_quarantine: 'hash_mismatch' } }]);
});

test('CacheManager acquires verified bytes and pinning prevents eviction', async () => {
  const GiB = 1024 ** 3;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-cache-pin-'));
  const oldSha = crypto.createHash('sha256').update('old').digest('hex');
  const newSha = crypto.createHash('sha256').update('new').digest('hex');
  let freeBytes = 40 * GiB;
  const manager = new CacheManager({
    cacheRoot: root,
    maxBytes: 60 * GiB,
    statfs: async () => ({ bsize: 1, bavail: freeBytes, blocks: 500 * GiB }),
    now: () => new Date('2026-09-24T17:00:00Z'),
  });
  const oldPath = await manager.acquire('sha256:' + oldSha, async ({ targetPath }) => {
    const partial = targetPath + '.partial'; fs.mkdirSync(path.dirname(partial), { recursive: true });
    fs.writeFileSync(partial, 'old'); return { partialPath: partial, fileId: 'old-id' };
  });
  await manager.pin('sha256:' + oldSha);
  await manager.acquire('sha256:' + newSha, async ({ targetPath }) => {
    const partial = targetPath + '.partial'; fs.writeFileSync(partial, 'new');
    return { partialPath: partial, fileId: 'new-id' };
  });
  const index = manager.readIndex();
  index.entries[oldSha].size = 50 * GiB;
  index.entries[newSha].size = 50 * GiB;
  index.entries[oldSha].lastAccessAt = '2026-09-20T00:00:00Z';
  index.entries[newSha].lastAccessAt = '2026-09-21T00:00:00Z';
  manager.writeIndex(index);
  await manager.evictFor(0);
  assert.equal(fs.existsSync(oldPath), true);
  assert.equal(manager.readIndex().entries[newSha], undefined);
});

test('CacheManager throws when pinned entries prevent required headroom', async () => {
  const GiB = 1024 ** 3;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-cache-full-'));
  const sha = crypto.createHash('sha256').update('pinned').digest('hex');
  const manager = new CacheManager({
    cacheRoot: root,
    statfs: async () => ({ bsize: 1, bavail: 20 * GiB, blocks: 500 * GiB }),
  });
  fs.mkdirSync(path.join(root, 'objects'), { recursive: true });
  fs.writeFileSync(path.join(root, 'objects', sha), 'pinned');
  manager.writeIndex({ entries: {
    [sha]: { sha256: sha, fileId: 'f', size: 100 * GiB, lastAccessAt: '2026-09-20T00:00:00Z', pinnedCount: 1, verifiedAt: 'x' },
  } });
  await assert.rejects(() => manager.evictFor(10 * GiB), /INSUFFICIENT_LOCAL_CAPACITY/);
});

test('eviction reserves match the 50/80 GiB and 10/15 percent policy', () => {
  const GiB = 1024 ** 3;
  assert.deepEqual(evictionReserves(100 * GiB), { startReserve: 50 * GiB, targetReserve: 80 * GiB });
  assert.deepEqual(evictionReserves(1000 * GiB), { startReserve: 100 * GiB, targetReserve: 150 * GiB });
});

test('hashFile reports SHA-256 and exact byte size', async () => {
  const filePath = tempFile('abc');
  const result = await hashFile(filePath);
  assert.equal(result.size, 3);
  assert.equal(result.sha256, crypto.createHash('sha256').update('abc').digest('hex'));
});

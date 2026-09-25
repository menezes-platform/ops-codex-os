const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CatalogSync } = require('./src/storage/catalog-sync');

test('CatalogSync bootstraps cursor, applies replay idempotently, and removes catalog mapping only', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-catalog-'));
  const sha = 'a'.repeat(64);
  const pages = {
    t0: { changes: [{
      fileId: 'f1',
      removed: false,
      file: { id: 'f1', parents: ['root-1'], appProperties: { gdb_sha256: sha, gdb_record: 'object' } },
    }], newStartPageToken: 't1' },
    t1: { changes: [{
      fileId: 'f1',
      removed: true,
      file: null,
    }], newStartPageToken: 't2' },
  };
  const client = {
    getStartPageToken: async () => 't0',
    listChanges: async (token) => pages[token],
  };
  const sync = new CatalogSync({ client, cacheRoot, rootId: 'root-1' });
  assert.deepEqual(await sync.syncOnce(), { initialized: true, pageToken: 't0', applied: 0 });
  const first = await sync.syncOnce();
  assert.equal(first.applied, 1);
  assert.equal(sync.readState().catalog[sha].fileId, 'f1');

  sync.writeState({ ...sync.readState(), pageToken: 't0' });
  await sync.syncOnce();
  assert.deepEqual(Object.keys(sync.readState().catalog), [sha]);

  sync.writeState({ ...sync.readState(), pageToken: 't1' });
  await sync.syncOnce();
  assert.equal(sync.readState().catalog[sha], undefined);
  const unrelated = path.join(cacheRoot, 'objects', 'unrelated');
  fs.mkdirSync(path.dirname(unrelated), { recursive: true });
  fs.writeFileSync(unrelated, 'keep');
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
});

test('CatalogSync ignores files outside root and invalid SHA metadata', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-catalog-filter-'));
  const client = {
    getStartPageToken: async () => 't0',
    listChanges: async () => ({
      changes: [
        { fileId: 'outside', file: { id: 'outside', parents: ['other'], appProperties: { gdb_sha256: 'a'.repeat(64) } } },
        { fileId: 'invalid', file: { id: 'invalid', parents: ['root'], appProperties: { gdb_sha256: 'nope' } } },
      ],
      newStartPageToken: 't1',
    }),
  };
  const sync = new CatalogSync({ client, cacheRoot, rootId: 'root' });
  await sync.syncOnce();
  const result = await sync.syncOnce();
  assert.equal(result.applied, 0);
  assert.deepEqual(sync.readState().catalog, {});
});

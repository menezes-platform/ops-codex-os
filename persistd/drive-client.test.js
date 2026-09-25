const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DriveClient, CHUNK_BYTES } = require('./src/storage/drive-client');

function response({ status = 200, json = {}, headers = {}, body = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body,
    json: async () => json,
    text: async () => JSON.stringify(json),
    arrayBuffer: async () => Buffer.from(body || ''),
  };
}

const tokenProvider = async () => ({ accessToken: 'access', rootId: 'root-1' });

test('DriveClient searches hash under configured root with bounded fields', async () => {
  let seen;
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return response({ json: { files: [{ id: 'f1', size: '3' }] } });
    },
  });
  const files = await client.searchByHash('a'.repeat(64));
  assert.equal(files[0].id, 'f1');
  assert.match(seen.url, /drive\/v3\/files\?/);
  const query = new URL(seen.url).searchParams.get('q');
  assert.match(query, /'root-1' in parents/);
  assert.match(query, /gdb_sha256/);
  assert.equal(seen.init.headers.authorization, 'Bearer access');
});

test('DriveClient creates folders, JSON files, and updates appProperties through token provider', async () => {
  const calls = [];
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('upload/drive/v3/files')) return response({ json: { id: 'manifest-1' } });
      return response({ json: { id: 'folder-1', appProperties: { ok: '1' } } });
    },
  });
  const folder = await client.createFolder('objects', 'root-1');
  const manifest = await client.createJsonFile({
    name: 'x.json', parentId: 'root-1', appProperties: { gdb_record: 'manifest' }, value: { x: 1 },
  });
  const updated = await client.updateAppProperties('file-1', { gdb_quarantine: 'hash_mismatch' });
  assert.equal(folder.id, 'folder-1');
  assert.equal(manifest.id, 'manifest-1');
  assert.equal(updated.id, 'folder-1');
  assert.ok(calls.some((call) => call.init.method === 'PATCH'));
  assert.ok(calls.some((call) => String(call.init.headers['content-type']).startsWith('multipart/related')));
});

test('resumable upload resumes from the accepted 8 MiB boundary after network failure', async () => {
  assert.equal(CHUNK_BYTES, 8 * 1024 * 1024);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-resume-'));
  const filePath = path.join(dir, 'blob.bin');
  const total = 10 * 1024 * 1024;
  fs.writeFileSync(filePath, Buffer.alloc(total, 7));

  const calls = [];
  let stage = 0;
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      stage += 1;
      if (stage === 1) return response({ status: 308, headers: { Range: 'bytes=0-8388607' } });
      if (stage === 2) throw new Error('network reset');
      if (stage === 3) {
        assert.equal(init.headers['content-range'], `bytes */${total}`);
        return response({ status: 308, headers: { Range: 'bytes=0-8388607' } });
      }
      return response({ status: 200, json: { id: 'uploaded-1', size: String(total) } });
    },
  });
  const result = await client.uploadFileResumable({ filePath, sessionUrl: 'https://upload.example/session' });
  assert.equal(result.id, 'uploaded-1');
  const dataRanges = calls.filter((call) => call.init.headers['content-length'] !== '0')
    .map((call) => call.init.headers['content-range']);
  assert.equal(dataRanges[0], `bytes 0-${CHUNK_BYTES - 1}/${total}`);
  assert.equal(dataRanges[1], `bytes ${CHUNK_BYTES}-${total - 1}/${total}`);
  assert.equal(dataRanges[2], `bytes ${CHUNK_BYTES}-${total - 1}/${total}`);
});

test('DriveClient starts resumable upload and returns Location session URL', async () => {
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async (url, init) => {
      assert.match(url, /uploadType=resumable/);
      assert.equal(init.headers['x-upload-content-length'], '123');
      return response({ status: 200, headers: { Location: 'https://upload.example/session-1' } });
    },
  });
  const session = await client.startResumableUpload({
    name: 'blob', parentId: 'root-1', appProperties: { gdb_sha256: 'a'.repeat(64) },
    size: 123, mimeType: 'application/octet-stream',
  });
  assert.equal(session, 'https://upload.example/session-1');
});

test('DriveClient downloads into a generated partial file instead of canonical target', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-download-'));
  const target = path.join(dir, 'canonical.bin');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('hello'));
      controller.close();
    },
  });
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async () => response({ status: 200, body: stream }),
  });
  const partial = await client.downloadToFile('file-1', target);
  assert.notEqual(partial, target);
  assert.match(partial, /canonical\.bin\.partial-/);
  assert.equal(fs.readFileSync(partial, 'utf8'), 'hello');
  assert.equal(fs.existsSync(target), false);
});

test('DriveClient exposes start token and change pages', async () => {
  const urls = [];
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('startPageToken')) return response({ json: { startPageToken: 't1' } });
      return response({ json: { changes: [{ fileId: 'f1' }], newStartPageToken: 't2' } });
    },
  });
  assert.equal(await client.getStartPageToken(), 't1');
  const page = await client.listChanges('t1');
  assert.equal(page.newStartPageToken, 't2');
  assert.ok(urls.some((url) => url.includes('pageToken=t1')));
});

test('DriveClient can restrict hash search to one gdb_record kind', async () => {
  let query;
  const client = new DriveClient({
    tokenProvider,
    fetchImpl: async (url) => {
      query = new URL(url).searchParams.get('q');
      return response({ json: { files: [] } });
    },
  });
  await client.searchByHash('c'.repeat(64), { record: 'object' });
  assert.match(query, /key='gdb_record'/);
  assert.match(query, /value='object'/);
});

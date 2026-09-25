const crypto = require('node:crypto');
const fs = require('node:fs');

const SECRET_KEY = /(?:secret|token|password|credential|private[_-]?key)/i;

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

function assertMetadataSafe(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error('OBJECT_METADATA_SECRET_FORBIDDEN');
    if (child && typeof child === 'object') assertMetadataSafe(child, path ? path + '.' + key : key);
  }
}

function parseObjectRef(ref) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(String(ref || ''));
  if (!match) throw new Error('INVALID_OBJECT_REF');
  return match[1].toLowerCase();
}

function canonicalById(files, expectedSize) {
  const eligible = (files || []).filter((file) => {
    if (file?.appProperties?.gdb_record !== 'object') return false;
    if (expectedSize === undefined) return true;
    return Number(file.size) === Number(expectedSize);
  });
  return eligible.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

class DriveObjectStore {
  constructor({ client, rootId, clock = () => new Date() } = {}) {
    if (!client) throw new Error('DRIVE_CLIENT_REQUIRED');
    if (!rootId) throw new Error('DRIVE_ROOT_ID_REQUIRED');
    this.client = client;
    this.rootId = String(rootId);
    this.clock = clock;
  }

  async ensureManifest({ sha256, size, fileId, metadata }) {
    const manifests = (await this.client.searchByHash(sha256, { record: 'manifest' }))
      .filter((file) => file?.appProperties?.gdb_record === 'manifest')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (manifests.length) return manifests[0];

    const manifest = {
      schema: 1,
      ref: 'sha256:' + sha256,
      sha256,
      size,
      fileId,
      metadata,
      createdAt: this.clock().toISOString(),
    };
    return this.client.createJsonFile({
      name: sha256 + '.manifest.json',
      parentId: this.rootId,
      appProperties: {
        gdb_schema: '1',
        gdb_sha256: sha256,
        gdb_record: 'manifest',
      },
      value: manifest,
    });
  }

  async put(filePath, metadata = {}) {
    assertMetadataSafe(metadata);
    const { sha256, size } = await hashFile(filePath);
    const appProperties = {
      gdb_schema: '1',
      gdb_sha256: sha256,
      gdb_namespace: String(metadata.namespace || 'default').slice(0, 80),
      gdb_kind: String(metadata.kind || 'artifact').slice(0, 40),
      gdb_size: String(size),
      gdb_record: 'object',
    };

    let candidates = canonicalById(
      await this.client.searchByHash(sha256, { record: 'object' }),
      size,
    );
    if (!candidates.length) {
      const sessionUrl = await this.client.startResumableUpload({
        name: sha256,
        parentId: this.rootId,
        appProperties,
        size,
        mimeType: metadata.mimeType || 'application/octet-stream',
      });
      await this.client.uploadFileResumable({ filePath, sessionUrl });
      candidates = canonicalById(
        await this.client.searchByHash(sha256, { record: 'object' }),
        size,
      );
      if (!candidates.length) throw new Error('DRIVE_OBJECT_CONFIRMATION_MISSING');
    }

    const canonical = candidates[0];
    const manifest = await this.ensureManifest({
      sha256,
      size,
      fileId: canonical.id,
      metadata,
    });
    if (!manifest?.id) throw new Error('DRIVE_MANIFEST_CONFIRMATION_MISSING');

    return {
      ref: 'sha256:' + sha256,
      sha256,
      size,
      fileId: canonical.id,
      manifestFileId: manifest.id,
      duplicateFileIds: candidates.slice(1).map((file) => file.id),
      durable: true,
    };
  }

  async resolve(ref) {
    const sha256 = parseObjectRef(ref);
    const candidates = canonicalById(
      await this.client.searchByHash(sha256, { record: 'object' }),
    );
    if (!candidates.length) throw new Error('OBJECT_NOT_FOUND');
    return candidates[0];
  }
}

module.exports = {
  DriveObjectStore,
  hashFile,
  parseObjectRef,
  assertMetadataSafe,
};

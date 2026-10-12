'use strict';
const { createHash } = require('node:crypto');
const { createCorpusManifest, assertCorpusManifest } = require('./corpus-manifest');

const SCOPE = /^project\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/;
const DIGEST = /^sha256:([a-f0-9]{64})$/;

function scopeRoot(scope) {
  const match = typeof scope === 'string' && SCOPE.exec(scope);
  if (!match) throw new Error('INVALID_PROJECT_SCOPE');
  return `projects/${match[1]}/${match[2]}`;
}

function digestBytes(bytes) {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

function hexDigest(ref, errorCode) {
  const match = typeof ref === 'string' && DIGEST.exec(ref);
  if (!match) throw new Error(errorCode);
  return match[1];
}

function bytesFromObject(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new Error('CORPUS_OBJECT_UNAVAILABLE');
  return Buffer.from(value);
}

/**
 * Immutable corpus object adapter. A Drive transport must implement its own
 * scoped authorization, immutable compare-if-absent semantics and persistence.
 * This adapter never writes current/previous publication pointers.
 */
function createDriveCorpusStore({ transport } = {}) {
  if (!transport || typeof transport.putObjectIfAbsent !== 'function'
    || typeof transport.getObject !== 'function') throw new Error('CORPUS_TRANSPORT_REQUIRED');

  async function put(key, bytes) {
    try { await transport.putObjectIfAbsent({ key, content: bytes }); }
    catch { throw new Error('CORPUS_OBJECT_UNAVAILABLE'); }
    // A provider acknowledgement alone does not prove that the immutable
    // object was persisted or that an existing object has matching bytes.
    const persisted = await get(key);
    if (!persisted.equals(bytes)) throw new Error('CORPUS_OBJECT_DIGEST_MISMATCH');
  }

  async function get(key) {
    let value;
    try { value = await transport.getObject({ key }); }
    catch { throw new Error('CORPUS_OBJECT_UNAVAILABLE'); }
    return bytesFromObject(value);
  }

  return Object.freeze({
    async putCorpusProjection({ scope, source_revision, documents } = {}) {
      const root = scopeRoot(scope);
      const manifest = createCorpusManifest({ scope, source_revision, documents });
      const contentByRef = new Map(documents.map((document) => [document.source_ref, document.content]));
      const stored = new Set();
      for (const document of manifest.documents) {
        const bytes = Buffer.from(contentByRef.get(document.source_ref), 'utf8');
        if (digestBytes(bytes) !== document.content_sha256) throw new Error('CORPUS_DOCUMENT_DIGEST_MISMATCH');
        const key = `${root}/corpus/${hexDigest(document.content_sha256, 'CORPUS_DOCUMENT_DIGEST_INVALID')}`;
        if (!stored.has(key)) {
          await put(key, bytes);
          stored.add(key);
        }
      }
      // The manifest is written last; failed object uploads cannot publish it.
      const manifestKey = `${root}/manifests/${hexDigest(manifest.corpus_manifest_ref, 'CORPUS_MANIFEST_REF_INVALID')}.json`;
      await put(manifestKey, Buffer.from(JSON.stringify(manifest), 'utf8'));
      return Object.freeze({
        scope, source_revision, corpus_manifest_ref: manifest.corpus_manifest_ref,
        manifest_key: manifestKey, objects_written: stored.size, status: 'stored',
      });
    },

    async readCorpusProjection({ scope, corpus_manifest_ref } = {}) {
      const root = scopeRoot(scope);
      const manifestKey = `${root}/manifests/${hexDigest(corpus_manifest_ref, 'CORPUS_MANIFEST_REF_INVALID')}.json`;
      let manifest;
      try { manifest = assertCorpusManifest(JSON.parse((await get(manifestKey)).toString('utf8'))); }
      catch (error) {
        if (error.message === 'CORPUS_OBJECT_UNAVAILABLE') throw error;
        throw new Error('CORPUS_MANIFEST_INVALID');
      }
      if (manifest.scope !== scope) throw new Error('CORPUS_SCOPE_MISMATCH');
      if (manifest.corpus_manifest_ref !== corpus_manifest_ref) throw new Error('CORPUS_MANIFEST_INVALID');
      const documents = [];
      for (const entry of manifest.documents) {
        const key = `${root}/corpus/${hexDigest(entry.content_sha256, 'CORPUS_DOCUMENT_DIGEST_INVALID')}`;
        const bytes = await get(key);
        if (digestBytes(bytes) !== entry.content_sha256) throw new Error('CORPUS_OBJECT_DIGEST_MISMATCH');
        documents.push({ source_ref: entry.source_ref, path: entry.path, content: bytes.toString('utf8') });
      }
      return Object.freeze({ manifest, documents: Object.freeze(documents) });
    },
  });
}

module.exports = { createDriveCorpusStore };

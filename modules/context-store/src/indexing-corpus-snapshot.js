'use strict';

const { createHash } = require('node:crypto');
const { assertCorpusManifest } = require('./corpus-manifest');

const SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
/**
 * Validated source-only handoff to Execution Plane's CorpusSnapshot constructor.
 * This module does NOT execute chunking, embeddings, FAISS or index publication.
 * The Rust consumer must still independently verify every object and its scope.
 */
async function materializeIndexingSnapshot({ corpusStore, scope, revision, corpus_manifest_ref } = {}) {
  if (typeof scope !== 'string' || !SCOPE.test(scope)
    || typeof revision !== 'string' || !revision.isWellFormed() || !revision.trim()
    || revision !== revision.trim() || Buffer.byteLength(revision, 'utf8') > 500
    || /[\u0000-\u001F\u007F-\u009F]/u.test(revision)
    || typeof corpus_manifest_ref !== 'string' || !DIGEST.test(corpus_manifest_ref)) {
    throw new Error('CORPUS_SNAPSHOT_REQUEST_INVALID');
  }
  if (!corpusStore || typeof corpusStore.readCorpusProjection !== 'function') {
    throw new Error('CORPUS_SNAPSHOT_STORE_REQUIRED');
  }
  const projection = await corpusStore.readCorpusProjection({ scope, corpus_manifest_ref });
  if (projection.manifest.scope !== scope || projection.manifest.source_revision !== revision) {
    throw new Error('CORPUS_SNAPSHOT_REVISION_MISMATCH');
  }
  let manifest;
  try { manifest = assertCorpusManifest(projection.manifest); }
  catch { throw new Error('CORPUS_SNAPSHOT_INTEGRITY_INVALID'); }
  if (manifest.scope !== scope || manifest.corpus_manifest_ref !== corpus_manifest_ref
    || !Array.isArray(projection.documents) || projection.documents.length !== manifest.documents.length) {
    throw new Error('CORPUS_SNAPSHOT_INTEGRITY_INVALID');
  }
  const received = new Map(projection.documents.map((document) => [document.source_ref, document]));
  if (received.size !== manifest.documents.length) throw new Error('CORPUS_SNAPSHOT_INTEGRITY_INVALID');
  const documents = manifest.documents.map((entry) => {
    const document = received.get(entry.source_ref);
    if (!document || document.path !== entry.path) throw new Error('CORPUS_SNAPSHOT_INTEGRITY_INVALID');
    const { source_ref, path, content } = document;
    if (typeof content !== 'string' || !content.trim() || !content.isWellFormed()) {
      throw new Error('CORPUS_SNAPSHOT_DOCUMENT_INVALID');
    }
    const digest = 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex');
    if (digest !== entry.content_sha256) throw new Error('CORPUS_SNAPSHOT_INTEGRITY_INVALID');
    return Object.freeze({ source_ref, path, content });
  });
  return Object.freeze({
    scope, revision,
    manifest_ref: corpus_manifest_ref,
    documents: Object.freeze(documents),
  });
}

module.exports = { materializeIndexingSnapshot };

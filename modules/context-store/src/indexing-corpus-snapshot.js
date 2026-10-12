'use strict';

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
  const documents = projection.documents.map(({ source_ref, path, content }) => {
    if (typeof content !== 'string' || !content.trim() || !content.isWellFormed()) {
      throw new Error('CORPUS_SNAPSHOT_DOCUMENT_INVALID');
    }
    return Object.freeze({ source_ref, path, content });
  });
  if (documents.length === 0) throw new Error('CORPUS_SNAPSHOT_DOCUMENT_INVALID');
  return Object.freeze({
    scope, revision,
    manifest_ref: corpus_manifest_ref,
    documents: Object.freeze(documents),
  });
}

module.exports = { materializeIndexingSnapshot };

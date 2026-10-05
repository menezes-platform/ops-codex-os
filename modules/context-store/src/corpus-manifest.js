const { createHash } = require('node:crypto');

const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PROFILE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}(?:-v|@v)[1-9][0-9]*(?:\.[0-9]+){0,2}$/;
const MANIFEST_FIELDS = new Set(['schema_version', 'scope', 'source_revision', 'documents', 'corpus_manifest_ref']);
const DOCUMENT_FIELDS = new Set(['source_ref', 'path', 'content_sha256']);
const INPUT_DOCUMENT_FIELDS = new Set(['source_ref', 'path', 'content']);
const PROFILE_FIELDS = Object.freeze(['lexical_profile', 'vector_profile', 'embedding_profile', 'chunking_profile']);

function fail(code) {
  throw new Error(code);
}

function assertRecord(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(code);
  }
}

function assertOnlyFields(value, allowed, code) {
  assertRecord(value, code);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(code);
}

function assertText(value, code) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(code);
}

function assertScope(scope) {
  if (typeof scope !== 'string' || !PROJECT_SCOPE.test(scope)) fail('INVALID_PROJECT_SCOPE');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortDocuments(documents) {
  return documents.sort((left, right) => compareText(left.source_ref, right.source_ref) || compareText(left.path, right.path));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalManifest({ scope, source_revision, documents }) {
  return { schema_version: 1, scope, source_revision, documents: sortDocuments(documents) };
}

function withReference(payload) {
  const canonical = canonicalManifest(payload);
  return Object.freeze({
    ...canonical,
    documents: Object.freeze(canonical.documents.map((document) => Object.freeze({ ...document }))),
    corpus_manifest_ref: digest(JSON.stringify(canonical)),
  });
}

function assertUniqueDocuments(documents) {
  const sourceRefs = new Set();
  const paths = new Set();
  for (const document of documents) {
    if (sourceRefs.has(document.source_ref)) fail('CORPUS_DOCUMENT_DUPLICATE_SOURCE');
    if (paths.has(document.path)) fail('CORPUS_DOCUMENT_DUPLICATE_PATH');
    sourceRefs.add(document.source_ref);
    paths.add(document.path);
  }
}

function createCorpusManifest({ scope, source_revision, documents } = {}) {
  assertScope(scope);
  assertText(source_revision, 'SOURCE_REVISION_REQUIRED');
  if (!Array.isArray(documents) || documents.length === 0) fail('CORPUS_DOCUMENTS_REQUIRED');

  const normalized = documents.map((document) => {
    assertOnlyFields(document, INPUT_DOCUMENT_FIELDS, 'CORPUS_DOCUMENT_INVALID');
    assertText(document.source_ref, 'SOURCE_REF_REQUIRED');
    assertText(document.path, 'SOURCE_PATH_REQUIRED');
    if (typeof document.content !== 'string') fail('DOCUMENT_CONTENT_REQUIRED');
    return {
      source_ref: document.source_ref,
      path: document.path,
      content_sha256: digest(document.content),
    };
  });
  assertUniqueDocuments(normalized);
  return withReference({ scope, source_revision, documents: normalized });
}

function assertCorpusManifest(value) {
  assertOnlyFields(value, MANIFEST_FIELDS, 'CORPUS_MANIFEST_INVALID');
  if (value.schema_version !== 1) fail('CORPUS_MANIFEST_INVALID');
  assertScope(value.scope);
  assertText(value.source_revision, 'CORPUS_MANIFEST_INVALID');
  if (!Array.isArray(value.documents) || value.documents.length === 0) fail('CORPUS_MANIFEST_INVALID');

  const documents = value.documents.map((document) => {
    assertOnlyFields(document, DOCUMENT_FIELDS, 'CORPUS_DOCUMENT_INVALID');
    assertText(document.source_ref, 'CORPUS_DOCUMENT_INVALID');
    assertText(document.path, 'CORPUS_DOCUMENT_INVALID');
    if (typeof document.content_sha256 !== 'string' || !DIGEST.test(document.content_sha256)) {
      fail('CORPUS_DOCUMENT_INVALID');
    }
    return {
      source_ref: document.source_ref,
      path: document.path,
      content_sha256: document.content_sha256,
    };
  });
  assertUniqueDocuments(documents);

  const normalized = withReference({ scope: value.scope, source_revision: value.source_revision, documents });
  if (value.corpus_manifest_ref !== normalized.corpus_manifest_ref) fail('CORPUS_MANIFEST_DIGEST_MISMATCH');
  return normalized;
}

function normalizeProfiles(value, code) {
  assertOnlyFields(value, new Set(PROFILE_FIELDS), code);
  return Object.freeze(Object.fromEntries(PROFILE_FIELDS.map((field) => {
    if (typeof value[field] !== 'string' || !PROFILE_REF.test(value[field])) fail(code);
    return [field, value[field]];
  })));
}

function sameProfiles(left, right) {
  return PROFILE_FIELDS.every((field) => left[field] === right[field]);
}

function planCorpusUpdate({ previous_manifest = null, candidate_manifest, previous_profiles = null, candidate_profiles } = {}) {
  const candidate = assertCorpusManifest(candidate_manifest);
  const nextProfiles = normalizeProfiles(candidate_profiles, 'CORPUS_PROFILES_INVALID');
  const previous = previous_manifest === null ? null : assertCorpusManifest(previous_manifest);
  const oldProfiles = previous_profiles === null ? null : normalizeProfiles(previous_profiles, 'CORPUS_PROFILES_INVALID');

  if ((previous === null) !== (oldProfiles === null)) fail('CORPUS_PREVIOUS_STATE_INCOMPLETE');
  if (previous && previous.scope !== candidate.scope) fail('CORPUS_MANIFEST_SCOPE_MISMATCH');

  // source_ref is a stable document identity; source_revision carries repository revision changes.
  const priorByRef = new Map((previous?.documents ?? []).map((document) => [document.source_ref, document]));
  const nextByRef = new Map(candidate.documents.map((document) => [document.source_ref, document]));
  const added = [];
  const changed = [];
  const removed = [];
  let unchanged = 0;

  for (const document of candidate.documents) {
    const prior = priorByRef.get(document.source_ref);
    if (!prior) added.push(document.source_ref);
    else if (prior.path !== document.path || prior.content_sha256 !== document.content_sha256) changed.push(document.source_ref);
    else unchanged += 1;
  }
  for (const document of previous?.documents ?? []) {
    if (!nextByRef.has(document.source_ref)) removed.push(document.source_ref);
  }

  let operation;
  let reason;
  if (!previous) {
    operation = 'rebuild';
    reason = 'initial_generation';
  } else if (!sameProfiles(oldProfiles, nextProfiles)) {
    operation = 'rebuild';
    reason = 'profile_changed';
  } else if (added.length || changed.length || removed.length) {
    operation = 'incremental';
    reason = 'document_delta';
  } else if (previous.source_revision !== candidate.source_revision) {
    operation = 'metadata_only';
    reason = 'source_revision_changed';
  } else {
    operation = 'noop';
    reason = 'unchanged';
  }

  return Object.freeze({
    operation,
    reason,
    scope: candidate.scope,
    source_revision: candidate.source_revision,
    corpus_manifest_ref: candidate.corpus_manifest_ref,
    added: Object.freeze(added),
    changed: Object.freeze(changed),
    removed: Object.freeze(removed),
    unchanged_document_count: unchanged,
  });
}

module.exports = { createCorpusManifest, assertCorpusManifest, planCorpusUpdate };

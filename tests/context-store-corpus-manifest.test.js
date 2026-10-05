const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertCorpusManifest,
  createCorpusManifest,
  planCorpusUpdate,
} = require('../modules/context-store/src');

const scope = 'project/menezes-platform/ops-codex-os';
const profiles = Object.freeze({
  lexical_profile: 'fts5-bm25-v1',
  vector_profile: 'faiss-cosine-v1',
  embedding_profile: 'embed-small-v2',
  chunking_profile: 'markdown-window-v1',
});
const documents = Object.freeze([
  { source_ref: 'git:ops-codex-os:README.md', path: 'README.md', content: '# Project\n' },
  { source_ref: 'git:ops-codex-os:docs/design.md', path: 'docs/design.md', content: 'Design body\n' },
]);

function manifest(sourceRevision = 'abc', items = documents, projectScope = scope) {
  return createCorpusManifest({ scope: projectScope, source_revision: sourceRevision, documents: items });
}

test('corpus manifest is deterministic, sorted and contains hashes instead of source content', () => {
  const ordered = manifest();
  const reversed = manifest('abc', [...documents].reverse());

  assert.deepEqual(ordered, reversed);
  assert.deepEqual(ordered.documents.map((document) => document.source_ref), [
    'git:ops-codex-os:README.md', 'git:ops-codex-os:docs/design.md',
  ]);
  assert.equal(JSON.stringify(ordered).includes('Design body'), false);
  assert.match(ordered.corpus_manifest_ref, /^sha256:[a-f0-9]{64}$/);
});

test('corpus manifest refuses cross-project scope, duplicate identity and unknown fields', () => {
  assert.throws(() => manifest('abc', documents, 'account/gabriel'), /INVALID_PROJECT_SCOPE/);
  assert.throws(() => manifest('abc', [documents[0], { ...documents[0], content: 'different' }]), /CORPUS_DOCUMENT_DUPLICATE_SOURCE/);
  assert.throws(() => manifest('abc', [documents[0], { ...documents[1], path: documents[0].path }]), /CORPUS_DOCUMENT_DUPLICATE_PATH/);
  assert.throws(() => createCorpusManifest({ scope, source_revision: 'abc', documents: [{ ...documents[0], token: 'unexpected' }] }), /CORPUS_DOCUMENT_INVALID/);
});

test('corpus document paths must be bounded and relative without traversal segments', () => {
  for (const unsafePath of ['/private/README.md', '../README.md', 'docs/../../secret.md', 'C:/private/README.md', 'docs\\README.md', 'docs//README.md']) {
    assert.throws(() => manifest('abc', [{ ...documents[0], path: unsafePath }]), /CORPUS_DOCUMENT_INVALID/);
  }
  assert.throws(() => manifest('abc', [{ ...documents[0], path: `docs/${'a'.repeat(2048)}.md` }]), /CORPUS_DOCUMENT_INVALID/);
});

test('manifest validator canonicalizes order and rejects a modified digest', () => {
  const original = manifest();
  const reordered = { ...original, documents: [...original.documents].reverse() };

  assert.deepEqual(assertCorpusManifest(reordered), original);
  assert.throws(() => assertCorpusManifest({ ...original, source_revision: 'different' }), /CORPUS_MANIFEST_DIGEST_MISMATCH/);
});

test('first corpus publication requests a rebuild', () => {
  const candidate = manifest();
  const plan = planCorpusUpdate({ candidate_manifest: candidate, candidate_profiles: profiles });

  assert.equal(plan.operation, 'rebuild');
  assert.equal(plan.reason, 'initial_generation');
  assert.deepEqual(plan.added, ['git:ops-codex-os:README.md', 'git:ops-codex-os:docs/design.md']);
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.removed, []);
});

test('document additions, edits and removals produce a scoped incremental plan', () => {
  const previous = manifest();
  const candidate = manifest('def', [
    { ...documents[0], content: '# Updated project\n' },
    { source_ref: 'git:ops-codex-os:docs/operations.md', path: 'docs/operations.md', content: 'Operations\n' },
  ]);
  const plan = planCorpusUpdate({
    previous_manifest: previous,
    candidate_manifest: candidate,
    previous_profiles: profiles,
    candidate_profiles: profiles,
  });

  assert.equal(plan.operation, 'incremental');
  assert.equal(plan.reason, 'document_delta');
  assert.deepEqual(plan.added, ['git:ops-codex-os:docs/operations.md']);
  assert.deepEqual(plan.changed, ['git:ops-codex-os:README.md']);
  assert.deepEqual(plan.removed, ['git:ops-codex-os:docs/design.md']);
  assert.equal(plan.unchanged_document_count, 0);
  assert.equal(plan.scope, scope);
});

test('profile change requests a rebuild even when corpus content is unchanged', () => {
  const current = manifest();
  const nextProfiles = { ...profiles, embedding_profile: 'embed-small-v3' };
  const plan = planCorpusUpdate({
    previous_manifest: current,
    candidate_manifest: current,
    previous_profiles: profiles,
    candidate_profiles: nextProfiles,
  });

  assert.equal(plan.operation, 'rebuild');
  assert.equal(plan.reason, 'profile_changed');
  assert.equal(plan.unchanged_document_count, 2);
});

test('source revision-only change updates metadata without re-embedding documents', () => {
  const previous = manifest('abc');
  const candidate = manifest('def');
  const plan = planCorpusUpdate({
    previous_manifest: previous,
    candidate_manifest: candidate,
    previous_profiles: profiles,
    candidate_profiles: profiles,
  });

  assert.equal(plan.operation, 'metadata_only');
  assert.equal(plan.reason, 'source_revision_changed');
  assert.equal(plan.unchanged_document_count, 2);
  assert.notEqual(plan.corpus_manifest_ref, previous.corpus_manifest_ref);
});

test('unchanged corpus and profiles are a no-op and incomplete prior state fails closed', () => {
  const current = manifest();
  const noop = planCorpusUpdate({
    previous_manifest: current,
    candidate_manifest: current,
    previous_profiles: profiles,
    candidate_profiles: profiles,
  });

  assert.equal(noop.operation, 'noop');
  assert.throws(() => planCorpusUpdate({
    previous_manifest: current,
    candidate_manifest: current,
    candidate_profiles: profiles,
  }), /CORPUS_PREVIOUS_STATE_INCOMPLETE/);
  assert.throws(() => planCorpusUpdate({
    candidate_manifest: current,
    candidate_profiles: { ...profiles, chunking_profile: 'markdown-window' },
  }), /CORPUS_PROFILES_INVALID/);
  assert.throws(() => planCorpusUpdate({
    previous_manifest: manifest('abc', documents, 'project/another/repo'),
    candidate_manifest: current,
    previous_profiles: profiles,
    candidate_profiles: profiles,
  }), /CORPUS_MANIFEST_SCOPE_MISMATCH/);
});

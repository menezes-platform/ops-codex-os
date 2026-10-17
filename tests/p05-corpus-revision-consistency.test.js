'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createCorpusManifest, planCorpusUpdate } = require('../modules/context-store/src/corpus-manifest');
const scope='project/menezes-platform/ops-codex-os';
const profiles={lexical_profile:'fts5-bm25-v1',vector_profile:'faiss-cosine-v1',embedding_profile:'embed-small-v2',chunking_profile:'markdown-window-v1'};
const document={source_ref:'git:ops-codex-os:README.md',path:'README.md',content:'# Unchanged\n'};
const doc2={source_ref:'git:ops-codex-os:docs/install.md',path:'docs/install.md',content:'Install\n'};
const corpus=(revision, docs=[document,doc2])=>createCorpusManifest({scope,source_revision:revision,documents:docs});
const plan=(prev,next)=>planCorpusUpdate({previous_manifest:prev,candidate_manifest:next,previous_profiles:profiles,candidate_profiles:profiles});

test('new repository revision requires fresh chunks even if every content hash is unchanged',()=>{
  const old=corpus('aaa');const next=corpus('bbb');
  const delta=plan(old,next);
  assert.equal(delta.operation,'rebuild');
  assert.equal(delta.reason,'source_revision_changed');
  assert.equal(delta.unchanged_document_count,2);
  assert.notEqual(delta.corpus_manifest_ref,old.corpus_manifest_ref);
});

test('revision transition with one changed document cannot reuse stale-revision chunks for unchanged documents',()=>{
  const old=corpus('aaa');
  const next=corpus('bbb',[{...document,content:'# Modified\n'},doc2]);
  const delta=plan(old,next);
  assert.equal(delta.operation,'rebuild');
  assert.equal(delta.reason,'source_revision_changed');
  assert.deepEqual(delta.changed,[document.source_ref]);
  assert.equal(delta.unchanged_document_count,1);
});

test('same revision permits incremental edits and metadata noop remains available',()=>{
  const old=corpus('aaa');
  const edited=corpus('aaa',[{...document,content:'# Modified\n'},doc2]);
  assert.equal(plan(old,edited).operation,'incremental');
  assert.equal(plan(old,old).operation,'noop');
});

test('manifest creation rejects control characters and overlong UTF-8 source metadata before digesting',()=>{
  for(const bad of ['git:ops-codex-os:README.md\nsecret','git:ops-codex-os:\0README.md','x'.repeat(2049)]){
    assert.throws(()=>corpus('aaa',[{...document,source_ref:bad}]),/SOURCE_REF_REQUIRED/);
  }
  for(const bad of ['aaa\nspoof','a'.repeat(501),'é'.repeat(260)]){
    assert.throws(()=>corpus(bad),/SOURCE_REVISION_REQUIRED/);
  }
});

test('parsed manifests fail closed on mutated source metadata before digest verification',()=>{
  const valid=corpus('aaa');
  const bad={...valid,documents:[{...valid.documents[0],source_ref:'safe\0malicious'},...valid.documents.slice(1)]};
  const {assertCorpusManifest}=require('../modules/context-store/src/corpus-manifest');
  assert.throws(()=>assertCorpusManifest(bad),/CORPUS_DOCUMENT_INVALID/);
});

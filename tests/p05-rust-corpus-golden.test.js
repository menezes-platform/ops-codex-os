'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs/promises');
const {createCorpusManifest}=require('../modules/context-store/src/corpus-manifest');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {materializeIndexingSnapshot}=require('../modules/context-store/src/indexing-corpus-snapshot');
const input=require('./fixtures/p05-local-public-corpus.json');
const golden=require('./fixtures/p05-rust-corpus-golden.json');

test('pinned Rust-compatible fixture matches real Node manifest and snapshot serialization',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'p05-wire-golden-'));
 try{
  const store=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
  const receipt=await store.putCorpusProjection(input);
  const snapshot=await materializeIndexingSnapshot({corpusStore:store,scope:input.scope,revision:input.source_revision,corpus_manifest_ref:receipt.corpus_manifest_ref});
  const canonical=createCorpusManifest(input);
  assert.deepEqual(golden.manifest,canonical);
  assert.deepEqual(golden.snapshot,snapshot);
  assert.equal(golden.manifest.corpus_manifest_ref,receipt.corpus_manifest_ref);
  assert.deepEqual(Object.keys(golden.snapshot),['scope','revision','manifest_ref','documents']);
  assert.ok(golden.snapshot.documents.every(d=>!d.content.includes('secret')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {materializeIndexingSnapshot}=require('../modules/context-store/src/indexing-corpus-snapshot');

const base={scope:'project/demo/alpha',source_revision:'rev-a',idempotency_key:'job-a',documents:[
 {source_ref:'git:alpha:docs/readme.md',path:'docs/readme.md',content:'# Intro\n\nHello 🌎'},
 {source_ref:'git:alpha:docs/install.md',path:'docs/install.md',content:'# Install\nUse the console'}
]};
async function fixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'p05-index-input-'));
 try {
  const store=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
  return await fn({store,root});
 } finally {await fs.rm(root,{recursive:true,force:true});}
}

test('materialization yields a Rust CorpusSnapshot-shaped object from real immutable on-disk corpus',async()=>fixture(async({store})=>{
 const receipt=await store.putCorpusProjection(base);
 const result=await materializeIndexingSnapshot({corpusStore:store,scope:base.scope,revision:'rev-a',corpus_manifest_ref:receipt.corpus_manifest_ref});
 assert.deepEqual(Object.keys(result),['scope','revision','manifest_ref','documents']);
 assert.equal(result.scope,'project/demo/alpha');
 assert.equal(result.revision,'rev-a');
 assert.equal(result.manifest_ref,receipt.corpus_manifest_ref);
 assert.deepEqual(result.documents,base.documents.slice().sort((a,b)=>a.source_ref.localeCompare(b.source_ref)).map(({source_ref,path,content})=>({source_ref,path,content})));
 assert.equal(Object.isFrozen(result),true);
 assert.equal(Object.isFrozen(result.documents),true);
}));

test('wrong requested source revision rejects before materializing index input',async()=>fixture(async({store})=>{
 const receipt=await store.putCorpusProjection(base);
 await assert.rejects(materializeIndexingSnapshot({corpusStore:store,scope:base.scope,revision:'rev-b',corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_SNAPSHOT_REVISION_MISMATCH/);
}));

test('foreign project cannot reuse the other project manifest to obtain index documents',async()=>fixture(async({store})=>{
 const receipt=await store.putCorpusProjection(base);
 await assert.rejects(materializeIndexingSnapshot({corpusStore:store,scope:'project/demo/beta',revision:'rev-a',corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_OBJECT_UNAVAILABLE|CORPUS_SCOPE_MISMATCH/);
}));

test('empty source files are rejected as unsuitable Rust CorpusDocument input',async()=>fixture(async({store})=>{
 const receipt=await store.putCorpusProjection({...base,idempotency_key:'empty-a',documents:[{source_ref:'git:alpha:empty',path:'empty.md',content:' \n\t '}]});
 await assert.rejects(materializeIndexingSnapshot({corpusStore:store,scope:base.scope,revision:'rev-a',corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_SNAPSHOT_DOCUMENT_INVALID/);
}));

test('invalid scope, revisions or fake manifest digest fail before accessing corpus adapter',async()=>{
 const called=[];
 const corpusStore={readCorpusProjection:async input=>{called.push(input);throw new Error('UNEXPECTED_TRANSPORT');}};
 const bad=[
  {scope:'project/../foo',revision:'rev-a',corpus_manifest_ref:'sha256:'+'a'.repeat(64)},
  {scope:'project/demo/alpha',revision:'  ',corpus_manifest_ref:'sha256:'+'a'.repeat(64)},
  {scope:'project/demo/alpha',revision:'rev-1',corpus_manifest_ref:'SHA256:wrong'},
  {scope:'project/demo/alpha',revision:'e'.repeat(501),corpus_manifest_ref:'sha256:'+'a'.repeat(64)},
 ];
 for(const input of bad)await assert.rejects(materializeIndexingSnapshot({corpusStore,...input}),/CORPUS_SNAPSHOT_REQUEST_INVALID/);
 assert.deepEqual(called,[]);
});

test('malformed or replaced blob cannot be promoted to indexing input',async()=>fixture(async({store,root})=>{
 const receipt=await store.putCorpusProjection(base);
 const corpusDir=path.join(root,'projects','demo','alpha','corpus');
 const files=await fs.readdir(corpusDir);await fs.writeFile(path.join(corpusDir,files[0]),'forged');
 await assert.rejects(materializeIndexingSnapshot({corpusStore:store,scope:base.scope,revision:'rev-a',corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_OBJECT_DIGEST_MISMATCH/);
}));

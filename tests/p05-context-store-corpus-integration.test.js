'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createContextStore}=require('../modules/context-store/src');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const source={scope:'project/demo/alpha',idempotency_key:'run-101',source_revision:'rev-a',documents:[{source_ref:'git:alpha:README.md',path:'README.md',content:'# Alpha'}]};

async function contextFixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'p05-context-'));
 try{
  const durable=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
  const context=createContextStore({driver:{
   readManifest:async()=>{throw new Error('INDEX_MANIFEST_NOT_IMPLEMENTED_OFFLINE')},
   putCorpusProjection:durable.putCorpusProjection,
  }});
  await fn({context,durable,root});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}

test('canonical Context Store writes corpus through injected immutable object adapter',async()=>contextFixture(async({context,durable})=>{
 const receipt=await context.putCorpusProjection(source);
 assert.equal(receipt.scope,source.scope);
 assert.equal(receipt.status,'stored');
 const res=await durable.readCorpusProjection({scope:source.scope,corpus_manifest_ref:receipt.corpus_manifest_ref});
 assert.equal(res.documents[0].content,'# Alpha');
}));

test('canonical Context Store replays the same idempotency key across calls and rejects a changed body',async()=>contextFixture(async({context})=>{
 const first=await context.putCorpusProjection(source);
 const again=await context.putCorpusProjection(source);
 assert.equal(first.corpus_manifest_ref,again.corpus_manifest_ref);
 assert.equal(again.status,'replayed');
 await assert.rejects(context.putCorpusProjection({...source,documents:[{...source.documents[0],content:'# Other'}]}),/CORPUS_IDEMPOTENCY_CONFLICT/);
}));

test('Context Store prevents untrusted scope and traversal before corpus mutation',async()=>contextFixture(async({context})=>{
 await assert.rejects(context.putCorpusProjection({...source,scope:'*'}),/INVALID_PROJECT_SCOPE/);
 await assert.rejects(context.putCorpusProjection({...source,documents:[{...source.documents[0],path:'../secret'}]}),/SOURCE_PATH_INVALID/);
}));

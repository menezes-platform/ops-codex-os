'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
async function tempRoot(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'p05-corpus-'));try{return await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
const query={scope:'project/demo/alpha',source_revision:'a1',idempotency_key:'local-001',documents:[{source_ref:'git:alpha:README.md',path:'README.md',content:'durable data'}]};
test('an offline corpus is durable across adapter restart using real file bytes',async()=>tempRoot(async(root)=>{
 const a=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
 const receipt=await a.putCorpusProjection(query);
 const b=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
 const snapshot=await b.readCorpusProjection({scope:query.scope,corpus_manifest_ref:receipt.corpus_manifest_ref});
 assert.equal(snapshot.documents[0].content,'durable data');
 assert.equal(snapshot.manifest.source_revision,'a1');
}));
test('atomic file create never silently replaces immutable bytes',async()=>tempRoot(async(root)=>{
 const t=await createLocalCorpusObjectTransport({root});
 const key='projects/demo/alpha/corpus/'+'a'.repeat(64);
 await t.putObjectIfAbsent({key,content:Buffer.from('first')});
 await t.putObjectIfAbsent({key,content:Buffer.from('second')});
 assert.equal((await t.getObject({key})).toString(),'first');
}));
test('concurrent identical corpus uploads do not create divergent objects',async()=>tempRoot(async(root)=>{
 const a=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
 const b=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
 const [first,second]=await Promise.all([a.putCorpusProjection(query),b.putCorpusProjection(query)]);
 assert.equal(first.corpus_manifest_ref,second.corpus_manifest_ref);
}));
test('rejects traversal and paths outside the immutable content-addressed layout',async()=>tempRoot(async(root)=>{
 const t=await createLocalCorpusObjectTransport({root});
 for(const key of ['../../.ssh/id_rsa','projects/../alpha/corpus/'+'f'.repeat(64),'projects/demo/alpha/corpus/not-a-digest','projects/demo/alpha/manifests/../../etc/passwd','/root/.ssh/id_rsa']){
  await assert.rejects(t.getObject({key}),/CORPUS_OBJECT_KEY_INVALID/,key);
  await assert.rejects(t.putObjectIfAbsent({key,content:Buffer.from('x')}),/CORPUS_OBJECT_KEY_INVALID/,key);
 }
}));
test('rejects symlink-backed project root instead of reading foreign filesystem',async()=>tempRoot(async(root)=>{
 const foreign=await fs.mkdtemp(path.join(os.tmpdir(),'p05-foreign-'));
 try{
  await fs.mkdir(path.join(root,'projects','demo'),{recursive:true});
  await fs.symlink(foreign,path.join(root,'projects','demo','alpha'));
  const t=await createLocalCorpusObjectTransport({root});
  const key='projects/demo/alpha/corpus/'+'a'.repeat(64);
  await assert.rejects(t.putObjectIfAbsent({key,content:Buffer.from('secret')}),/CORPUS_OBJECT_PATH_UNSAFE/);
  await assert.rejects(t.getObject({key}),/CORPUS_OBJECT_PATH_UNSAFE/);
 }finally{await fs.rm(foreign,{recursive:true,force:true});}
}));
test('rejects final-file symlink even under a permitted project directory',async()=>tempRoot(async(root)=>{
 const t=await createLocalCorpusObjectTransport({root});
 const key='projects/demo/alpha/corpus/'+'c'.repeat(64);
 const foreign=path.join(root,'foreign');await fs.writeFile(foreign,'PRIVATE');
 const parent=path.join(root,'projects','demo','alpha','corpus');await fs.mkdir(parent,{recursive:true});
 await fs.symlink(foreign,path.join(parent,'c'.repeat(64)));
 await assert.rejects(t.getObject({key}),/CORPUS_OBJECT_PATH_UNSAFE/);
 await assert.rejects(t.putObjectIfAbsent({key,content:Buffer.from('x')}),/CORPUS_OBJECT_PATH_UNSAFE/);
}));

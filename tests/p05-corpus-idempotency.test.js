'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDriveCorpusStore } = require('../modules/context-store/src/drive-corpus-store');
const { createLocalCorpusObjectTransport } = require('../modules/context-store/src/local-corpus-transport');
const scope = 'project/demo/alpha';
const docs = [{source_ref:'git:alpha:README.md',path:'README.md',content:'first immutable body'}];
const request = (extra={}) => ({scope,source_revision:'rev-1',idempotency_key:'job-001',documents:docs,...extra});
function memoryTransport(){
 const objects=new Map(),writes=[];
 return {objects,writes,
  async putObjectIfAbsent({key,content}) { writes.push(key);if(!objects.has(key))objects.set(key,Buffer.from(content)); },
  async getObject({key}) { return objects.get(key) || null; },
 };
}

test('missing or invalid idempotency key never touches transport',async()=>{
 const transport=memoryTransport(), store=createDriveCorpusStore({transport});
 for(const key of [undefined,'',' ','bad\nkey','x'.repeat(201)]){
  await assert.rejects(store.putCorpusProjection(request({idempotency_key:key})),/IDEMPOTENCY_KEY_INVALID/);
 }
 assert.equal(transport.writes.length,0);
});

test('identical key and manifest return an immutable replay receipt across new store instances',async()=>{
 const transport=memoryTransport();
 const a=createDriveCorpusStore({transport});
 const first=await a.putCorpusProjection(request());
 const count=transport.writes.length;
 const b=createDriveCorpusStore({transport});
 const second=await b.putCorpusProjection(request());
 assert.equal(first.status,'stored');
 assert.equal(second.status,'replayed');
 assert.equal(second.corpus_manifest_ref,first.corpus_manifest_ref);
 assert.equal(transport.writes.length,count);
 assert.ok(transport.writes.some(k=>k.includes('/receipts/')));
});

test('reused key with changed source revision or content fails before any candidate uploads',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 await store.putCorpusProjection(request());
 const count=transport.writes.length;
 for(const candidate of [request({source_revision:'rev-2'}),request({documents:[{...docs[0],content:'new body'}]})]) {
  await assert.rejects(store.putCorpusProjection(candidate),/CORPUS_IDEMPOTENCY_CONFLICT/);
  assert.equal(transport.writes.length,count);
 }
});

test('one idempotency key is scoped to each independent project',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const a=await store.putCorpusProjection(request());
 const b=await store.putCorpusProjection(request({scope:'project/demo/beta'}));
 assert.notEqual(a.corpus_manifest_ref,b.corpus_manifest_ref);
 assert.equal(transport.writes.filter(k=>k.includes('/receipts/')).length,2);
});

test('concurrent writers with same key and different content admit a single winner',async()=>{
 const transport=memoryTransport(),a=createDriveCorpusStore({transport}),b=createDriveCorpusStore({transport});
 const results=await Promise.allSettled([
  a.putCorpusProjection(request()),
  b.putCorpusProjection(request({documents:[{...docs[0],content:'conflicting body'}]})),
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.message==='CORPUS_IDEMPOTENCY_CONFLICT').length,1);
 const winner=results.find(r=>r.status==='fulfilled').value;
 const snapshot=await a.readCorpusProjection({scope,corpus_manifest_ref:winner.corpus_manifest_ref});
 assert.equal(snapshot.documents.length,1);
});

test('corrupted idempotency receipt is rejected without uploading new content',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 await store.putCorpusProjection(request());
 const receiptKey=transport.writes.find(k=>k.includes('/receipts/'));
 transport.objects.set(receiptKey,Buffer.from('{"garbage":true}'));
 const count=transport.writes.length;
 await assert.rejects(store.putCorpusProjection(request()),/CORPUS_RECEIPT_INVALID/);
 assert.equal(transport.writes.length,count);
});

test('replay cannot succeed if previously acknowledged corpus data disappeared',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 await store.putCorpusProjection(request());
 const contentKey=transport.writes.find(k=>k.includes('/corpus/'));
 transport.objects.delete(contentKey);
 await assert.rejects(store.putCorpusProjection(request()),/CORPUS_OBJECT_UNAVAILABLE/);
});

test('idempotency survives actual filesystem restart without overwriting existing objects',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'p05-idem-'));
 try{
  const a=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
  const first=await a.putCorpusProjection(request());
  const b=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root})});
  const second=await b.putCorpusProjection(request());
  assert.equal(first.corpus_manifest_ref,second.corpus_manifest_ref);
  assert.equal(second.status,'replayed');
  await assert.rejects(b.putCorpusProjection(request({source_revision:'new'})),/CORPUS_IDEMPOTENCY_CONFLICT/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('detached store method can replay without relying on caller this binding',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const put=store.putCorpusProjection;
 await put(request());
 const replayed=await put(request());
 assert.equal(replayed.status,'replayed');
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const {createCorpusManifest}=require('../modules/context-store/src/corpus-manifest');
function memoryTransport(){
 const objects=new Map(),reads=[],writes=[];
 return {
  objects,reads,writes,
  async putObjectIfAbsent({key,content}) {writes.push(key);if(!objects.has(key))objects.set(key,Buffer.from(content));},
  async getObject({key}){reads.push(key);return objects.get(key)||null;}
 };
}
const scope='project/demo/alpha';
const other='project/demo/beta';
const docs=[{source_ref:'git:alpha:README.md',path:'README.md',content:'# Alpha'},{source_ref:'git:alpha:docs/a.md',path:'docs/a.md',content:'Reference text'}];
const input=(project=scope, documents=docs)=>({scope:project,source_revision:'abc',documents,idempotency_key:'corpus-v1'});
test('constructor requires immutable object APIs',()=>{
 assert.throws(()=>createDriveCorpusStore({}),/CORPUS_TRANSPORT_REQUIRED/);
 assert.throws(()=>createDriveCorpusStore({transport:{putObjectIfAbsent(){}}}),/CORPUS_TRANSPORT_REQUIRED/);
});
test('persists and reads exact content-addressed corpus with no unscoped object keys',async()=>{
 const transport=memoryTransport(), store=createDriveCorpusStore({transport});
 const receipt=await store.putCorpusProjection(input());
 assert.equal(receipt.scope,scope);
 assert.match(receipt.corpus_manifest_ref,/^sha256:[a-f0-9]{64}$/);
 assert.ok(transport.writes.every(x=>x.startsWith('projects/demo/alpha/')));
 assert.equal(transport.writes.filter(x=>x.includes('/manifests/')).length,1);
 const result=await store.readCorpusProjection({scope,corpus_manifest_ref:receipt.corpus_manifest_ref});
 assert.deepEqual(result.documents,[...docs].sort((a,b)=>a.source_ref<b.source_ref?-1:a.source_ref>b.source_ref?1:0));
 assert.equal(result.manifest.source_revision,'abc');
});
test('identical document content deduplicates immutable object writes',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const duplicateText=[{source_ref:'git:alpha:x',path:'x',content:'same'}, {source_ref:'git:alpha:y',path:'y',content:'same'}];
 await store.putCorpusProjection(input(scope,duplicateText));
 assert.equal(transport.writes.filter(x=>x.includes('/corpus/')).length,1);
});
test('a foreign project manifest cannot be materialized through requested scope',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const foreign=await store.putCorpusProjection(input(other,[{source_ref:'git:beta:x',path:'x',content:'beta'}]));
 const localManifestKey='projects/demo/alpha/manifests/'+foreign.corpus_manifest_ref.slice(7)+'.json';
 transport.objects.set(localManifestKey,Buffer.from(JSON.stringify(createCorpusManifest(input(other,[{source_ref:'git:beta:x',path:'x',content:'beta'}])))));
 transport.reads.length=0;
 await assert.rejects(store.readCorpusProjection({scope,corpus_manifest_ref:foreign.corpus_manifest_ref}),/CORPUS_SCOPE_MISMATCH/);
 assert.deepEqual(transport.reads,[localManifestKey]);
});
test('object corruption fails closed before returning any document',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const receipt=await store.putCorpusProjection(input());
 const objKey=transport.writes.find(x=>x.includes('/corpus/'));
 transport.objects.set(objKey,Buffer.from('corrupted'));
 await assert.rejects(store.readCorpusProjection({scope,corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_OBJECT_DIGEST_MISMATCH/);
});
test('manifest checksum tampering fails before opening any document objects',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const receipt=await store.putCorpusProjection(input());
 const manifestKey=transport.writes.find(x=>x.includes('/manifests/'));
 const parsed=JSON.parse(transport.objects.get(manifestKey).toString());
 parsed.source_revision='forged';transport.objects.set(manifestKey,Buffer.from(JSON.stringify(parsed)));
 transport.reads.length=0;
 await assert.rejects(store.readCorpusProjection({scope,corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_MANIFEST_INVALID/);
 assert.deepEqual(transport.reads,[manifestKey]);
});
test('failed object upload does not publish a manifest',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 let attempt=0;
 transport.putObjectIfAbsent=async ({key,content})=>{if(++attempt===2)throw Error('backend-details-secret');transport.writes.push(key);transport.objects.set(key,Buffer.from(content));};
 await assert.rejects(store.putCorpusProjection(input()),/CORPUS_OBJECT_UNAVAILABLE/);
 assert.ok(transport.writes.every(x=>!x.includes('/manifests/')));
});
test('rejects forged digest, arbitrary path and foreign project before transport',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 for (const ref of ['sha256:wrong','../../etc/passwd']){
  await assert.rejects(store.readCorpusProjection({scope,corpus_manifest_ref:ref}),/CORPUS_MANIFEST_REF_INVALID/);
 }
 await assert.rejects(store.readCorpusProjection({scope:'project/../alpha',corpus_manifest_ref:'sha256:'+'a'.repeat(64)}),/INVALID_PROJECT_SCOPE/);
 assert.equal(transport.reads.length,0);
});
test('repeated same revision returns identical immutable object keys and digest',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const a=await store.putCorpusProjection(input());
 const initial=transport.objects.size;
 const b=await store.putCorpusProjection(input());
 assert.equal(a.corpus_manifest_ref,b.corpus_manifest_ref);
 assert.equal(transport.objects.size,initial);
});
test('backend acknowledgement without durable bytes must not publish manifest',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 transport.putObjectIfAbsent=async ({key})=>{transport.writes.push(key);};
 await assert.rejects(store.putCorpusProjection(input()),/CORPUS_OBJECT_UNAVAILABLE/);
 assert.equal(transport.writes.some(key=>key.includes('/manifests/')),false);
});
test('an already existing object with the wrong bytes is rejected before manifest',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 const preexisting=Buffer.from(docs[0].content);
 const {createHash}=require('node:crypto');
 const digest=createHash('sha256').update(preexisting).digest('hex');
 transport.objects.set('projects/demo/alpha/corpus/'+digest,Buffer.from('bad'));
 await assert.rejects(store.putCorpusProjection(input()),/CORPUS_OBJECT_DIGEST_MISMATCH/);
 assert.equal(transport.writes.some(key=>key.includes('/manifests/')),false);
});
test('same document hash stays in different project physical namespaces',async()=>{
 const transport=memoryTransport(), store=createDriveCorpusStore({transport});
 const same=[{source_ref:'git:neutral:README.md',path:'README.md',content:'shared public content'}];
 const alpha=await store.putCorpusProjection(input(scope,same));
 const beta=await store.putCorpusProjection(input(other,same));
 assert.notEqual(alpha.corpus_manifest_ref,beta.corpus_manifest_ref);
 const keys=transport.writes.filter(key=>key.includes('/corpus/'));
 assert.equal(keys.length,2);
 assert.ok(keys[0].startsWith('projects/demo/alpha/'));
 assert.ok(keys[1].startsWith('projects/demo/beta/'));
});
test('missing corpus object cannot be materialized as partial success',async()=>{
 const transport=memoryTransport(), store=createDriveCorpusStore({transport});
 const receipt=await store.putCorpusProjection(input());
 transport.objects.delete(transport.writes.find(key=>key.includes('/corpus/')));
 await assert.rejects(store.readCorpusProjection({scope,corpus_manifest_ref:receipt.corpus_manifest_ref}),/CORPUS_OBJECT_UNAVAILABLE/);
});
test('transport errors are sanitized instead of leaking provider credentials',async()=>{
 const transport=memoryTransport(),store=createDriveCorpusStore({transport});
 transport.putObjectIfAbsent=async()=>{throw new Error('Bearer TOP-SECRET-TOKEN');};
 await assert.rejects(store.putCorpusProjection(input()),error=>error.message==='CORPUS_OBJECT_UNAVAILABLE');
});

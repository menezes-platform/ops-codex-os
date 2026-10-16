'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {createDrivePersonalStore} = require('../modules/context-store/src/drive-personal-store');
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function sample(content='A sample event') {
 return {event_id:'evt-one',scope:'personal/current',kind:'observation',source_type:'manual',
 source_ref:'manual:one',source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',
 content_sha256:hash(content),content,consent_receipt_id:'consent-1',schema_version:1};
}
function memoryTransport({corrupt=false}={}) {
 const objects=new Map();
 return {objects,
  async putObjectIfAbsent({key,content}) { if(!objects.has(key)) objects.set(key,corrupt?Buffer.from('corrupt'):Buffer.from(content)); },
  async getObject({key}) {return objects.get(key)||null;}
 };
}
test('task_15_contract creates immutable event and replayable receipt',async()=>{
 const transport=memoryTransport();
 const store=createDrivePersonalStore({transport});
 const a=await store.putEvent({event:sample(),idempotency_key:'idem-1'});
 assert.equal(a.status,'stored');
 assert.match(a.manifest_ref,/^sha256:[a-f0-9]{64}$/);
 assert.equal((await store.readEvent({event_id:'evt-one'})).content,'A sample event');
 const b=await store.putEvent({event:sample(),idempotency_key:'idem-1'});
 assert.equal(b.status,'replayed');
 assert.equal(transport.objects.size,2);
 await assert.rejects(store.putEvent({event:sample('Different data'),idempotency_key:'idem-1'}),/CONFLICT/);
 await assert.rejects(store.putEvent({event:sample('Different data'),idempotency_key:'idem-2'}),/CONFLICT/);
});
test('task_15_contract rejects acknowledged corrupt storage',async()=>{
 const store=createDrivePersonalStore({transport:memoryTransport({corrupt:true})});
 await assert.rejects(store.putEvent({event:sample(),idempotency_key:'idem-1'}),/DIGEST_MISMATCH/);
});
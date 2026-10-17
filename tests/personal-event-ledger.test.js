'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createDrivePersonalStore}=require('../modules/context-store/src/drive-personal-store');
const {createPersonalEventLedger}=require('../modules/context-store/src/personal-event-ledger');
const sha=s=>'sha256:'+createHash('sha256').update(s).digest('hex');
const make=(id='evt-a',content='Synthetic note')=>({
 event_id:id,scope:'personal/current',kind:'observation',source_type:'manual',
 source_ref:'manual:'+id,source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',
 content_sha256:sha(content),content,consent_receipt_id:'consent-1',schema_version:1
});
const transport=()=>{
 const m=new Map();return {async putObjectIfAbsent({key,content}){if(!m.has(key))m.set(key,Buffer.from(content))},
 async getObject({key}){return m.get(key)||null},async listObjectKeys({prefix}){return [...m.keys()].filter(x=>x.startsWith(prefix))}}
};
test('task_16_contract append replay conflict and durable tombstone',async()=>{
 const store=createDrivePersonalStore({transport:transport()});
 const ledger=createPersonalEventLedger({store});
 assert.equal((await ledger.appendOrTombstone({op:'append',event:make(),idempotency_key:'write-a'})).status,'stored');
 assert.equal((await ledger.appendOrTombstone({op:'append',event:make(),idempotency_key:'write-a'})).status,'replayed');
 await assert.rejects(ledger.appendOrTombstone({op:'append',event:make('evt-b'),idempotency_key:'write-a'}),/CONFLICT/);
 assert.deepEqual((await ledger.listActive()).map(x=>x.event_id),['evt-a']);
 const receipt=await ledger.appendOrTombstone({op:'tombstone',event_id:'delete-a',
 target_event_id:'evt-a',consent_receipt_id:'consent-1',observed_at:'2026-10-15T19:00:00Z',idempotency_key:'delete-a'});
 assert.equal(receipt.status,'stored');
 assert.deepEqual(await createPersonalEventLedger({store}).listActive(),[]);
 await assert.rejects(ledger.appendOrTombstone({op:'append',event:make(),idempotency_key:'write-c'}),/TOMBSTONED/);
});
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {createDrivePersonalStore}=require('../modules/context-store/src/drive-personal-store');
const {createPersonalEventLedger}=require('../modules/context-store/src/personal-event-ledger');
const {exportPersonalArchive,importPersonalArchive}=require('../modules/context-store/src/personal-archive');
const hash=s=>'sha256:'+createHash('sha256').update(s).digest('hex');
const evt=(id,content)=>({event_id:id,scope:'personal/current',kind:'observation',source_type:'manual',
 source_ref:'manual:'+id,source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',
 content_sha256:hash(content),content,consent_receipt_id:'consent-1',schema_version:1});
function newLedger(){
 const objects=new Map();
 const transport={async getObject({key}){return objects.get(key)||null},
 async putObjectIfAbsent({key,content}){if(!objects.has(key))objects.set(key,Buffer.from(content))},
 async listObjectKeys({prefix}){return [...objects.keys()].filter(k=>k.startsWith(prefix))}};
 return createPersonalEventLedger({store:createDrivePersonalStore({transport})});
}
const bytes=async iterable=>{let value='';for await(const c of iterable)value+=c.toString();return value};
test('task_18_contract portable archive restores events and tombstones without Engram',async()=>{
 const source=newLedger();
 await source.appendOrTombstone({op:'append',event:evt('x1','Synthetic durable note'),idempotency_key:'append-x1'});
 await source.appendOrTombstone({op:'tombstone',event_id:'del-x1',target_event_id:'x1',consent_receipt_id:'consent-1',
 observed_at:'2026-10-15T19:00:00Z',idempotency_key:'del-x1'});
 const archive=await bytes(await exportPersonalArchive({ledger:source}));
 const target=newLedger();
 const dry=await importPersonalArchive({stream:Readable.from([archive]),ledger:target,dryRun:true});
 assert.equal(dry.imported,0);
 assert.equal((await target.listAll()).length,0);
 const result=await importPersonalArchive({stream:Readable.from([archive]),ledger:target,dryRun:false,ownerApproved:true});
 assert.equal(result.imported,2);
 assert.equal((await target.listAll()).length,2);
 assert.deepEqual(await target.listActive(),[]);
 const replay=await importPersonalArchive({stream:Readable.from([archive]),ledger:target,dryRun:false,ownerApproved:true});
 assert.equal(replay.imported,0);
});
test('task_18_contract tampered archive aborts before any writes',async()=>{
 const source=newLedger();
 await source.appendOrTombstone({op:'append',event:evt('x1','Synthetic durable note'),idempotency_key:'append-x1'});
 const good=await bytes(await exportPersonalArchive({ledger:source}));
 const bad=good.replace('Synthetic durable note','malicious altered note');
 const target=newLedger();
 await assert.rejects(importPersonalArchive({stream:Readable.from([bad]),ledger:target,dryRun:false,ownerApproved:true}),/ARCHIVE_/);
 assert.equal((await target.listAll()).length,0);
});
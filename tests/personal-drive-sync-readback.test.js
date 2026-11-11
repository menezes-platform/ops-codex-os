'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncPersonalChanges}=require('../modules/context-store/src/personal-drive-sync');
const DIGEST='sha256:'+'a'.repeat(64);
const change=(id='first')=>({op:'append',idempotency_key:id,event:{scope:'personal/current',data:'alpha'}});
function run(changes,ledger){
 let cursor='c0';
 return {promise:syncPersonalChanges({cursorStore:{async get(){return cursor},async set(value){cursor=value}},drive:{async listChanges(){return {changes,next_cursor:'c1'}}},ledger}),cursor:()=>cursor};
}
test('missing readback adapter blocks writes and cursor advance',async()=>{
 let writes=0;const a=run([change()],{async appendOrTombstone(){writes++;return {status:'stored',manifest_ref:DIGEST}}});
 await assert.rejects(a.promise,/SYNC_READBACK_REQUIRED/);assert.equal(a.cursor(),'c0');assert.equal(writes,0);
});
test('ACK without matching independently reread content cannot advance cursor',async()=>{
 const a=run([change()],{async appendOrTombstone(){return {status:'stored',manifest_ref:DIGEST}},async readByIdempotencyKey(){return {manifest_ref:DIGEST,change:{...change(),event:{scope:'personal/current',data:'tampered'}}}}});
 await assert.rejects(a.promise,/SYNC_READBACK_MISMATCH/);assert.equal(a.cursor(),'c0');
});
test('different returned manifest digest prevents cursor advance',async()=>{
 const a=run([change()],{async appendOrTombstone(){return {status:'stored',manifest_ref:DIGEST}},async readByIdempotencyKey(){return {manifest_ref:'sha256:'+'b'.repeat(64),change:change()}}});
 await assert.rejects(a.promise,/SYNC_READBACK_MISMATCH/);assert.equal(a.cursor(),'c0');
});
test('readback of original change permits exactly one committed cursor advance',async()=>{
 let persisted;const a=run([change(),change()],{
  async appendOrTombstone(event){persisted=structuredClone(event);return {status:'stored',manifest_ref:DIGEST}},
  async readByIdempotencyKey(){return {manifest_ref:DIGEST,change:persisted}}
 });
 assert.deepEqual(await a.promise,{cursor:'c1',applied:1});assert.equal(a.cursor(),'c1');
});
test('unscoped tombstone cannot delete across personal/project boundaries',async()=>{
 const a=run([{op:'tombstone',idempotency_key:'del1',target_id:'old'}],{
  async appendOrTombstone(){return {status:'stored',manifest_ref:DIGEST}},async readByIdempotencyKey(){throw Error('must not read')}});
 await assert.rejects(a.promise,/SYNC_SCOPE_INVALID/);assert.equal(a.cursor(),'c0');
});

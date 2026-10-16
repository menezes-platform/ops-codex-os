'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {syncPersonalChanges}=require('../modules/context-store/src/personal-drive-sync');
test('task_17_contract advances cursor only after verified writes and handles duplicates',async()=>{
 let cursor='c0';const applied=[];
 const cursorStore={async get(){return cursor},async set(value){cursor=value}};
 const drive={async listChanges(){return {changes:[
  {op:'append',idempotency_key:'a1',event:{scope:'personal/current'}},
  {op:'append',idempotency_key:'a1',event:{scope:'personal/current'}}],next_cursor:'c1'}}};
 const ledger={async appendOrTombstone(cmd){applied.push(cmd.idempotency_key);return {status:applied.length===1?'stored':'replayed',manifest_ref:'sha256:'+'a'.repeat(64)}}};
 const result=await syncPersonalChanges({cursorStore,drive,ledger});
 assert.deepEqual(result,{cursor:'c1',applied:1});assert.equal(cursor,'c1');
});
test('task_17_contract failed write cannot skip cursor',async()=>{
 let cursor='c0';const cursorStore={async get(){return cursor},async set(c){cursor=c}};
 const drive={async listChanges(){return {changes:[{op:'append',idempotency_key:'a',event:{scope:'personal/current'}}],next_cursor:'c1'}}};
 const ledger={async appendOrTombstone(){throw Error('backend unavailable')}};
 await assert.rejects(syncPersonalChanges({cursorStore,drive,ledger}),/backend unavailable/);
 assert.equal(cursor,'c0');
});
test('task_17_contract reconciles expired cursor from full snapshot',async()=>{
 let cursor='expired';const cursorStore={async get(){return cursor},async set(c){cursor=c}};
 const drive={async listChanges(){throw Object.assign(Error('expired'),{code:'CURSOR_EXPIRED'})},
 async fullSnapshot(){return {changes:[{op:'append',idempotency_key:'full',event:{scope:'personal/current'}}],next_cursor:'fresh'}}};
 const ledger={async appendOrTombstone(){return {status:'stored',manifest_ref:'sha256:'+'a'.repeat(64)}}};
 assert.deepEqual(await syncPersonalChanges({cursorStore,drive,ledger}),{cursor:'fresh',applied:1});
});
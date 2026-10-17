'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recordRecallAudit}=require('../modules/context-gateway/src/recall-audit');
test('task_33_contract audit contains no private query, bearer or content',()=>{
 const out=recordRecallAudit({request:{query:'password=very_private_value',secret:'token'},
 receipt:{required:true,status:'ok',generation_id:'g1',evidence_count:3,latency_ms:15,content:'private document'}});
 const serial=JSON.stringify(out);
 assert(!serial.includes('very_private_value'));assert(!serial.includes('private document'));assert(!serial.includes('token'));
 assert.equal(out.status,'ok');assert.equal(out.evidence_count,3);
});
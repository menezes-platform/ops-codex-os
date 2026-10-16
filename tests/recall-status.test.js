'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeRecallStatus}=require('../modules/context-gateway/src/recall-status');
test('task_31_contract reports unavailable, miss and stale without fabricated evidence',()=>{
 const lost=normalizeRecallStatus({primary:{status:'unavailable'},secondary:null,policy:{allowEngram:false}});
 assert.equal(lost.status,'unavailable');assert.deepEqual(lost.evidence,[]);
 const empty=normalizeRecallStatus({primary:{status:'ok',evidence:[]},policy:{}});
 assert.equal(empty.status,'miss');assert.deepEqual(empty.evidence,[]);
 const stale=normalizeRecallStatus({primary:{status:'stale',evidence:[]},policy:{}});
 assert.equal(stale.status,'stale');
});
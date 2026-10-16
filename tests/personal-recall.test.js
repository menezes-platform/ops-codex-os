'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPersonalRecall}=require('../modules/context-gateway/src/personal-recall');
test('task_28_contract trusted runtime selects personal scope and rejects model scope',async()=>{
 const captured=[];
 const runtime=createPersonalRecall({
   ownerResolver:async()=>({verified:true,principal_id:'owner-123'}),
   executionPlaneClient:{async retrieve(request){
    captured.push(request);
    return {status:'ok',generation_id:'gen-1',
     evidence:[{evidence_id:'e1',scope:'personal/current',owner_principal_id:'owner-123',content:'Synthetic note'}]};
   }}
 });
 const result=await runtime.recall({query:'past decisions'});
 assert.equal(result.status,'ok');
 assert.equal(captured[0].scope,'personal/current');
 await assert.rejects(runtime.recall({query:'past decisions',scope:'project/other/repo'}),/REQUEST_FIELD_INVALID/);
});
test('task_28_contract unverified owner or foreign owner evidence is denied',async()=>{
 const unverified=createPersonalRecall({
  ownerResolver:async()=>({verified:false,principal_id:'owner-123'}),
  executionPlaneClient:{async retrieve(){throw Error('must not run')}}});
 await assert.rejects(unverified.recall({query:'x'}),/OWNER_NOT_VERIFIED/);
 const foreign=createPersonalRecall({ownerResolver:async()=>({verified:true,principal_id:'owner-123'}),
  executionPlaneClient:{async retrieve(){return {status:'ok',evidence:[{scope:'personal/current',owner_principal_id:'other'}]}}}});
 await assert.rejects(foreign.recall({query:'x'}),/FOREIGN_OWNER/);
});
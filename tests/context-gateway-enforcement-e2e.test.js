'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createContextGateway}=require('../modules/context-gateway/src');
test('controlled Gateway answerWithContext fetches verified episodic context before answer',async()=>{
 const order=[];
 const content='We selected Drive-first memory';
 const gateway=createContextGateway({
  resolveProjectScope:async()=> 'project/example/repo',
  resolvePersonalOwner:async()=>({verified:true,principal_id:'owner-123'}),
  executionPlaneClient:{
   async indexProject(){},
   async retrieve(input){
    order.push('retrieval');assert.equal(input.scope,'personal/current');
    return {status:'ok',generation_id:'g1',revision:'r1',evidence:[{
     evidence_id:'e1',scope:'personal/current',owner_principal_id:'owner-123',source_ref:'manual:1',
     source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',generation_id:'g1',
     content,content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),retrieval_method:'bm25'}]};
   }
  }
 });
 const result=await gateway.answerWithContext({userIntent:{text:'What did we decide last time?',domain:'personal'},
  historyReferences:true,answerProducer:async({evidence})=>{order.push('answer');return evidence[0].content}});
 assert.deepEqual(order,['retrieval','answer']);
 assert.equal(result.answer,content);assert.equal(result.receipt.status,'ok');
});
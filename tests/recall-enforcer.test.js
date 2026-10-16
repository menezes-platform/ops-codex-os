'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {enforceRecall}=require('../modules/context-gateway/src/recall-enforcer');
test('task_32_contract retrieval strictly precedes answering remembered facts',async()=>{
 const order=[];
 const result=await enforceRecall({
  intent:{userIntent:{text:'What did we decide?',domain:'personal'},availableScopes:['personal/current'],historyReferences:true},
  gateway:{async recall(){order.push('recall');return {status:'ok',evidence:[{evidence_id:'e1',scope:'personal/current',content:'Approved a reversible approach'}],generation_id:'g1'}}},
  answerProducer:async ({evidence})=>{order.push('answer');assert.equal(evidence.length,1);return 'Evidence-backed answer';}
 });
 assert.deepEqual(order,['recall','answer']);assert.equal(result.answer,'Evidence-backed answer');
 assert.equal(result.receipt.status,'ok');
});
test('task_32_contract missing or down retrieval blocks answer producer',async()=>{
 let calls=0;
 const intent={userIntent:{text:'as we decided',domain:'personal'},availableScopes:['personal/current'],historyReferences:true};
 const failed=await enforceRecall({intent,gateway:{async recall(){throw Error('offline')}},answerProducer:async()=>{calls++;return 'fabrication'}});
 assert.equal(failed.answer,null);assert.equal(failed.receipt.status,'unavailable');assert.equal(calls,0);
 const missing=await enforceRecall({intent:{...intent,availableScopes:[]},gateway:{async recall(){calls++;return {status:'ok',evidence:[{}]}}},answerProducer:async()=>{calls++}});
 assert.equal(missing.receipt.status,'unavailable');assert.equal(calls,0);
});
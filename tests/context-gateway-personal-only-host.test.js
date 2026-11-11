'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createContextGateway}=require('../modules/context-gateway/src');

function personalEvidence(content) {
 return {status:'ok',generation_id:'g1',revision:'v1',evidence:[{
  evidence_id:'e1',scope:'personal/current',owner_principal_id:'verified-owner',
  source_ref:'manual:verified',source_revision:'v1',generation_id:'g1',
  observed_at:'2026-11-11T15:00:00Z',content,
  content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),retrieval_method:'bm25'
 }]};
}

test('a personal-only gateway can recall with verified owner and no project resolver or indexing writer',async()=>{
 const observed=[];
 const gateway=createContextGateway({
  executionPlaneClient:{async retrieve(input){observed.push(input);return personalEvidence('Approved existing ChatGPT subscription for automation')}},
  resolvePersonalOwner:async()=>({verified:true,principal_id:'verified-owner'})
 });
 const result=await gateway.answerWithContext({
  userIntent:{text:'What was my preference?',domain:'personal',contextDependent:true},
  answerProducer:async({evidence})=>evidence[0].content
 });
 assert.equal(result.receipt.status,'ok');
 assert.match(result.answer,/existing ChatGPT subscription/);
 assert.deepEqual(observed.map(r=>r.scope),['personal/current']);
});

test('a broken project scope resolver must not prevent verified personal recall',async()=>{
 let projectCalls=0;
 const gateway=createContextGateway({
  executionPlaneClient:{async retrieve(){return personalEvidence('personal memory')}},
  resolveProjectScope:async()=>{projectCalls++;throw Error('NO_PROJECT_CHECKOUT')},
  resolvePersonalOwner:async()=>({verified:true,principal_id:'verified-owner'})
 });
 const result=await gateway.answerWithContext({
  userIntent:{text:'What did I decide?',domain:'personal'},historyReferences:true,
  answerProducer:async({evidence})=>evidence[0].content
 });
 assert.equal(result.receipt.status,'ok');
 assert.equal(projectCalls,0);
});

test('a personal-only host cannot query project scope or issue project reindex',async()=>{
 let reads=0;
 const gateway=createContextGateway({
  executionPlaneClient:{async retrieve(){reads++;return personalEvidence('personal memory')}},
  resolvePersonalOwner:async()=>({verified:true,principal_id:'verified-owner'})
 });
 const answer=await gateway.answerWithContext({
  userIntent:{text:'What did project A decide?',domain:'project'},historyReferences:true,
  answerProducer:async()=>{throw Error('UNAUTHORIZED_PROJECT_ANSWER')}
 });
 assert.equal(answer.answer,null);
 assert.equal(answer.receipt.status,'unavailable');
 assert.equal(reads,0);
 await assert.rejects(gateway.recall({query:'secret',filters:{}}),/PROJECT_SCOPE_RESOLVER_REQUIRED/);
 await assert.rejects(gateway.requestReindex({revision:'r1',idempotency_key:'id1'}),/PROJECT_(?:SCOPE_RESOLVER|INDEX_WRITER)_REQUIRED/);
});

test('project-only read client supports checked recall but cannot perform an unconfigured write',async()=>{
 let reads=0;
 const gateway=createContextGateway({
  executionPlaneClient:{async retrieve({scope}){reads++;assert.equal(scope,'project/owner/repo');return {status:'miss',evidence:[]}}},
  resolveProjectScope:async()=> 'project/owner/repo'
 });
 const r=await gateway.recall({query:'current decision'});
 assert.equal(r.status,'miss');assert.equal(reads,1);
 await assert.rejects(gateway.requestReindex({revision:'v1',idempotency_key:'idx1'}),/PROJECT_INDEX_WRITER_REQUIRED/);
});

test('no project resolver and no authenticated owner is still rejected',()=>{
 assert.throws(()=>createContextGateway({executionPlaneClient:{retrieve:async()=>({status:'miss'})}}),/PROJECT_SCOPE_RESOLVER_REQUIRED/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createContextGateway}=require('../modules/context-gateway/src');

test('personal-only host accepts a separate owner-scoped retrieval provider without any project execution client',async()=>{
 let calls=0;
 const gateway=createContextGateway({
  personalRetrievalClient:{async retrieve(request){calls++;assert.deepEqual(request,{scope:'personal/current',query:'past preference',filters:{}});return {status:'miss',evidence:[]}}},
  resolvePersonalOwner:async()=>({verified:true,principal_id:'verified-owner'})
 });
 const result=await gateway.recallPersonal({query:'past preference'});
 assert.equal(result.status,'miss');assert.equal(calls,1);
 await assert.rejects(gateway.recall({query:'project data',filters:{}}),/PROJECT_SCOPE_RESOLVER_REQUIRED/);
});

test('project and personal clients stay isolated by lane and cannot cross fallback',async()=>{
 let projectCalls=0,personalCalls=0;
 const gateway=createContextGateway({
  executionPlaneClient:{async retrieve({scope}){projectCalls++;assert.equal(scope,'project/owner/project');return {status:'miss',evidence:[]}},async indexProject(){}},
  personalRetrievalClient:{async retrieve({scope}){personalCalls++;assert.equal(scope,'personal/current');return {status:'miss',evidence:[]}}},
  resolveProjectScope:async()=> 'project/owner/project',
  resolvePersonalOwner:async()=>({verified:true,principal_id:'verified-owner'})
 });
 await gateway.answerWithContext({userIntent:{text:'remember my preference',domain:'personal'},historyReferences:true,answerProducer:async()=>{throw Error('NO_EVIDENCE')}});
 await gateway.answerWithContext({userIntent:{text:'remember project decision',domain:'project'},historyReferences:true,answerProducer:async()=>{throw Error('NO_EVIDENCE')}});
 assert.equal(projectCalls,1);assert.equal(personalCalls,1);
});

test('explicit broken personal provider cannot silently fall back to project client',()=>{
 assert.throws(()=>createContextGateway({
  executionPlaneClient:{async retrieve(){return {status:'miss',evidence:[]}}},
  personalRetrievalClient:{},resolveProjectScope:async()=> 'project/owner/repo',
  resolvePersonalOwner:async()=>({verified:true,principal_id:'verified-owner'})
 }),/PERSONAL_RETRIEVAL_CLIENT_REQUIRED/);
});

test('unverified owner blocks the personal retrieval provider before dispatch',async()=>{
 let calls=0;
 const gateway=createContextGateway({
  personalRetrievalClient:{async retrieve(){calls++;return {status:'ok',evidence:[]}}},
  resolvePersonalOwner:async()=>({verified:false,principal_id:'unverified'})
 });
 await assert.rejects(gateway.recallPersonal({query:'hello'}),/OWNER_NOT_VERIFIED/);
 assert.equal(calls,0);
});

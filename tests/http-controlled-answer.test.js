'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createExecutionPlaneClient}=require('../clients/execution-plane/v1/client');
const {createContextGateway}=require('../modules/context-gateway/src');
const scope='project/demo/alpha',content='Restore the previous verified generation.';
const response=()=>({status:'ok',scope,revision:'v1',generation_id:'g1',evidence:[{
 evidence_id:'e1',source:'git',source_ref:'demo/alpha@v1',scope,content,
 content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),retrieval_method:'hybrid',
 provenance:{path:'docs/recovery.md',revision:'v1',observed_at:'2026-10-17T00:00:00Z'}
}]});
test('HTTP retrieval metadata reaches controlled answers without a local-only contract',async()=>{
 const client=createExecutionPlaneClient({baseUrl:'https://execution.internal',capabilityProvider:async()=> 'test-only-capability',
  fetchImpl:async()=>({ok:true,status:200,json:async()=>response()})});
 const gateway=createContextGateway({executionPlaneClient:client,resolveProjectScope:async()=>scope});
 const result=await gateway.answerWithContext({userIntent:{text:'What did this project decide?',domain:'project'},historyReferences:true,
  answerProducer:async({evidence})=>evidence[0].content});
 assert.equal(result.receipt.status,'ok');assert.equal(result.answer,content);
});
test('HTTP enhanced retrieval rejects forged content digests',async()=>{
 const bad=response();bad.evidence[0].content_sha256='sha256:'+'0'.repeat(64);
 const client=createExecutionPlaneClient({baseUrl:'https://execution.internal',fetchImpl:async()=>({ok:true,status:200,json:async()=>bad})});
 await assert.rejects(client.retrieve({scope,query:'recovery',filters:{}}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

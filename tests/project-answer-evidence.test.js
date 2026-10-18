'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createContextGateway}=require('../modules/context-gateway/src');

test('project answers reject foreign-scope and forged-checksum evidence before generation',async()=>{
 for(const mutation of [{scope:'project/other/repo'},{content_sha256:'sha256:'+'0'.repeat(64)}]){
  let generated=false;
  const content='Verified project decision';
  const gateway=createContextGateway({resolveProjectScope:async()=> 'project/demo/alpha',
   executionPlaneClient:{async indexProject(){},async retrieve(){return {status:'ok',revision:'v1',generation_id:'g1',evidence:[{
    evidence_id:'e1',scope:'project/demo/alpha',source_ref:'git:doc',source_revision:'v1',generation_id:'g1',
    observed_at:'2026-10-17T00:00:00Z',content,retrieval_method:'bm25',
    content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),...mutation
   }]}}}});
  const result=await gateway.answerWithContext({userIntent:{text:'What did this project decide earlier?',domain:'project'},historyReferences:true,
   answerProducer:async()=>{generated=true;return 'should not generate'}});
  assert.equal(generated,false);assert.equal(result.receipt.status,'unavailable');
 }
});

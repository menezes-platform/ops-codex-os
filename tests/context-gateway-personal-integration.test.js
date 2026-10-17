'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createContextGateway}=require('../modules/context-gateway/src');
test('personal recall remains a Context Gateway method with trusted owner',async()=>{
 const requests=[];
 const gateway=createContextGateway({
  executionPlaneClient:{async retrieve(args){requests.push(args);return {status:'miss',evidence:[]}},async indexProject(){}},
  resolveProjectScope:async()=> 'project/example/repo',
  resolvePersonalOwner:async()=>({verified:true,principal_id:'owner-123'})
 });
 const response=await gateway.recallPersonal({query:'what happened'});
 assert.equal(response.status,'miss');
 assert.equal(requests[0].scope,'personal/current');
 await assert.rejects(gateway.recallPersonal({query:'what happened',scope:'project/evil/repo'}),/REQUEST_FIELD_INVALID/);
});
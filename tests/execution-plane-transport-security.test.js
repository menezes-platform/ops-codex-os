'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createExecutionPlaneClient}=require('../clients/execution-plane/v1/client');

test('credentialed Execution Plane transport rejects insecure remote and ambiguous base URLs',()=>{
 for(const baseUrl of ['http://remote.example','https://user:password@example.com','https://example.com?token=value','https://example.com#fragment'])
  assert.throws(()=>createExecutionPlaneClient({baseUrl}),/EXECUTION_PLANE_BASE_URL/);
 for(const baseUrl of ['http://127.0.0.1:9911','http://[::1]:9911','https://execution.internal'])
  assert.doesNotThrow(()=>createExecutionPlaneClient({baseUrl}));
});

test('Execution Plane credentials cannot follow a redirect',async()=>{
 let options;
 const client=createExecutionPlaneClient({baseUrl:'https://execution.internal',capabilityProvider:async()=> 'test-capability',
  fetchImpl:async(_url,request)=>{options=request;return {ok:true,status:200,redirected:true,json:async()=>({})}}});
 await assert.rejects(client.getRunState('run-1'),/EXECUTION_PLANE_REDIRECT_DENIED/);
 assert.equal(options.redirect,'error');
});

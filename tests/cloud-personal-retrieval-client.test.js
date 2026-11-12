'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createCloudPersonalRetrievalClient } = require('../clients/execution-plane/v1/cloud-personal-retrieval-client');
const NOW = '2026-11-11T23:00:00.000Z';
const SCOPE = 'personal/current';
const content = 'Retained private preference';
const evidence = () => ({
  evidence_id:'hit-1',scope:SCOPE,owner_principal_id:'owner-7',source_ref:'drive:episode-1',
  source_revision:'r7',generation_id:'cloud-g7',observed_at:'2026-11-11T22:45:00Z',
  content,content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),retrieval_method:'hybrid'
});
const response = () => ({status:'ok',scope:SCOPE,revision:'r7',generation_id:'cloud-g7',last_sync_at:'2026-11-11T22:59:00Z',evidence:[evidence()]});
const client = (fetchImpl, extra={}) => createCloudPersonalRetrievalClient({
  baseUrl:'https://rag.example.test',getCapability:async()=> 'test-only-capability',fetchImpl,
  now:()=>Date.parse(NOW),...extra
});
const reply = value => ({ok:true,status:200,redirected:false,json:async()=>value});

test('cloud HTTPS transport sends bearer in header only and preserves grounded metadata',async()=>{
  let captured;
  const provider = client(async(url,opts)=>{captured={url,opts};return reply(response());});
  const result = await provider.retrieve({scope:SCOPE,query:'Minha preferência?',filters:{source_types:['drive-episodic']}});
  assert.equal(captured.url,'https://rag.example.test/v1/indexing/personal/retrieve');
  assert.equal(captured.opts.method,'POST');
  assert.equal(captured.opts.redirect,'error');
  assert.equal(captured.opts.headers.authorization,'Bearer test-only-capability');
  assert.equal(JSON.parse(captured.opts.body).scope,SCOPE);
  assert.doesNotMatch(captured.opts.body,/test-only-capability/);
  assert.equal(result.evidence[0].content_sha256,evidence().content_sha256);
  assert.equal(result.generation_id,'cloud-g7');
});

test('localhost, non-HTTPS, credentials and query-bearing endpoints are rejected',()=>{
  for(const baseUrl of ['http://localhost:9000','https://localhost:9000','https://127.0.0.1',
    'https://name:secret@rag.example.test','https://rag.example.test/?token=foo',
    'https://rag.example.test/other','https://rag.example.test/#frag']){
    assert.throws(()=>client(async()=>reply(response()),{baseUrl}),/CLOUD_RAG_URL_UNSAFE/,baseUrl);
  }
});

test('only trusted personal scope accepted and model cannot add fields',async()=>{
  let calls=0;
  const provider=client(async()=>{calls++;return reply(response())});
  for(const request of [{scope:'project/owner/repo',query:'hello'},
    {scope:SCOPE,query:'hello',owner_principal_id:'another'},
    {scope:SCOPE,query:'hello',filters:{owner:'another'}},
    {scope:SCOPE,query:'  '}]){
    await assert.rejects(provider.retrieve(request),/CLOUD_RAG_REQUEST_DENIED/);
  }
  assert.equal(calls,0);
});

test('stale or absent source sync receipt is not considered a current successful retrieval',async()=>{
  for(const last_sync_at of ['2026-11-09T23:00:00Z',undefined,'2050-01-01T00:00:00Z']){
    const body=response();body.last_sync_at=last_sync_at;
    const result=await client(async()=>reply(body)).retrieve({scope:SCOPE,query:'hello'});
    assert.deepEqual(result,{status:'stale',evidence:[]});
  }
});

test('missing or aged current generation cannot turn a miss into verified absence',async()=>{
  const body={status:'miss',scope:SCOPE,last_sync_at:'2026-11-05T00:00:00Z',evidence:[]};
  assert.deepEqual(await client(async()=>reply(body)).retrieve({scope:SCOPE,query:'hello'}),{status:'stale',evidence:[]});
});

test('foreign owner, forged digest, and mismatched revisions are all rejected',async()=>{
  for(const mutate of [
    b=>b.evidence[0].scope='project/x/y',
    b=>b.evidence[0].content_sha256='sha256:'+'0'.repeat(64),
    b=>b.evidence[0].generation_id='another',
    b=>b.evidence[0].owner_principal_id='',
    b=>b.evidence[0].source_revision='',
    b=>b.evidence[0].source_revision='r6',
  ]){
    const body=response();mutate(body);
    await assert.rejects(client(async()=>reply(body)).retrieve({scope:SCOPE,query:'hello'}),/CLOUD_RAG_RESPONSE_INVALID/);
  }
});

test('auth errors, unavailability and redirects cannot expose synthetic context',async()=>{
  const c401=client(async()=>({ok:false,status:401,redirected:false}));
  assert.deepEqual(await c401.retrieve({scope:SCOPE,query:'hello'}),{status:'denied',evidence:[]});
  const c503=client(async()=>({ok:false,status:503,redirected:false}));
  assert.deepEqual(await c503.retrieve({scope:SCOPE,query:'hello'}),{status:'unavailable',evidence:[]});
  const cRedirect=client(async()=>({ok:true,status:200,redirected:true,json:async()=>response()}));
  await assert.rejects(cRedirect.retrieve({scope:SCOPE,query:'hello'}),/CLOUD_RAG_REDIRECT_DENIED/);
});

test('no independent capability or malformed bearer blocks outbound call',async()=>{
  let calls=0;
  const c=client(async()=>{calls++;return reply(response())},{getCapability:async()=> 'bad\r\nBearer evil'});
  await assert.rejects(c.retrieve({scope:SCOPE,query:'hello'}),/CLOUD_RAG_CAPABILITY_REQUIRED/);
  assert.equal(calls,0);
});

test('an empty miss without a pinned index generation is unavailable, not a verified absence',async()=>{
 const b={status:'miss',scope:SCOPE,last_sync_at:'2026-11-11T22:59:00Z',evidence:[]};
 assert.deepEqual(await client(async()=>reply(b)).retrieve({scope:SCOPE,query:'hello'}),{status:'unavailable',evidence:[]});
});

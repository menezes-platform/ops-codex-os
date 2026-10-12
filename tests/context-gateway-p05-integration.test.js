'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createContextGateway } = require('../modules/context-gateway/src');
const { createExecutionPlaneClient } = require('../clients/execution-plane/v1/client');
const alpha = 'project/acme/alpha';
const beta = 'project/acme/beta';
const validEvidence = (scope=alpha, revision='r2') => ({
  evidence_id: `ev-${revision}`, source: 'git', source_ref: scope.slice(8)+'@'+revision,
  content: 'Pinned project evidence', provenance: { path: 'docs/readme.md', revision },
});
const validReceipt = {receipt_id: 'receipt-1', scope: alpha, revision: 'r2', generation: 2, status: 'queued'};
function harness(payload, options={}) {
  const calls=[];
  const client=createExecutionPlaneClient({
    baseUrl:'https://execution.internal',
    capabilityProvider: options.capabilityProvider || (()=>'ep-secret'),
    fetchImpl: async (url,req)=>{
      calls.push({url,req});
      if(options.fail) throw new Error('NETWORK_UNAVAILABLE');
      return {ok:true,status:options.status || 200,json:async()=>payload};
    }
  });
  const gateway=createContextGateway({
    executionPlaneClient:client,
    resolveProjectScope: options.resolveProjectScope || (async()=>alpha),
    allowlistedMultiProjectScopes: [alpha,beta],
  });
  return {calls,gateway};
}

test('recall derives project from trusted resolver and excludes injected scope', async()=>{
  const h=harness({evidence:[validEvidence()]});
  await assert.rejects(h.gateway.recall({scope:beta,query:'x'}),/REQUEST_FIELD_INVALID/);
  assert.equal(h.calls.length,0);
  const result=await h.gateway.recall({query:'document',filters:{revision:'r2'}});
  assert.equal(result.evidence[0].source_ref,'acme/alpha@r2');
  assert.equal(JSON.parse(h.calls[0].req.body).scope,alpha);
  assert.equal(h.calls[0].url,'https://execution.internal/v1/indexing/retrieve');
});

test('rejects foreign Git source references without model-provided scope metadata',async()=>{
  const h=harness({evidence:[{...validEvidence(),source_ref:'acme/beta@r2'}]});
  await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('rejects malformed Git source refs instead of skipping project verification',async()=>{
  for(const source_ref of ['beta-repo','acme/beta','git:acme/beta:current','acme/alpha@']){
    const h=harness({evidence:[{...validEvidence(),source_ref}]});
    await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/,source_ref);
  }
});

test('rejects source ref revision which conflicts with provenance even without revision filter',async()=>{
  const h=harness({evidence:[{...validEvidence(),source_ref:'acme/alpha@r1'}]});
  await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('revision query fails closed when producer returns out-of-revision source',async()=>{
  const h=harness({evidence:[validEvidence(alpha,'r1')]});
  await assert.rejects(h.gateway.recall({query:'x',filters:{revision:'r2'}}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('indexProject rejects mismatched receipt and forbids model-selected project',async()=>{
  const h=harness({...validReceipt,scope:beta});
  await assert.rejects(h.gateway.requestReindex({revision:'r2',idempotency_key:'req-2'}),/EXECUTION_PLANE_RECEIPT_INVALID/);
  await assert.rejects(h.gateway.requestReindex({scope:beta,revision:'r2',idempotency_key:'req-2'}),/REQUEST_FIELD_INVALID/);
  assert.equal(h.calls.length,1);
});

test('explicit multi-project recall only uses preconfigured allowlist and never global wildcard',async()=>{
  const h=harness({evidence:[validEvidence(alpha),validEvidence(beta)]});
  const found=await h.gateway.recallAcrossProjects({query:'x',allowlisted_scopes:[alpha,beta]});
  assert.equal(found.evidence.length,2);
  assert.deepEqual(JSON.parse(h.calls[0].req.body).allowlisted_scopes,[alpha,beta]);
  await assert.rejects(h.gateway.recallAcrossProjects({query:'x',allowlisted_scopes:[alpha,'project/unknown/repo']}),/PROJECT_SCOPE_NOT_ALLOWLISTED/);
  await assert.rejects(h.gateway.recallAcrossProjects({query:'x',allowlisted_scopes:['global']}),/INVALID_PROJECT_SCOPE/);
  assert.equal(h.calls.length,1);
});

test('network unavailable fails closed without returning synthetic evidence or retrying',async()=>{
  const h=harness({evidence:[validEvidence()]},{fail:true});
  await assert.rejects(h.gateway.recall({query:'x'}),/NETWORK_UNAVAILABLE/);
  assert.equal(h.calls.length,1);
});

test('transport sends token only in Authorization header, never request body',async()=>{
  const h=harness({evidence:[validEvidence()]});
  const r=await h.gateway.recall({query:'x'});
  assert.equal(r.evidence[0].content,'Pinned project evidence');
  assert.equal(h.calls[0].req.headers.authorization,'Bearer ep-secret');
  assert.ok(!h.calls[0].req.body.includes('ep-secret'));
  assert.ok(!JSON.stringify(r).includes('ep-secret'));
});

test('invalid project resolver does not trigger transport',async()=>{
  const h=harness({evidence:[]},{resolveProjectScope:async()=>''});
  await assert.rejects(h.gateway.recall({query:'x'}),/INVALID_PROJECT_SCOPE/);
  assert.equal(h.calls.length,0);
});

test('requested source type is enforced after transport returns extra evidence', async()=>{
  const unwanted = {...validEvidence(), source:'memory', source_ref:'memo-1'};
  const h=harness({evidence:[unwanted]});
  await assert.rejects(h.gateway.recall({query:'x',filters:{source_types:['git']}}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('direct client rejects malformed filters before making any external request',async()=>{
  let count=0;
  const client=createExecutionPlaneClient({baseUrl:'https://execution.internal',fetchImpl:async()=>{count++;throw new Error('FETCH_SHOULD_NOT_RUN');}});
  for(const filters of [{source_types:'git'},{source_types:['git','git']},{revision:''},{after:'not-a-date'},{before:'2026-10-12'}]) {
    await assert.rejects(client.retrieve({scope:alpha,query:'x',filters}),/FILTERS_INVALID/);
  }
  assert.equal(count,0);
});

test('bounded transport sends an AbortSignal and aborts a stalled retrieval',async()=>{
  let signal;
  const client=createExecutionPlaneClient({baseUrl:'https://execution.internal',timeoutMs:12,fetchImpl:async(_url,options)=>{
    signal=options.signal;
    return new Promise((_resolve,reject)=>{
      if(signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
  }});
  // AbortSignal.timeout() deliberately uses an unref timer; a synthetic fetch
  // needs an active event-loop handle that a real socket would supply.
  const keepAlive=setTimeout(()=>{},100);
  try {
    await assert.rejects(client.retrieve({scope:alpha,query:'x',filters:{}}),/timeout|aborted|Abort/i);
    assert.equal(signal.aborted,true);
  } finally { clearTimeout(keepAlive); }
});

test('timeout configuration fails closed on invalid values',()=>{
  for(const timeoutMs of [0,-1,30001,'five seconds',Number.NaN]) {
    assert.throws(()=>createExecutionPlaneClient({baseUrl:'https://execution.internal',timeoutMs,fetchImpl:async()=>{}}),/EXECUTION_PLANE_TIMEOUT_INVALID/);
  }
});

test('retrieval rejects unsafe source paths without forwarding citations',async()=>{
  for(const path of ['../private/key.txt','/etc/passwd','docs//private','docs/../../secrets','docs\\secret.md']) {
    const h=harness({evidence:[{...validEvidence(),provenance:{path,revision:'r2'}}]});
    await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/,path);
  }
});

test('retrieval rejects more than 100 hits before building unbounded context',async()=>{
  const many=Array.from({length:101},(_,i)=>({...validEvidence(),evidence_id:'e'+i}));
  const h=harness({evidence:many});
  await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('oversized evidence text is not returned to the gateway',async()=>{
  const h=harness({evidence:[{...validEvidence(),content:'x'.repeat(131073)}]});
  await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('duplicate evidence identity is rejected before it can bias recall',async()=>{
  const h=harness({evidence:[validEvidence(),validEvidence()]});
  await assert.rejects(h.gateway.recall({query:'x'}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('oversized query fails locally and never reaches transport',async()=>{
  const h=harness({evidence:[]});
  await assert.rejects(h.gateway.recall({query:'x'.repeat(16385)}),/QUERY_INVALID/);
  assert.equal(h.calls.length,0);
});

test('multi-project non-Git hits without a project identity must fail closed',async()=>{
  const memory={evidence_id:'mem-1',source:'memory',source_ref:'memory:record-1',content:'private note',provenance:{revision:'rev1'}};
  const h=harness({evidence:[memory]});
  await assert.rejects(h.gateway.recallAcrossProjects({query:'x',allowlisted_scopes:[alpha,beta]}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('multi-project memory hits with explicit allowed project identity are sanitized',async()=>{
  const memory={evidence_id:'mem-1',scope:beta,source:'memory',source_ref:'memory:record-1',content:'note',provenance:{revision:'rev1'}};
  const h=harness({evidence:[memory]});
  const r=await h.gateway.recallAcrossProjects({query:'x',allowlisted_scopes:[alpha,beta]});
  assert.equal(r.evidence[0].content,'note');
  assert.equal(Object.hasOwn(r.evidence[0],'scope'),false);
});

test('multi-project Git hit cannot claim a different allowed project in scope metadata',async()=>{
  const forged={...validEvidence(alpha),scope:beta};
  const h=harness({evidence:[forged]});
  await assert.rejects(h.gateway.recallAcrossProjects({query:'x',allowlisted_scopes:[alpha,beta]}),/EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('single-project memory hit can omit scope when trusted resolver supplies one',async()=>{
  const memory={evidence_id:'mem-1',source:'memory',source_ref:'memory:record-1',content:'note',provenance:{revision:'rev1'}};
  const h=harness({evidence:[memory]});
  const r=await h.gateway.recall({query:'x'});
  assert.equal(r.evidence[0].content,'note');
});

test('impossible calendar dates are rejected locally before retrieval transport',async()=>{
  const h=harness({evidence:[]});
  for(const impossible of ['2026-02-30T12:00:00Z','2026-04-31T12:00:00Z','2025-02-29T00:00:00Z','2026-13-01T00:00:00Z']){
    await assert.rejects(h.gateway.recall({query:'x',filters:{after:impossible}}),/FILTERS_INVALID/,impossible);
  }
  assert.equal(h.calls.length,0);
});

test('inverted retrieval time range must fail before transport',async()=>{
  const h=harness({evidence:[]});
  await assert.rejects(h.gateway.recall({query:'x',filters:{after:'2026-10-13T00:00:00Z',before:'2026-10-12T00:00:00Z'}}),/FILTERS_INVALID/);
  assert.equal(h.calls.length,0);
});

test('leap day with matching offset remains valid',async()=>{
  const h=harness({evidence:[]});
  assert.deepEqual(await h.gateway.recall({query:'x',filters:{after:'2024-02-29T10:00:00+03:00',before:'2024-02-29T12:00:00+03:00'}}),{evidence:[]});
  assert.equal(h.calls.length,1);
});

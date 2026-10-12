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

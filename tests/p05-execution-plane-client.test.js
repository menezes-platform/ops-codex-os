const assert = require('node:assert/strict');
const test = require('node:test');
const { createExecutionPlaneClient } = require('../clients/execution-plane/v1/client');
const scope = 'project/acme/app';
const evidence = {
  evidence_id: 'ev-1', source: 'git', source_ref: 'acme/app@abc123',
  content: 'current document', provenance: { path: 'README.md', revision: 'abc123' },
};
function clientFor(payload) {
  return createExecutionPlaneClient({
    baseUrl: 'https://execution-plane.internal',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
  });
}

test('valid source evidence is delivered without vendor-specific types', async () => {
  const result = await clientFor({ evidence: [evidence] }).retrieve({ scope, query: 'docs', filters: {} });
  assert.deepEqual(result, { evidence: [evidence] });
});

test('untrusted project scope and empty query are rejected before transport', async () => {
  let called = false;
  const client = createExecutionPlaneClient({
    baseUrl: 'https://execution-plane.internal',
    fetchImpl: async () => { called = true; throw new Error('UNEXPECTED_CALL'); },
  });
  await assert.rejects(client.retrieve({ scope: 'global', query: 'a', filters: {} }), /INVALID_PROJECT_SCOPE/);
  await assert.rejects(client.retrieve({ scope, query: ' ', filters: {} }), /QUERY_REQUIRED/);
  assert.equal(called, false);
});

test('rejects a foreign project envelope and foreign evidence', async () => {
  await assert.rejects(clientFor({ scope: 'project/other/repo', evidence: [evidence] })
    .retrieve({ scope, query: 'docs', filters: {} }), /EXECUTION_PLANE_RETRIEVAL_INVALID/);
  await assert.rejects(clientFor({ evidence: [{ ...evidence, scope: 'project/other/repo' }] })
    .retrieve({ scope, query: 'docs', filters: {} }), /EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('malformed evidence and stale explicit revision cannot reach the agent', async () => {
  await assert.rejects(clientFor({ evidence: [{ evidence_id: 'ev-1' }] })
    .retrieve({ scope, query: 'docs', filters: {} }), /EXECUTION_PLANE_RETRIEVAL_INVALID/);
  await assert.rejects(clientFor({ evidence: [evidence] })
    .retrieve({ scope, query: 'docs', filters: { revision: 'newer' } }), /EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('index receipt must match requested scope and revision', async () => {
  const input = { scope, revision: 'abc123', idempotency_key: 'reindex-1' };
  const validReceipt = { receipt_id: 'receipt-1', scope, revision: 'abc123', generation: 2, status: 'queued' };
  assert.deepEqual(await clientFor(validReceipt).indexProject(input), validReceipt);
  await assert.rejects(clientFor({ ...validReceipt, scope: 'project/other/repo' }).indexProject(input), /EXECUTION_PLANE_RECEIPT_INVALID/);
  await assert.rejects(clientFor({ ...validReceipt, status: 'approved' }).indexProject(input), /EXECUTION_PLANE_RECEIPT_INVALID/);
});

test('foreign Git source ref cannot masquerade as current project when scope metadata is absent', async () => {
  await assert.rejects(clientFor({ evidence: [{ ...evidence, source_ref: 'other/repo@abc123' }] })
    .retrieve({ scope, query: 'docs', filters: {} }), /EXECUTION_PLANE_RETRIEVAL_INVALID/);
});

test('unknown retrieval filter fields cannot widen scope', async () => {
  let requested = false;
  const client = createExecutionPlaneClient({
    baseUrl: 'https://execution-plane.internal',
    fetchImpl: async () => { requested = true; return { ok: true, status: 200, json: async () => ({ evidence: [] }) }; },
  });
  await assert.rejects(client.retrieve({ scope, query: 'docs', filters: { project: 'project/other/repo' } }), /FILTERS_INVALID/);
  assert.equal(requested, false);
});

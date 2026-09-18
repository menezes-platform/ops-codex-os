const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SandboxProvider } = require('../persistd/src/persistflow/sandbox-provider');
const { PersistFlowService } = require('../persistd/src/persistflow/service');
const { MemoryAuthorityStore } = require('../persistd/src/persistflow/authority-store');

test('SandboxProvider signs broker requests and maps semantic operations', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === '/api/v1/workspaces') {
      return new Response(JSON.stringify({ workspace: { id: 'ws_1', run_id: 'run-1', status: 'ready' } }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/v1/jobs') {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ job: { id: 'job_1', ...body, status: 'queued' } }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    if (path === '/api/v1/jobs/job_1/receipt') {
      return new Response(JSON.stringify({ receipt: { id: 'receipt_1', operation_id: 'op-1', workspace_id: 'ws_1', execution_id: 'exec_1', status: 'verified', result_digest: 'sha256:' + 'a'.repeat(64), verification: { passed: true }, evidence: { ok: true } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected path ' + path);
  };
  const provider = new SandboxProvider({
    baseUrl: 'https://sandbox.example.test',
    keyId: 'persistflow-v1',
    secret: 'secret-key',
    fetchImpl,
    clock: () => 1700000000000,
    nonceFactory: () => 'nonce-00000001',
  });

  const workspace = await provider.create({ runId: 'run-1', repo: 'owner/repo', ref: 'abc123', providerHint: 'railway', policyTier: 'standard' });
  assert.equal(workspace.id, 'ws_1');

  const job = await provider.exec({
    workspaceId: 'ws_1',
    operationId: 'op-1',
    operation: 'browser.run',
    payload: { actions: [{ type: 'goto', url: 'https://example.com' }] },
  });
  assert.equal(job.kind, 'browser.run');

  const receipt = await provider.receipt('job_1');
  assert.equal(receipt.status, 'verified');

  assert.equal(calls.length, 3);
  const first = calls[0];
  const body = first.init.body;
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = ['POST', '/api/v1/workspaces', '1700000000', 'nonce-00000001', bodyHash].join('\n');
  const expected = crypto.createHmac('sha256', 'secret-key').update(canonical).digest('hex');
  assert.equal(first.init.headers['x-persistflow-key-id'], 'persistflow-v1');
  assert.equal(first.init.headers['x-persistflow-timestamp'], '1700000000');
  assert.equal(first.init.headers['x-persistflow-nonce'], 'nonce-00000001');
  assert.equal(first.init.headers['x-persistflow-signature'], expected);
});

test('PersistFlow checkpoints sandbox workspace, job and canonical receipt as evidence', async () => {
  const store = new MemoryAuthorityStore();
  const sandbox = {
    async create(input) {
      assert.equal(input.runId, 'run-link');
      return { id: 'ws_link', status: 'ready', run_id: input.runId };
    },
    async exec(input) {
      return { id: 'job_link', workspace_id: input.workspaceId, operation_id: input.operationId, kind: 'browser.run', status: 'queued' };
    },
    async receipt(jobId) {
      assert.equal(jobId, 'job_link');
      return {
        id: 'receipt_link',
        operation_id: 'op-link',
        workspace_id: 'ws_link',
        execution_id: 'exec_link',
        status: 'verified',
        result_digest: 'sha256:' + 'b'.repeat(64),
        verification: { passed: true },
        evidence: { title: 'PersistFlow Sandbox connected' },
      };
    },
    async inspect(workspaceId) { return { id: workspaceId, status: 'ready' }; },
    async destroy(workspaceId) { return { id: workspaceId, status: 'destroyed' }; },
  };
  const service = new PersistFlowService({ store, sandbox, clock: () => new Date('2026-09-17T21:30:00.000Z') });
  service.startRun({ runId: 'run-link', goal: 'connect control and execution planes' });

  const created = await service.sandboxCreate('run-link', {
    generation: 1,
    repo: 'owner/repo',
    ref: 'abc123',
    providerHint: 'railway',
    policyTier: 'standard',
  });
  assert.equal(created.workspace.id, 'ws_link');

  const queued = await service.sandboxExec('run-link', {
    generation: 1,
    workspaceId: 'ws_link',
    operationId: 'op-link',
    operation: 'browser.run',
    payload: { actions: [{ type: 'goto', url: 'https://example.com' }] },
  });
  assert.equal(queued.job.id, 'job_link');

  const reconciled = await service.sandboxReceipt('run-link', {
    generation: 1,
    jobId: 'job_link',
    nextSafeAction: 'continue-after-sandbox',
  });
  assert.equal(reconciled.receipt.id, 'receipt_link');

  const run = service.inspectRun('run-link');
  assert.equal(run.checkpoints.length, 3);
  assert.equal(run.latestCheckpoint.evidence.type, 'sandbox.receipt');
  assert.equal(run.latestCheckpoint.evidence.receipt.result_digest, 'sha256:' + 'b'.repeat(64));
  assert.equal(run.nextSafeAction, 'continue-after-sandbox');
});

test('PersistFlow sandbox mutations remain generation-fenced', async () => {
  const store = new MemoryAuthorityStore();
  const sandbox = { async create() { throw new Error('should not run'); } };
  const service = new PersistFlowService({ store, sandbox });
  service.startRun({ runId: 'run-fence' });
  await assert.rejects(
    service.sandboxCreate('run-fence', { generation: 2, repo: 'x', ref: 'y', policyTier: 'standard' }),
    /STALE_GENERATION/,
  );
});

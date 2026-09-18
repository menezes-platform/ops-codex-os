const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../persistd/src/persistflow/http-server');
const { MemoryAuthorityStore } = require('../persistd/src/persistflow/authority-store');

async function withServer(sandboxProvider, fn) {
  const server = createServer({
    store: new MemoryAuthorityStore(),
    mcpToken: 'sandbox-mcp-test',
    sandboxProvider,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('MCP drives Sandbox through PersistFlow and reconciles receipt into canonical checkpoint', async () => {
  const calls = [];
  const sandboxProvider = {
    async create(input) {
      calls.push(['create', input]);
      return { id: 'ws_mcp', run_id: input.runId, status: 'ready' };
    },
    async inspect(id) {
      calls.push(['inspect', id]);
      return { id, status: 'ready' };
    },
    async exec(input) {
      calls.push(['exec', input]);
      return {
        id: 'job_mcp',
        workspace_id: input.workspaceId,
        operation_id: input.operationId,
        kind: 'browser.run',
        status: 'queued',
      };
    },
    async inspectJob(id) {
      calls.push(['job', id]);
      return { id, status: 'succeeded' };
    },
    async receipt(id) {
      calls.push(['receipt', id]);
      return {
        id: 'receipt_mcp',
        operation_id: 'op-mcp',
        workspace_id: 'ws_mcp',
        execution_id: 'exec_mcp',
        status: 'verified',
        result_digest: 'sha256:' + 'c'.repeat(64),
        verification: { passed: true },
        evidence: { dom_assertion: true },
      };
    },
    async destroy(id) {
      calls.push(['destroy', id]);
      return { id, status: 'destroyed' };
    },
  };

  await withServer(sandboxProvider, async (base) => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'sandbox-integration-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer sandbox-mcp-test' } },
    });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      const names = new Set(listed.tools.map((tool) => tool.name));
      for (const name of [
        'persist_sandbox_create',
        'persist_sandbox_inspect',
        'persist_sandbox_exec',
        'persist_sandbox_job',
        'persist_sandbox_receipt',
        'persist_sandbox_destroy',
      ]) assert.ok(names.has(name), `missing ${name}`);

      await client.callTool({
        name: 'persist_run_start',
        arguments: { runId: 'run-mcp-sandbox', goal: 'connect PersistFlow and Sandbox' },
      });

      const created = await client.callTool({
        name: 'persist_sandbox_create',
        arguments: {
          runId: 'run-mcp-sandbox',
          generation: 1,
          repo: 'owner/repo',
          ref: 'decb89a031fdbe4cca464c50676fed8ea1073e61',
          providerHint: 'railway',
          policyTier: 'standard',
        },
      });
      assert.match(created.content[0].text, /ws_mcp/);

      const queued = await client.callTool({
        name: 'persist_sandbox_exec',
        arguments: {
          runId: 'run-mcp-sandbox',
          generation: 1,
          workspaceId: 'ws_mcp',
          operationId: 'op-mcp',
          operation: 'browser.run',
          payload: { actions: [{ type: 'goto', url: 'https://example.com' }] },
        },
      });
      assert.match(queued.content[0].text, /job_mcp/);

      const reconciled = await client.callTool({
        name: 'persist_sandbox_receipt',
        arguments: {
          runId: 'run-mcp-sandbox',
          generation: 1,
          jobId: 'job_mcp',
          nextSafeAction: 'continue',
        },
      });
      assert.match(reconciled.content[0].text, /receipt_mcp/);

      const inspected = await client.callTool({
        name: 'persist_run_inspect',
        arguments: { runId: 'run-mcp-sandbox' },
      });
      const state = JSON.parse(inspected.content[0].text).run;
      assert.equal(state.latestCheckpoint.evidence.type, 'sandbox.receipt');
      assert.equal(state.latestCheckpoint.evidence.receipt.id, 'receipt_mcp');
      assert.equal(state.nextSafeAction, 'continue');
    } finally {
      await client.close();
    }
  });

  assert.deepEqual(calls.map(([name]) => name), ['create', 'exec', 'receipt']);
});

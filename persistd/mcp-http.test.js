const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');

async function withServer(fn) {
  const server = createServer({
    store: new MemoryAuthorityStore(),
    mcpToken: 'test-secret',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('MCP endpoint rejects missing bearer token', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(response.status, 401);
  });
});

test('MCP client can drive the minimal run lifecycle', async () => {
  await withServer(async (base) => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'persistflow-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer test-secret' } },
    });

    await client.connect(transport);
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      for (const name of [
        'persist_run_start',
        'persist_run_inspect',
        'persist_run_heartbeat',
        'persist_run_checkpoint',
        'persist_run_claim',
      ]) assert.ok(names.includes(name), `missing tool ${name}`);

      const started = await client.callTool({
        name: 'persist_run_start',
        arguments: { runId: 'mcp-test-run', goal: 'prove MCP transport' },
      });
      assert.equal(started.isError, undefined);
      assert.match(started.content[0].text, /mcp-test-run/);

      const inspected = await client.callTool({
        name: 'persist_run_inspect',
        arguments: { runId: 'mcp-test-run' },
      });
      assert.match(inspected.content[0].text, /mcp-test-run/);

      const heartbeat = await client.callTool({
        name: 'persist_run_heartbeat',
        arguments: { runId: 'mcp-test-run', generation: 1, progress: 'alive' },
      });
      assert.match(heartbeat.content[0].text, /alive/);

      const checkpoint = await client.callTool({
        name: 'persist_run_checkpoint',
        arguments: { runId: 'mcp-test-run', generation: 1, nextSafeAction: 'continue' },
      });
      assert.match(checkpoint.content[0].text, /continue/);
    } finally {
      await client.close();
    }
  });
});

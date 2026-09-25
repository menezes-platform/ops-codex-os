const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');
const { MemoryFleetStore } = require('./src/fleet/store');
const { loadFleetConfig } = require('./src/fleet/contracts');

async function withServer(fn) {
  const fleetStore = new MemoryFleetStore();
  fleetStore.putHeartbeat('desktop-primary', {
    observedAt: '2026-09-24T17:00:00.000Z', hostname: 'DESKTOP',
    freeDiskBytes: 100, totalDiskBytes: 200, freeMemoryBytes: 10, totalMemoryBytes: 20,
    cpuPercent: 10, activeJobs: 0, cacheBytes: 1234,
    cachedObjectHashes: ['a'.repeat(64), 'b'.repeat(64)],
    runtimeVersion: '1', capabilitiesHash: '',
  });
  const objectStore = {
    resolve: async () => ({
      id: 'drive-file-1',
      name: 'a'.repeat(64),
      size: '42',
      mimeType: 'application/octet-stream',
      modifiedTime: '2026-09-24T17:00:00Z',
      appProperties: {
        gdb_schema: '1', gdb_sha256: 'a'.repeat(64),
        gdb_record: 'object', gdb_kind: 'artifact',
        accessToken: 'SHOULD_NOT_LEAK',
      },
    }),
  };
  const server = createServer({
    store: new MemoryAuthorityStore(),
    fleetStore,
    fleetConfig: loadFleetConfig({ nodes: [{
      id: 'desktop-primary', platform: 'win32', capabilities: ['node'], concurrencyLimit: 1,
    }] }),
    objectStore,
    mcpToken: 'owner',
    clock: () => new Date('2026-09-24T17:00:30.000Z'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('storage MCP exposes bounded object metadata and cache telemetry without secrets or paths', async () => {
  await withServer(async (base) => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'storage-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer owner' } },
    });
    await client.connect(transport);
    try {
      const objectResult = await client.callTool({
        name: 'persist_object_lookup',
        arguments: { ref: 'sha256:' + 'a'.repeat(64) },
      });
      const objectPayload = JSON.parse(objectResult.content[0].text);
      assert.equal(objectPayload.object.fileId, 'drive-file-1');
      assert.equal(objectPayload.object.appProperties.gdb_kind, 'artifact');
      assert.equal(JSON.stringify(objectPayload).includes('SHOULD_NOT_LEAK'), false);
      assert.equal(JSON.stringify(objectPayload).includes('accessToken'), false);

      const cacheResult = await client.callTool({ name: 'persist_cache_status', arguments: {} });
      const cachePayload = JSON.parse(cacheResult.content[0].text);
      assert.deepEqual(cachePayload.cache.nodes, [{
        nodeId: 'desktop-primary', fresh: true, cacheBytes: 1234, cachedObjectCount: 2,
      }]);
      assert.equal(JSON.stringify(cachePayload).includes('\\'), false);
    } finally { await client.close(); }
  });
});

test('persist_object_lookup rejects non-SHA object references at schema boundary', async () => {
  await withServer(async (base) => {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client({ name: 'storage-invalid-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer owner' } },
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: 'persist_object_lookup', arguments: { ref: 'not-a-ref' },
      });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /invalid/i);
    } finally { await client.close(); }
  });
});

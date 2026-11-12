'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A tiny in-process MCP registration harness. It tests the real handler source
// without opening any OAuth session, importing secrets or contacting production.
function captureTools(contextProvider = null) {
  const tools = new Map();
  const schema = new Proxy(function schema() {}, {
    apply() { return schema; },
    get() { return schema; },
  });
  class FakeMcpServer {
    registerTool(name, metadata, handler) { tools.set(name, { metadata, handler }); }
  }
  const fakeRequire = (name) => {
    if (name === 'node:crypto') return require('node:crypto');
    if (name === '@modelcontextprotocol/server') return {
      McpServer: FakeMcpServer,
      createMcpHandler: (factory) => { factory({}); return () => {}; },
    };
    if (name === '@modelcontextprotocol/node') return { toNodeHandler: (handler) => handler };
    if (name === 'zod') return { z: schema };
    throw new Error('UNEXPECTED_MODULE:' + name);
  };
  const file = path.join(__dirname, 'src/persistflow/mcp-handler.js');
  const sandbox = { require: fakeRequire, module: { exports: {} }, Buffer, URL, console };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  sandbox.module.exports.createPersistFlowMcpNodeHandler({
    service: {}, token: 'fixture-auth-only', contextProvider,
  });
  return tools;
}

test('private context tool is always discoverable even during index outage', () => {
  const tools = captureTools();
  assert.equal(tools.has('context_recall'), true);
  assert.equal(tools.size, 17, 'Existing PersistFlow tools remain registered');
});

test('index unavailable fails closed without exposing a namespace or memory', async () => {
  const tools = captureTools();
  const reply = await tools.get('context_recall').handler({
    namespace: 'project/private/candidate',
    query: 'what is in private memory?',
  });
  assert.equal(reply.isError, true);
  assert.deepEqual(JSON.parse(reply.content[0].text), { error: 'retrieval_unavailable' });
});

test('configured index allows only exact namespace and no foreign recall', async () => {
  let calls = 0;
  const tools = captureTools({
    namespace: 'contest/sc/operation5050',
    gateway: { async recall({ query }) { calls++; return { status: 'ok', evidence: [{ source_ref: 'fixture:1', content: query }] }; } },
  });
  const foreign = await tools.get('context_recall').handler({ query: 'foo', namespace: 'contest/foreign' });
  assert.equal(foreign.isError, true);
  assert.deepEqual(JSON.parse(foreign.content[0].text), { error: 'namespace_denied' });
  assert.equal(calls, 0);
  const success = await tools.get('context_recall').handler({ query: 'test', namespace: 'contest/sc/operation5050' });
  assert.equal(success.isError, undefined);
  assert.equal(JSON.parse(success.content[0].text).evidence[0].source_ref, 'fixture:1');
  assert.equal(calls, 1);
});

test('configured index failure never returns an incomplete or fictitious answer', async () => {
  for (const gateway of [
    { async recall() { return { status: 'miss', evidence: [] }; } },
    { async recall() { throw Error('disk failed: private path'); } },
  ]) {
    const tools = captureTools({ namespace: 'contest/sc/operation5050', gateway });
    const response = await tools.get('context_recall').handler({ query: 'test', namespace: 'contest/sc/operation5050' });
    assert.equal(response.isError, true);
    assert.deepEqual(JSON.parse(response.content[0].text), { error: 'retrieval_unavailable' });
  }
});

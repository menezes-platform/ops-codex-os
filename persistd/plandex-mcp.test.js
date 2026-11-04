const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./src/persistflow/http-server');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');

async function withClient(plandexController, fn) {
  const server = createServer({ store: new MemoryAuthorityStore(), mcpToken: 'isolated-test-token', plandexController });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const client = new Client({ name: 'plandex-native-contract', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer isolated-test-token' } },
  });
  try { await client.connect(transport); await fn({ client, base }); }
  finally { await client.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
}

test('MCP lists Plandex lifecycle without erasing PersistFlow', async () => {
  const c={status:async()=>({state:'Shutdown'}),start:async()=>({}),stop:async()=>({})};
  await withClient(c, async ({client}) => {
    const names=(await client.listTools()).tools.map(t=>t.name);
    for(const name of ['persist_run_inspect','plandex_status','plandex_start','plandex_stop']) assert.ok(names.includes(name),name);
    assert.ok(!names.includes('plandex_execute_shell'));
  });
});

test('plandex_status returns a sanitized read-only result', async () => {
  let called=0;
  const c={status:async()=>{called++;return {state:'Shutdown'}},start:async()=>{throw Error('unexpected start')},stop:async()=>({})};
  await withClient(c,async({client})=>{
    const out=await client.callTool({name:'plandex_status',arguments:{}});
    assert.equal(out.isError,undefined);
    assert.equal(JSON.parse(out.content[0].text).codespace.state,'Shutdown');
    assert.equal(called,1);
  });
});

test('plandex_start requires confirmation and preserves pending state',async()=>{
  let count=0;const c={status:async()=>({}),start:async()=>{count++;return {state:'Starting',confirmed:false}},stop:async()=>({})};
  await withClient(c,async({client})=>{
    const bad=await client.callTool({name:'plandex_start',arguments:{confirm:false}});
    assert.equal(bad.isError,true);assert.equal(count,0);
    const good=await client.callTool({name:'plandex_start',arguments:{confirm:true}});
    assert.equal(good.isError,undefined);assert.equal(count,1);
    assert.equal(JSON.parse(good.content[0].text).codespace.confirmed,false);
  });
});

test('plandex_stop never confuses ShuttingDown with Shutdown',async()=>{
  const c={status:async()=>({}),start:async()=>({}),stop:async()=>({state:'ShuttingDown',confirmed:false})};
  await withClient(c,async({client})=>{
    const out=await client.callTool({name:'plandex_stop',arguments:{}});
    const got=JSON.parse(out.content[0].text).codespace;
    assert.equal(got.confirmed,false);assert.equal(got.state,'ShuttingDown');
  });
});

test('MCP rejects unauthenticated tool discovery',async()=>{
  const c={status:async()=>({}),start:async()=>({}),stop:async()=>({})};
  await withClient(c,async({base})=>{
    const out=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
    assert.equal(out.status,401);
  });
});

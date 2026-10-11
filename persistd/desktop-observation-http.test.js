const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('./src/persistflow/http-server');
const {MemoryAuthorityStore}=require('./src/persistflow/authority-store');
const {MemoryFleetStore}=require('./src/fleet/store');
const {ObservationClient}=require('./src/fleet/observation-client');
const {OPERATIONS}=require('./src/fleet/observation');
const {signNodeRequest}=require('./src/fleet/auth');
const STATUS={available:true,sessionId:1,hostname:'DESKTOP-L6CITUI',userSid:'S-1-5-test',coordinateSpace:'physical_pixels',monitors:[{id:'mon-0',bounds:{X:0,Y:0,Width:1920,Height:1080}}]};

async function context(fn) {
  const store=new MemoryAuthorityStore(),fleetStore=new MemoryFleetStore();
  fleetStore.putHeartbeat('desktop-primary',{observedAt:new Date().toISOString(),hostname:'DESKTOP-L6CITUI',freeDiskBytes:60*1024**3,totalDiskBytes:200*1024**3,freeMemoryBytes:2*1024**3,totalMemoryBytes:8*1024**3,cpuPercent:10,activeJobs:0,cacheBytes:0,cachedObjectHashes:[],runtimeVersion:'test',capabilitiesHash:'a'.repeat(64)});
  const secret=crypto.randomBytes(32).toString('hex'),token=crypto.randomBytes(32).toString('hex');
  const server=createServer({store,fleetStore,mcpToken:token,fleetConfig:{nodes:[{id:'desktop-primary',platform:'win32',capabilities:['interactive-ui'],concurrencyLimit:1}]},fleetNodeSecrets:{'desktop-primary':secret},desktopObservationEnabled:true,
    desktopObservationNodes:{'desktop-primary':{hostname:'DESKTOP-L6CITUI',operations:Object.keys(OPERATIONS)}}});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const baseUrl=`http://127.0.0.1:${server.address().port}`,receiptDir=fs.mkdtempSync(path.join(os.tmpdir(),'observation-http-'));
  const {Client,StreamableHTTPClientTransport}=await import('@modelcontextprotocol/client');
  const mcp=new Client({name:'observation-consumer',version:'1'});
  await mcp.connect(new StreamableHTTPClientTransport(new URL(baseUrl+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  await mcp.callTool({name:'persist_run_start',arguments:{runId:'observation-http',goal:'read-only test'}});
  const worker=new ObservationClient({baseUrl,nodeId:'desktop-primary',secret,operations:Object.keys(OPERATIONS),receiptDir,
    hostUrl:process.env.ORQUESTRA_TEST_OBSERVATION_URL||'http://127.0.0.1:48731',tokenReader:()=>process.env.ORQUESTRA_TEST_OBSERVATION_TOKEN||'fixture-local-token'});
  const call=(name,id,args={})=>mcp.callTool({name,arguments:{runId:'observation-http',generation:1,operationId:id,nodeId:'desktop-primary',arguments:args}});
  try{await fn({server,baseUrl,worker,mcp,call,store,secret});}
  finally{await mcp.close();await new Promise(ok=>server.close(ok));fs.rmSync(receiptDir,{recursive:true});}
}
test('MCP tools/list and tools/call traverse signed observation poll/report',async()=>context(async({mcp,call,worker,store})=>{
  const listed=await mcp.listTools();for(const op of Object.keys(OPERATIONS))assert.ok(listed.tools.some(t=>t.name===op));
  worker.local=async()=>STATUS;
  const resultPromise=call('desktop.status','status-1');
  await new Promise(ok=>setTimeout(ok,100));await worker.once();
  const result=await resultPromise;assert.equal(result.isError,undefined);assert.equal(result.structuredContent.observation.available,true);
  assert.equal(JSON.stringify(store.list()).includes('mon-0'),false);
}));
test('unsigned, altered-body and stale signed requests fail authentication',async()=>context(async({baseUrl,secret})=>{
  const route='/v1/fleet/nodes/desktop-primary/observations/poll';
  for(const [body,timestamp,signedBody] of [['{}',new Date().toISOString(),'{"evil":1}'],['{}',new Date(Date.now()-120000).toISOString(),'{}']]){
    const r=await fetch(baseUrl+route,{method:'POST',body,headers:{'content-type':'application/json','x-persistflow-node-id':'desktop-primary','x-persistflow-node-timestamp':timestamp,
      'x-persistflow-node-signature':signNodeRequest({nodeId:'desktop-primary',secret,timestamp,method:'POST',path:route,body:signedBody})}});assert.equal(r.status,401);
  }
  assert.equal((await fetch(baseUrl+route,{method:'POST',body:'{}'})).status,401);
}));
test('worker rejects replay after restart without repeating local observation',async()=>context(async({call,worker})=>{
  const p=call('desktop.status','restart-1');await new Promise(ok=>setTimeout(ok,100));
  const {job}=await worker.request('poll',{});let calls=0;
  worker.request=async action=>action==='poll'?{job}:{acknowledged:true,requestId:job.requestId};worker.local=async()=>{calls++;return STATUS;};
  await worker.once();await assert.rejects(worker.once(),/OBSERVATION_REPLAY/);assert.equal(calls,1);
  // The fixture intercepted reporting, so reconcile the test owner explicitly.
  // Send the real signed report using a fresh transport instance and same claimed ID.
  const original=ObservationClient.prototype.request;
  await original.call(worker,'report',{...job,result:STATUS});await p;
}));
test('LIVE current Windows image and actual known-folder Desktop through MCP', {skip:!process.env.ORQUESTRA_TEST_OBSERVATION_URL},async()=>context(async({call,worker})=>{
  async function observe(op,id,args={}){const pending=call(op,id,args);await new Promise(ok=>setTimeout(ok,100));await worker.once();return pending;}
  const status=await observe('desktop.status','live-status');assert.equal(status.isError,undefined);assert.ok(status.structuredContent.observation.available);
  await new Promise(ok=>setTimeout(ok,2100));
  const windows=await observe('desktop.windows.list','live-windows');assert.equal(windows.isError,undefined);
  assert.ok(windows.structuredContent.observation.windows.length>0);
  const selected=windows.structuredContent.observation.windows.find(w=>w.Foreground)||windows.structuredContent.observation.windows[0];
  await new Promise(ok=>setTimeout(ok,2100));
  const inspected=await observe('desktop.window.inspect','live-window',{ref:selected.Ref});assert.equal(inspected.isError,undefined);
  assert.equal(inspected.structuredContent.observation.window.Ref,selected.Ref);
  await new Promise(ok=>setTimeout(ok,2100));
  const ui=await observe('desktop.ui.inspect','live-ui',{window_ref:selected.Ref,max_depth:2,max_nodes:20});
  if(ui.isError) {
    const message=ui.content.filter(c=>c.type==='text').map(c=>c.text).join('');
    assert.match(message,/UIA_PROVIDER_UNAVAILABLE|UIA_TIMEOUT/);
    console.log(JSON.stringify({realUiInspect:false,safeTypedFailure:message.includes('UIA_TIMEOUT')?'UIA_TIMEOUT':'UIA_PROVIDER_UNAVAILABLE'}));
  } else {
    assert.ok(Array.isArray(ui.structuredContent.observation.elements));
    console.log(JSON.stringify({realUiInspect:true,elements:ui.structuredContent.observation.elements.length,valuesNotRead:true}));
  }
  await new Promise(ok=>setTimeout(ok,2100));
  const shot=await observe('desktop.screenshot','live-shot');assert.equal(shot.isError,undefined);
  const image=shot.content.find(c=>c.type==='image');assert.ok(image);assert.equal(image.mimeType,'image/png');
  const bytes=Buffer.from(image.data,'base64');assert.equal(bytes.readUInt32BE(16),shot.structuredContent.observation.width);
  console.log(JSON.stringify({realWindowsScreenshot:true,nodeId:'desktop-primary',evidenceId:shot.structuredContent.observation.evidenceId,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,capturedAt:shot.structuredContent.observation.capturedAt}));
  await new Promise(ok=>setTimeout(ok,2100));
  const files=await observe('desktop.files.list','live-files',{limit:5});assert.equal(files.isError,undefined);
  assert.equal(files.structuredContent.observation.scope,'windows_known_folder_desktop');
  console.log(JSON.stringify({realDesktopList:true,count:files.structuredContent.observation.entries.length,privateNamesNotLogged:true}));
}));

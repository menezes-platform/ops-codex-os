const test = require('node:test');
const assert = require('node:assert/strict');
const { ObservationQueue } = require('./src/fleet/observation');
const { MemoryAuthorityStore } = require('./src/persistflow/authority-store');
const STATUS={available:true,sessionId:1,hostname:'DESKTOP-L6CITUI',userSid:'S-1-5-test',coordinateSpace:'physical_pixels',monitors:[]};

function fixture(options={}) {
  let time=Date.now();
  const store=new MemoryAuthorityStore([{runId:'desktop-run',generation:1,status:'ACTIVE'}]);
  const service={store,assertRunGeneration(runId,generation){const r=store.get(runId);if(!r)throw Error('RUN_NOT_FOUND');if(r.generation!==generation)throw Error('STALE_GENERATION');return r;},fleetStatus(){return {nodes:[{nodeId:'desktop-primary',fresh:true,heartbeat:{hostname:'DESKTOP-L6CITUI'}}]};}};
  const queue=new ObservationQueue({service,enabled:true,nodes:{'desktop-primary':{hostname:'DESKTOP-L6CITUI',operations:['desktop.status','desktop.screenshot']}},clock:()=>time,...options});
  const request={runId:'desktop-run',generation:1,operationId:'observe-1',nodeId:'desktop-primary',operation:'desktop.status',arguments:{}};
  return {queue,service,store,request,advance(ms){time+=ms;}};
}
test('observation opt-in, fixed operation/node/generation and fresh heartbeat gates',async()=>{
  for(const change of [{enabled:false},{nodes:{}}]){const f=fixture(change);await assert.rejects(f.queue.observe(f.request),/OBSERVATION_(DISABLED|NODE_DENIED)/);}
  for(const patch of [{nodeId:'other'},{operation:'desktop.window.close'},{generation:2},{arguments:{command:'whoami'}}]){const f=fixture();await assert.rejects(f.queue.observe({...f.request,...patch}),/DENIED|STALE|INVALID/);}
  const f=fixture();f.service.fleetStatus=()=>({nodes:[{nodeId:'desktop-primary',fresh:false}]});await assert.rejects(f.queue.observe(f.request),/NODE_UNAVAILABLE/);
});
test('claim is once only, reply binds node and job; replay cannot replace result',async()=>{
  const f=fixture();const promise=f.queue.observe(f.request);
  const {job}=f.queue.poll('desktop-primary');assert.ok(job);assert.equal(f.queue.poll('desktop-primary').job,null);
  assert.throws(()=>f.queue.report('other',{...job,result:{available:true}}),/NODE_DENIED/);
  f.queue.report('desktop-primary',{...job,result:STATUS});
  assert.equal((await promise).structuredContent.observation.available,true);
  assert.throws(()=>f.queue.report('desktop-primary',{...job,result:{available:false}}),/REPLAY/);
  assert.equal(JSON.stringify(f.store.list()).includes('available'),false);
  assert.equal((await f.queue.observe(f.request)).structuredContent.replayed,true);
});
test('timeout and Authority restart do not replay claimed observations',async()=>{
  const f=fixture({waitMs:20});const p=f.queue.observe(f.request);f.queue.poll('desktop-primary');
  await assert.rejects(p,/OBSERVATION_TIMEOUT/);
  const recovered=new ObservationQueue({service:f.service,enabled:true,nodes:f.queue.nodes});
  assert.equal(recovered.poll('desktop-primary').job,null);
  await assert.rejects(recovered.observe(f.request),/OBSERVATION_RESULT_EXPIRED/);
});
test('malformed and oversized image rejected without durable contents',async()=>{
  for(const result of [{mimeType:'image/png',data:'evil'},{mimeType:'image/png',data:'a'.repeat(1500000)}]){
    const f=fixture({waitMs:20});const p=f.queue.observe({...f.request,operation:'desktop.screenshot'});const {job}=f.queue.poll('desktop-primary');
    assert.throws(()=>f.queue.report('desktop-primary',{...job,result}),/INVALID_OBSERVATION_RESULT/);
    await assert.rejects(p,/OBSERVATION_TIMEOUT/);
  }
});
test('node hostname mismatch, exhausted limits and operation ID conflicts fail closed',async()=>{
  const wrong=fixture();wrong.service.fleetStatus=()=>({nodes:[{nodeId:'desktop-primary',fresh:true,heartbeat:{hostname:'OTHER'}}]});
  await assert.rejects(wrong.queue.observe(wrong.request),/NODE_UNAVAILABLE/);
  const f=fixture({waitMs:20}),p=f.queue.observe(f.request);
  await assert.rejects(f.queue.observe({...f.request,operationId:'other'}),/RATE_LIMIT/);
  await assert.rejects(f.queue.observe({...f.request,operation:'desktop.screenshot'}),/ID_CONFLICT/);
  await assert.rejects(p,/TIMEOUT/);
});
test('invalid file names and UI/image payload budgets rejected before transport',async()=>{
  const f=fixture();f.queue.nodes['desktop-primary'].operations.push('desktop.files.stat','desktop.ui.inspect');
  for(const name of ['../private','C:\\Windows','file.txt:stream']) await assert.rejects(f.queue.observe({...f.request,operation:'desktop.files.stat',arguments:{name}}),/INVALID/);
  await assert.rejects(f.queue.observe({...f.request,operation:'desktop.ui.inspect',arguments:{window_ref:'win-1',max_nodes:301}}),/INVALID/);
});
test('malformed optional observation settings cannot interrupt the existing Authority',()=>{
  const {productionDesktopObservationConfiguration}=require('./src/start-entrypoint');
  assert.deepEqual(productionDesktopObservationConfiguration({PERSISTFLOW_DESKTOP_OBSERVATION_NODES_JSON:'bad'}),{enabled:false,nodes:{}});
  assert.deepEqual(productionDesktopObservationConfiguration({PERSISTFLOW_DESKTOP_OBSERVATION_ENABLED:'1',PERSISTFLOW_DESKTOP_OBSERVATION_NODES_JSON:'bad'}),{enabled:false,nodes:{}});
});
test('invalid image expiry and untyped observation results are rejected',()=>{
  const {validateResult}=require('./src/fleet/observation');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=';
  assert.throws(()=>validateResult('desktop.screenshot',{mimeType:'image/png',data:png,width:1,height:1,sourceBounds:{X:0,Y:0,Width:1,Height:1},coordinateSpace:'physical_pixels',capturedAt:new Date().toISOString(),expiresAt:'bad',evidenceId:'a'.repeat(32)}),/INVALID_OBSERVATION_RESULT/);
  assert.throws(()=>validateResult('desktop.status',{unexpected:'payload'}),/INVALID_OBSERVATION_RESULT/);
  assert.throws(()=>validateResult('desktop.ui.inspect',{elements:[{name:'Password',controlType:'Edit',value:'private'}]}),/INVALID_OBSERVATION_RESULT/);
});
test('storage failure during timeout rejects safely and preserves replay fencing',{timeout:200},async()=>{
  const f=fixture({waitMs:20});const pending=f.queue.observe(f.request);f.queue.poll('desktop-primary');
  f.store.update=()=>{throw Error('private storage path failure');};
  await assert.rejects(pending,/OBSERVATION_STORAGE_UNAVAILABLE/);
  assert.equal(f.queue.poll('desktop-primary').job,null);
});

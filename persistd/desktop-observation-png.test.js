const test=require('node:test');
const assert=require('node:assert/strict');
const {crc32,deflateSync}=require('node:zlib');
const {validateResult}=require('./src/fleet/observation');

function chunk(type,data) {
  const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);
  b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;
}
function png(raw=Buffer.from([0,0,0,0,255]),tail=Buffer.alloc(0)) {
  const header=Buffer.from('00000001000000010806000000','hex');
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',Buffer.concat([deflateSync(raw),tail])),chunk('IEND',Buffer.alloc(0))]);
}
function result(bytes) {
  const now=Date.now();return {mimeType:'image/png',data:bytes.toString('base64'),width:1,height:1,
    sourceBounds:{X:0,Y:0,Width:1,Height:1},coordinateSpace:'physical_pixels',capturedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+30000).toISOString(),evidenceId:'a'.repeat(32)};
}
test('normalized PNG is fully consumable and remains memory only',()=>{
  assert.equal(validateResult('desktop.screenshot',result(png())).width,1);
});
test('PNG corruption, inflated excess, invalid filters, and trailing streams fail closed',()=>{
  const corrupt=png();corrupt[corrupt.length-1]^=1;
  for(const bytes of [corrupt,png().subarray(0,-1),png(Buffer.alloc(65536)),png(Buffer.from([5,0,0,0,0])),png(undefined,Buffer.from([1])),Buffer.concat([png(),Buffer.from([0])])])
    assert.throws(()=>validateResult('desktop.screenshot',result(bytes)),/INVALID_OBSERVATION_RESULT/);
});
test('image bounds cannot carry untyped private fields',()=>{
  const r=result(png());r.sourceBounds.private='not allowed';
  assert.throws(()=>validateResult('desktop.screenshot',r),/INVALID_OBSERVATION_RESULT/);
});

test('a new claim cannot return a capture predating that request',async()=>{
  const {ObservationQueue}=require('./src/fleet/observation');
  const {MemoryAuthorityStore}=require('./src/persistflow/authority-store');
  const now=Date.now(),store=new MemoryAuthorityStore([{runId:'run',generation:1,status:'ACTIVE'}]);
  const service={store,assertRunGeneration:()=>store.get('run'),fleetStatus:()=>({nodes:[{nodeId:'desktop-primary',fresh:true,heartbeat:{hostname:'DESKTOP-L6CITUI'}}]})};
  const queue=new ObservationQueue({service,enabled:true,nodes:{'desktop-primary':{hostname:'DESKTOP-L6CITUI',operations:['desktop.screenshot']}},clock:()=>now,waitMs:30});
  const pending=queue.observe({runId:'run',generation:1,operationId:'capture',nodeId:'desktop-primary',operation:'desktop.screenshot',arguments:{}});
  const {job}=queue.poll('desktop-primary'),r=result(png());r.capturedAt=new Date(now-29000).toISOString();r.expiresAt=new Date(now+1000).toISOString();
  try {assert.throws(()=>queue.report('desktop-primary',{...job,result:r}),/INVALID_OBSERVATION_RESULT/);}
  finally {await pending.catch(()=>{});}
});

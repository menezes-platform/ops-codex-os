'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../persistd/src/persistflow/http-server');
const {PairingRegistry}=require('../persistd/src/fleet/pairing-registry');
const {MemoryFleetStore}=require('../persistd/src/fleet/store');
const {MemoryAuthorityStore}=require('../persistd/src/persistflow/authority-store');
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-pair-api-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config={nodes:[{id:'desktop-primary',drained:false,capabilities:['git','node'],concurrencyLimit:1}]};
 const secrets={'desktop-primary':'b'.repeat(64)};
 const registry=new PairingRegistry({directory:root});
 const server=createServer({store:new MemoryAuthorityStore(),fleetStore:new MemoryFleetStore(),fleetConfig:config,fleetNodeSecrets:secrets,pairingRegistry:registry,mcpToken:'owner-test',driveAuth:null});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {base:'http://127.0.0.1:'+server.address().port,root,config,secrets};
}
async function post(base,endpoint,body,headers={}){
 return fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
}
test('only the owner can issue pairing invitation; unapproved device cannot enroll',async t=>{
 const {base}=await setup(t);
 const unauthorized=await post(base,'/v1/fleet/pairing-invitations',{});
 assert.equal(unauthorized.status,401);
 const invalid=await post(base,'/v1/fleet/enroll',{nodeId:'node-unauthorized',secret:'a'.repeat(64),pairingCode:'nonsense'});
 assert.equal(invalid.status,403);
});
test('approved invitation auto-registers drained node and HMAC heartbeat works immediately',async t=>{
 const {base,config,secrets}=await setup(t);
 const issued=await post(base,'/v1/fleet/pairing-invitations',{}, {authorization:'Bearer owner-test'});
 assert.equal(issued.status,201);
 const {pairingCode,expiresAt}=await issued.json();
 assert.ok(pairingCode.length>25);assert.ok(Date.parse(expiresAt)>Date.now());
 const nodeId='node-auto-join',secret=crypto.randomBytes(32).toString('hex');
 const enrollment=await post(base,'/v1/fleet/enroll',{nodeId,secret,pairingCode});
 assert.equal(enrollment.status,201,await enrollment.text());
 assert.equal(config.nodes.find(n=>n.id===nodeId).drained,true);
 assert.equal(secrets[nodeId],secret);
 const heartbeat={observedAt:new Date().toISOString(),hostname:'SMOKE',freeDiskBytes:99999,totalDiskBytes:100000,freeMemoryBytes:2048,totalMemoryBytes:4096,cpuPercent:1,activeJobs:0,cacheBytes:0,cachedObjectHashes:[],runtimeVersion:'2.0',capabilitiesHash:'abc'};
 const endpoint='/v1/fleet/nodes/'+nodeId+'/heartbeat';const body=JSON.stringify(heartbeat),timestamp=new Date().toISOString();
 const signature=crypto.createHmac('sha256',secret).update([nodeId,timestamp,'POST',endpoint,body].join('\n')).digest('hex');
 const response=await fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json','x-persistflow-node-id':nodeId,'x-persistflow-node-timestamp':timestamp,'x-persistflow-node-signature':signature},body});
 assert.equal(response.status,200,await response.text());
 const replay=await post(base,'/v1/fleet/enroll',{nodeId:'different-node',secret,pairingCode});assert.equal(replay.status,403);
});
test('an already registered static node cannot be replaced by invitation',async t=>{
 const {base}=await setup(t);
 const response=await post(base,'/v1/fleet/pairing-invitations',{}, {authorization:'Bearer owner-test'});
 const {pairingCode}=await response.json();
 const result=await post(base,'/v1/fleet/enroll',{nodeId:'desktop-primary',secret:'a'.repeat(64),pairingCode});
 assert.equal(result.status,409);
});
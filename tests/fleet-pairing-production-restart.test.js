'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
async function freePort(){const s=http.createServer();return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));}));}
async function start(t,dir,port){
 const proc=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),PERSISTFLOW_DATA_DIR:dir,PERSISTFLOW_MCP_TOKEN:'pair-owner-smoke',PERSISTFLOW_FLEET_ROUTER_ENABLED:'0'},windowsHide:true,stdio:'ignore'});
 t.after(()=>proc.kill());
 const base='http://127.0.0.1:'+port,until=Date.now()+10000;
 while(Date.now()<until){if(proc.exitCode!==null)throw new Error('authority exited');try{const resp=await fetch(base+'/healthz');if(resp.ok)return {proc,base};}catch{}await new Promise(r=>setTimeout(r,65));}
 throw new Error('authority startup timeout');
}
async function request(base,payload,endpoint,headers={}){return fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});}
test('production root persists paired node, auto-enrolls it and accepts heartbeat after reboot',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pair-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const port=await freePort();const first=await start(t,dir,port);
 const response=await request(first.base,{},'/v1/fleet/pairing-invitations',{authorization:'Bearer pair-owner-smoke'});
 assert.equal(response.status,201);const {pairingCode}=await response.json();
 const secret=crypto.randomBytes(32).toString('hex'),nodeId='node-persistent-test';
 const enrolled=await request(first.base,{nodeId,secret,pairingCode},'/v1/fleet/enroll');
 assert.equal(enrolled.status,201);
 first.proc.kill();await new Promise(r=>first.proc.once('exit',r));
 const second=await start(t,dir,port);
 const endpoint='/v1/fleet/nodes/'+nodeId+'/heartbeat';const heartbeat=JSON.stringify({observedAt:new Date().toISOString(),hostname:'RESTART',freeDiskBytes:100000,totalDiskBytes:150000,freeMemoryBytes:4000,totalMemoryBytes:8000,cpuPercent:1,activeJobs:0,cacheBytes:0,cachedObjectHashes:[],runtimeVersion:'2',capabilitiesHash:'x'});const timestamp=new Date().toISOString();const signature=crypto.createHmac('sha256',secret).update([nodeId,timestamp,'POST',endpoint,heartbeat].join('\n')).digest('hex');
 const status=await fetch(second.base+endpoint,{method:'POST',headers:{'content-type':'application/json','x-persistflow-node-id':nodeId,'x-persistflow-node-timestamp':timestamp,'x-persistflow-node-signature':signature},body:heartbeat});
 assert.equal(status.status,200);
});
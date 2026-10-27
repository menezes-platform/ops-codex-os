'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {main}=require('../persistd/src/fleet/silent-job-cli');
function setup(t,taskId='drive-cli-test'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drive-cli-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspaces',taskId),requests=path.join(root,'requests');
 fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(requests,{recursive:true});
 const manifest=path.join(requests,taskId+'.json');
 fs.writeFileSync(manifest,JSON.stringify({taskId,tool:'node',args:['-e','require("fs").writeFileSync("output.txt","saved-on-drive");console.log("job-done")'],cwd:workspace}));
 return {root,workspace,manifest,env:{...process.env,FLEET_SILENT_JOB_ROOT:root},taskId};
}
function store(rows){return {async put(filePath,meta){
 const bytes=fs.readFileSync(filePath);
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 rows.push({bytes,meta});
 return {ref:'sha256:'+digest,size:bytes.length,durable:true,fileId:'blob-'+rows.length,manifestFileId:'manifest-'+rows.length};
}}}

test('CLI archives job workspace, stdout and receipt to Drive before removing transient files',async t=>{
 const f=setup(t),rows=[];
 let accessPreflight=false;
 const result=await main([f.manifest],f.env,{getStore:async()=>{accessPreflight=true;return store(rows);},runJob:async (...args)=>{
  assert.equal(accessPreflight,true);
  return require('../persistd/src/fleet/silent-job').runSilentJob(...args);
 }});
 assert.equal(result.durable,true);
 assert.equal(result.jobStatus,'completed');
 assert.ok(rows.some(item=>item.bytes.toString()==='saved-on-drive'));
 assert.ok(rows.some(item=>item.bytes.toString().includes('job-done')));
 assert.ok(rows.at(-1).meta.kind==='job-index');
 assert.equal(fs.existsSync(f.workspace),false);
 assert.equal(fs.existsSync(f.manifest),false);
});

test('CLI must not start a job when Drive preflight fails',async t=>{
 const f=setup(t);
 let executed=false;
 await assert.rejects(main([f.manifest],f.env,{getStore:async()=>{throw new Error('OBJECT_STORE_NOT_CONFIGURED');},runJob:async()=>{executed=true;}}),/OBJECT_STORE_NOT_CONFIGURED/);
 assert.equal(executed,false);
 assert.equal(fs.existsSync(f.manifest),true);
 assert.equal(fs.existsSync(path.join(f.root,'logs')),false);
});

test('pending Drive upload retries without re-running job or deleting result prematurely',async t=>{
 const f=setup(t),rows=[];
 let executed=0;
 const runJob=async input=>{executed++;return require('../persistd/src/fleet/silent-job').runSilentJob(input);};
 const real=store(rows);
 let failed=false;
 await assert.rejects(main([f.manifest],f.env,{getStore:async()=>({async put(p,m){if(!failed){failed=true;throw new Error('DRIVE_OFFLINE');}return real.put(p,m);}}),runJob}),/DRIVE_OFFLINE/);
 assert.equal(executed,1);
 assert.equal(fs.existsSync(f.workspace),true);
 assert.equal(fs.existsSync(path.join(f.root,'logs',f.taskId,'receipt.json')),true);
 const completed=await main([f.manifest],f.env,{getStore:async()=>real,runJob});
 assert.equal(completed.durable,true);
 assert.equal(executed,1);
 assert.equal(fs.existsSync(f.workspace),false);
});
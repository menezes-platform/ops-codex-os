'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runSilentJob,prepareSilentJob}=require('../persistd/src/fleet/silent-job');
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'martha-quota-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,logRoot:path.join(root,'logs')};
}
test('rejects oversized workspace policies before child starts',t=>{
 const {root}=fixture(t);
 assert.throws(()=>prepareSilentJob({taskId:'bad-policy',tool:'node',args:['-e','0'],cwd:root,allowedRoot:root,maxWorkspaceBytes:0}),/SILENT_JOB_WORKSPACE_QUOTA_INVALID/);
 assert.throws(()=>prepareSilentJob({taskId:'bad-policy',tool:'node',args:['-e','0'],cwd:root,allowedRoot:root,maxWorkspaceBytes:257*1024*1024}),/SILENT_JOB_WORKSPACE_QUOTA_INVALID/);
});
test('fails closed before creating logs if free disk reserve cannot be met',async t=>{
 const {root,logRoot}=fixture(t);
 await assert.rejects(runSilentJob({taskId:'insufficient-reserve',tool:'node',args:['-e','process.exit(0)'],cwd:root,allowedRoot:root,logRoot,minFreeDiskBytes:Number.MAX_SAFE_INTEGER}),/SILENT_JOB_INSUFFICIENT_DISK/);
 assert.equal(fs.existsSync(logRoot),false);
});
test('stops a workspace expanding past its cap and preserves failure evidence for Drive archiving',async t=>{
 const {root,logRoot}=fixture(t);
 const result=await runSilentJob({taskId:'overflow',tool:'node',args:['-e',
   'const fs=require("fs");fs.writeFileSync("payload.bin",Buffer.alloc(3*1024*1024));setInterval(()=>{},500)'],
   cwd:root,allowedRoot:root,logRoot,maxWorkspaceBytes:1024*1024,workspaceScanMs:100,timeoutMs:5000,minFreeDiskBytes:0});
 assert.equal(result.status,'failed');
 assert.equal(result.errorCode,'SILENT_JOB_WORKSPACE_LIMIT_EXCEEDED');
 assert.equal(fs.existsSync(path.join(root,'payload.bin')),true);
 assert.equal(JSON.parse(fs.readFileSync(result.receiptPath,'utf8')).errorCode,'SILENT_JOB_WORKSPACE_LIMIT_EXCEEDED');
});
test('routes temporary files into the job workspace rather than the system temp',async t=>{
 const {root,logRoot}=fixture(t);
 const result=await runSilentJob({taskId:'temp-isolation',tool:'node',args:['-e',
   'require("fs").writeFileSync(require("path").join(require("os").tmpdir(),"scratch.txt"),"inside")'],
   cwd:root,allowedRoot:root,logRoot,minFreeDiskBytes:0});
 assert.equal(result.status,'completed');
 assert.equal(fs.readFileSync(path.join(root,'.tmp','scratch.txt'),'utf8'),'inside');
});

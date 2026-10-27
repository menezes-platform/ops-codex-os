'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {archiveJobAndRelease} = require('../persistd/src/fleet/drive-job-archive');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-drive-job-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const taskId='test-drive-job';
 const jobDir=path.join(root,'logs',taskId);
 const workspace=path.join(root,'workspaces',taskId);
 fs.mkdirSync(jobDir,{recursive:true});fs.mkdirSync(workspace,{recursive:true});
 fs.writeFileSync(path.join(workspace,'result.txt'),'artifact-content');
 fs.writeFileSync(path.join(jobDir,'stdout.log'),'stdout');
 fs.writeFileSync(path.join(jobDir,'stderr.log'),'');
 const receiptPath=path.join(jobDir,'receipt.json');
 fs.writeFileSync(receiptPath,JSON.stringify({taskId,status:'completed',exitCode:0}));
 const manifestPath=path.join(root,'requests',taskId+'.json');
 fs.mkdirSync(path.dirname(manifestPath),{recursive:true});fs.writeFileSync(manifestPath,'{}');
 return {root,taskId,jobDir,workspace,receiptPath,manifestPath,receipt:{taskId,status:'completed',receiptPath,stdoutPath:path.join(jobDir,'stdout.log'),stderrPath:path.join(jobDir,'stderr.log')}};
}
function confirmedStore(rows){return {async put(filePath, metadata){
 const bytes=fs.readFileSync(filePath);
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 rows.push({bytes,metadata,filePath});
 return {ref:'sha256:'+sha256,sha256,size:bytes.length,durable:true,fileId:'blob-'+rows.length,manifestFileId:'manifest-'+rows.length};
}}}

test('Drive is canonical: all workspace outputs plus logs and receipt are saved before local cleanup',async t=>{
 const f=fixture(t);const puts=[];
 const result=await archiveJobAndRelease({...f,store:confirmedStore(puts)});
 assert.equal(result.durable,true);
 assert.match(result.manifestRef,/^sha256:[a-f0-9]{64}$/);
 assert.equal(result.objects.length,4);
 assert.deepEqual(result.objects.map(x=>x.path).sort(),['logs/receipt.json','logs/stderr.log','logs/stdout.log','workspace/result.txt'].sort());
 assert.equal(puts.length,4); // empty stderr is encoded inline in Drive index
 const index=JSON.parse(puts.at(-1).bytes.toString());
 assert.equal(index.taskId,f.taskId);
 assert.equal(index.objects.length,4);
 assert.equal(index.objects.find(o=>o.path === 'logs/stderr.log').inlineEmpty,true);
 assert.equal(fs.existsSync(f.jobDir),false);
 assert.equal(fs.existsSync(f.workspace),false);
 assert.equal(fs.existsSync(f.manifestPath),false);
});

test('Drive failure preserves ALL local files and refuses durable completion',async t=>{
 const f=fixture(t);let count=0;
 const valid=confirmedStore([]);const store={async put(filePath,metadata){if(++count===2) throw new Error('DRIVE_UNAVAILABLE');return valid.put(filePath,metadata);}};
 await assert.rejects(archiveJobAndRelease({...f,store}),/DRIVE_UNAVAILABLE/);
 assert.equal(fs.existsSync(f.jobDir),true);
 assert.equal(fs.existsSync(path.join(f.workspace,'result.txt')),true);
 assert.equal(fs.existsSync(f.manifestPath),true);
});

test('false or incomplete Drive confirmation never permits local cleanup',async t=>{
 const f=fixture(t);
 await assert.rejects(archiveJobAndRelease({...f,store:{async put(){return {durable:false,ref:'sha256:'+'a'.repeat(64)};}}}),/DRIVE_OBJECT_NOT_CONFIRMED/);
 assert.equal(fs.existsSync(f.jobDir),true);
 assert.equal(fs.existsSync(f.workspace),true);
});

test('symlinked output is rejected and retained locally, not uploaded',async t=>{
 const f=fixture(t);const outside=path.join(f.root,'outside-dir');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.txt'),'private');
 const link=path.join(f.workspace,'linked-dir');
 try{fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');}
 catch(error){
  if(error.code==='EPERM'){
   // Windows without symlink/junction permissions: verify the guard is present without claiming a runtime symlink test.
   assert.match(fs.readFileSync(path.join(__dirname,'../persistd/src/fleet/drive-job-archive.js'),'utf8'),/stat\.isSymbolicLink\(\)/);
   return;
  }
  throw error;
 }
 const rows=[];
 await assert.rejects(archiveJobAndRelease({...f,store:confirmedStore(rows)}),/DRIVE_JOB_SYMLINK_FORBIDDEN/);
 assert.equal(rows.length,0);
 assert.equal(fs.existsSync(f.workspace),true);
});

test('Drive archive is constrained to per-job workspace and cannot delete arbitrary user directory',async t=>{
 const f=fixture(t);const other=path.join(f.root,'my-work');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'important.txt'),'preserve');
 await assert.rejects(archiveJobAndRelease({...f,workspace:other,store:confirmedStore([])}),/DRIVE_JOB_WORKSPACE_INVALID/);
 assert.equal(fs.readFileSync(path.join(other,'important.txt'),'utf8'),'preserve');
});

test('a failed job still archives its diagnostic result before cleanup',async t=>{
 const f=fixture(t);f.receipt.status='failed';const puts=[];
 const result=await archiveJobAndRelease({...f,store:confirmedStore(puts)});
 assert.equal(result.durable,true);
 assert.equal(result.jobStatus,'failed');
 assert.equal(JSON.parse(puts.at(-1).bytes.toString()).status,'failed');
});
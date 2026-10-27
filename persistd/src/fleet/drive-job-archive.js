'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {hashFile}=require('../storage/object-store');
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_OBJECTS=256;
const MAX_BYTES=256*1024*1024;
function inside(root,target){
 const rel=path.relative(root,target);
 return rel==='' || (rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));
}
function demandSame(actual,expected,code){
 if(path.resolve(actual)!==path.resolve(expected))throw new Error(code);
}
function listFiles(dir,prefix,out){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const name=prefix+'/'+entry.name;
  const abs=path.join(dir,entry.name);
  const stat=fs.lstatSync(abs);
  if(stat.isSymbolicLink())throw new Error('DRIVE_JOB_SYMLINK_FORBIDDEN');
  if(stat.isDirectory())listFiles(abs,name,out);
  else if(stat.isFile())out.push({path:name,filePath:abs,size:stat.size});
  else throw new Error('DRIVE_JOB_NONFILE_FORBIDDEN');
  if(out.length>MAX_OBJECTS)throw new Error('DRIVE_JOB_TOO_MANY_OUTPUTS');
 }
}
async function archiveJobAndRelease({root,taskId,jobDir,workspace,receiptPath,manifestPath,receipt,store}={}){
 if(!ID.test(String(taskId||'')))throw new Error('DRIVE_JOB_TASK_ID_INVALID');
 if(!root||!store||typeof store.put!=='function')throw new Error('DRIVE_JOB_STORE_REQUIRED');
 const canonicalRoot=fs.realpathSync(root);
 demandSame(workspace,path.join(canonicalRoot,'workspaces',taskId),'DRIVE_JOB_WORKSPACE_INVALID');
 demandSame(jobDir,path.join(canonicalRoot,'logs',taskId),'DRIVE_JOB_LOGDIR_INVALID');
 demandSame(receiptPath,path.join(jobDir,'receipt.json'),'DRIVE_JOB_RECEIPT_INVALID');
 demandSame(manifestPath,path.join(canonicalRoot,'requests',taskId+'.json'),'DRIVE_JOB_MANIFEST_INVALID');
 for(const target of [workspace,jobDir,receiptPath,manifestPath]){
  const lstat=fs.lstatSync(target);
  if(lstat.isSymbolicLink()||!inside(canonicalRoot,fs.realpathSync(target)))throw new Error('DRIVE_JOB_SYMLINK_FORBIDDEN');
 }
 if(!receipt||receipt.taskId!==taskId||!['completed','failed','timeout'].includes(receipt.status))throw new Error('DRIVE_JOB_RECEIPT_INVALID');
 const files=[];
 listFiles(workspace,'workspace',files);
 listFiles(jobDir,'logs',files);
 if(!files.some(item=>item.path==='logs/receipt.json'))throw new Error('DRIVE_JOB_RECEIPT_MISSING');
 if(files.length>MAX_OBJECTS || files.reduce((sum,row)=>sum+row.size,0)>MAX_BYTES)throw new Error('DRIVE_JOB_OUTPUT_LIMIT_EXCEEDED');
 files.sort((a,b)=>a.path.localeCompare(b.path));
 const objects=[];
 for(const file of files){
  const expected=await hashFile(file.filePath);
  if(expected.size===0){
   // An empty file is fully reconstructible from the committed Drive index itself;
   // Google resumable uploads cannot finalize a zero-byte stream.
   objects.push({path:file.path,ref:'sha256:'+expected.sha256,size:0,inlineEmpty:true});
   continue;
  }
  const confirmation=await store.put(file.filePath,{namespace:'fleet-job',kind:'job-output',taskId,path:file.path});
  if(confirmation.durable!==true || confirmation.ref!=='sha256:'+expected.sha256 || confirmation.size!==expected.size || !confirmation.fileId || !confirmation.manifestFileId){
   throw new Error('DRIVE_OBJECT_NOT_CONFIRMED');
  }
  objects.push({path:file.path,ref:confirmation.ref,size:confirmation.size,fileId:confirmation.fileId,manifestFileId:confirmation.manifestFileId});
 }
 const index={schema:1,taskId,status:receipt.status,createdAt:String(receipt.finishedAt||receipt.startedAt||new Date(0).toISOString()),objects};
 const indexPath=path.join(jobDir,'drive-index.json');
 fs.writeFileSync(indexPath,JSON.stringify(index,null,2)+'\n'); // idempotent on upload retry; per-job isolated directory
 const confirmation=await store.put(indexPath,{namespace:'fleet-job',kind:'job-index',taskId});
 const expected=await hashFile(indexPath);
 if(confirmation.durable!==true || confirmation.ref!=='sha256:'+expected.sha256 || !confirmation.fileId || !confirmation.manifestFileId){
  throw new Error('DRIVE_OBJECT_NOT_CONFIRMED');
 }
 const result={durable:true,taskId,jobStatus:receipt.status,manifestRef:confirmation.ref,objects};
 // Only the named, dedicated worker job paths can be deleted; nothing outside these roots.
 fs.rmSync(workspace,{recursive:true,force:false});
 fs.rmSync(jobDir,{recursive:true,force:false});
 fs.rmSync(manifestPath,{force:false});
 return result;
}
module.exports={archiveJobAndRelease};
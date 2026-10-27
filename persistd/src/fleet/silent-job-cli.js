'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runSilentJob}=require('./silent-job');
const {archiveJobAndRelease}=require('./drive-job-archive');
const {createWorkerDriveAccess}=require('./worker-drive-access');
const {DriveClient}=require('../storage/drive-client');
const {DriveObjectStore}=require('../storage/object-store');

function inside(root,target){
 const rel=path.relative(root,target);
 return rel==='' || (rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel));
}
function parseManifest(manifestPath){
 return JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''));
}
async function productionStore(env=process.env,{agentDir=__dirname}={}){
 const configPath=path.join(agentDir,'worker-config.json');
 let config;
 try{config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));}
 catch{throw new Error('DRIVE_ARCHIVE_NOT_CONFIGURED');}
 if(!config?.baseUrl||!config?.nodeId)throw new Error('DRIVE_ARCHIVE_NOT_CONFIGURED');
 const provider=createWorkerDriveAccess({baseUrl:config.baseUrl,nodeId:config.nodeId,secretPath:path.join(agentDir,'..','node-secret.txt')});
 const access=await provider(); // require valid credentials BEFORE job execution
 const client=new DriveClient({tokenProvider:provider});
 return new DriveObjectStore({client,rootId:access.rootId});
}
async function main(args=process.argv.slice(2),env=process.env,{
 getStore=productionStore,runJob=runSilentJob,archive=archiveJobAndRelease,
}={}){
 const localData=env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
 const root=fs.realpathSync(env.FLEET_SILENT_JOB_ROOT||path.join(localData,'ConthabilFleet','jobs'));
 if(args.length!==1||!args[0])throw new Error('SILENT_JOB_MANIFEST_REQUIRED');
 const manifestPath=fs.realpathSync(path.resolve(args[0]));
 if(!inside(root,manifestPath))throw new Error('SILENT_JOB_MANIFEST_OUTSIDE_ROOT');
 const job=parseManifest(manifestPath);
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(String(job?.taskId||'')))throw new Error('SILENT_JOB_ID_INVALID');
 if(path.resolve(manifestPath)!==path.join(root,'requests',job.taskId+'.json'))throw new Error('SILENT_JOB_MANIFEST_PATH_INVALID');
 const workspace=path.join(root,'workspaces',job.taskId);
 if(!job.cwd||fs.realpathSync(job.cwd)!==fs.realpathSync(workspace))throw new Error('SILENT_JOB_WORKSPACE_INVALID');
 const store=await getStore(env); // fails closed before work if Drive is unavailable
 const jobDir=path.join(root,'logs',job.taskId);
 const receiptPath=path.join(jobDir,'receipt.json');
 const receipt=fs.existsSync(receiptPath)
  ? JSON.parse(fs.readFileSync(receiptPath,'utf8')) // recover pending upload, NEVER rerun job
  : await runJob({...job,allowedRoot:root,logRoot:path.join(root,'logs')});
 try{
  const result=await archive({root,taskId:job.taskId,jobDir,workspace,receiptPath,manifestPath,receipt,store});
  process.stdout.write(JSON.stringify({taskId:job.taskId,durable:result.durable,manifestRef:result.manifestRef,status:receipt.status})+'\n');
  return result;
 }catch(error){
  // The job has local results but the Drive write has NOT been confirmed.
  error.pendingDriveArchive=true;
  throw error;
 }
}
if(require.main===module)main().then(result=>{
 if(result.jobStatus!=='completed')process.exitCode=1;
}).catch(error=>{
 process.stderr.write((error.pendingDriveArchive?'DRIVE_ARCHIVE_PENDING: ':'SILENT_JOB_ABORTED: ')+String(error?.code||error?.message||'unknown')+'\n');
 process.exitCode=error.pendingDriveArchive?2:1;
});
module.exports={main,parseManifest,productionStore};
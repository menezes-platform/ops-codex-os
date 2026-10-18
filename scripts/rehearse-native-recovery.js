'use strict';
// Qualification fixture only. Real personal-data backups require separate
// consent/encryption/key-custody gates; this command never accepts that scope.
const fs=require('node:fs/promises');const path=require('node:path');
const {createHash}=require('node:crypto');const {parseArgs}=require('node:util');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const run=promisify(execFile);const hash=data=>'sha256:'+createHash('sha256').update(data).digest('hex');
const SCOPE='project/rag-validation/aurora';const MAX=64*1024*1024;
async function createArchive(root){
 if(!path.isAbsolute(root)||(await fs.lstat(root)).isSymbolicLink())throw new Error('BACKUP_ROOT_INVALID');
 const state=JSON.parse(await fs.readFile(path.join(root,'qualification.json'),'utf8'));
 if(state.scope!==SCOPE||!['local-native-hybrid','local-native-lexical'].includes(state.mode))throw new Error('BACKUP_FIXTURE_SCOPE_REQUIRED');
 const entries=[];let total=0;
 async function walk(relative=''){
  const names=(await fs.readdir(path.join(root,relative))).sort();
  for(const name of names){
   const item=path.join(relative,name),target=path.join(root,item),before=await fs.lstat(target);
   if(before.isSymbolicLink())throw new Error('BACKUP_PATH_UNSAFE');
   if(before.isDirectory()){await walk(item);continue}
   if(!before.isFile()||before.nlink>1||/^\.env|credential|token|id_rsa|\.pem$/i.test(name))throw new Error('BACKUP_FILE_DENIED');
   total+=before.size;if(total>MAX||entries.length>=10000)throw new Error('BACKUP_TOO_LARGE');
   const bytes=await fs.readFile(target),after=await fs.lstat(target);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size)throw new Error('BACKUP_SOURCE_CHANGED');
   entries.push({path:item.split(path.sep).join('/'),sha256:hash(bytes),base64:bytes.toString('base64')});
  }
 }
 await walk();
 const bytes=Buffer.from(JSON.stringify({format:'rag-native-qualification-backup-v1',scope:SCOPE,entries})+'\n');
 return {bytes,sha256:hash(bytes),file_count:entries.length,source_bytes:total};
}
async function restoreArchive({bytes,expectedSha256,root}){
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX*2||hash(bytes)!==expectedSha256)throw new Error('BACKUP_DIGEST_MISMATCH');
 if(!path.isAbsolute(root))throw new Error('RESTORE_ROOT_INVALID');
 const archive=JSON.parse(bytes.toString('utf8'));
 if(archive.format!=='rag-native-qualification-backup-v1'||archive.scope!==SCOPE||!Array.isArray(archive.entries)||archive.entries.length>10000)throw new Error('BACKUP_FORMAT_INVALID');
 const paths=new Set();let total=0;
 const checked=archive.entries.map(entry=>{
  if(!entry||typeof entry.path!=='string'||path.isAbsolute(entry.path)||entry.path.includes('\\')||
     entry.path.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))||typeof entry.base64!=='string')throw new Error('BACKUP_PATH_UNSAFE');
  const portable=entry.path.toLowerCase();
  if(paths.has(portable))throw new Error('BACKUP_PATH_UNSAFE');
  paths.add(portable);const data=Buffer.from(entry.base64,'base64');total+=data.length;
  if(total>MAX||data.toString('base64')!==entry.base64||hash(data)!==entry.sha256)throw new Error('BACKUP_ENTRY_DIGEST_MISMATCH');
  return {...entry,data};
 });
 // Reject file/directory collisions in either input order, on every platform.
 for(const item of paths){const parts=item.split('/');for(let i=1;i<parts.length;i++)if(paths.has(parts.slice(0,i).join('/')))throw new Error('BACKUP_PATH_UNSAFE')}
 // Validate every checksum/path before the first write to a fresh directory.
 await fs.mkdir(root,{mode:0o700});
 for(const entry of checked){const target=path.join(root,...entry.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,entry.data,{flag:'wx',mode:0o600})}
 return {file_count:checked.length,source_bytes:total};
}
async function main(){
 const {values}=parseArgs({options:{'source-root':{type:'string'},backup:{type:'string'},'restore-root':{type:'string'},query:{type:'string'}}});
 for(const key of ['source-root','backup','restore-root'])if(!values[key]||!path.isAbsolute(values[key]))throw new Error('ABSOLUTE_PATHS_REQUIRED');
 if(!values.query)throw new Error('QUERY_REQUIRED');
 const cli=path.join(__dirname,'native-rag-slice.js');
 const invoke=async(...args)=>JSON.parse((await run(process.execPath,[cli,...args],{maxBuffer:2*1024*1024,windowsHide:true})).stdout);
 const before=await invoke('--root',values['source-root'],'--query',values.query);
 if(before.status!=='ok')throw new Error('SOURCE_RECALL_REQUIRED');
 const archive=await createArchive(values['source-root']);await fs.writeFile(values.backup,archive.bytes,{flag:'wx',mode:0o600});
 await restoreArchive({bytes:await fs.readFile(values.backup),expectedSha256:archive.sha256,root:values['restore-root']});
 const roundtrip=await createArchive(values['restore-root']);if(roundtrip.sha256!==archive.sha256)throw new Error('BACKUP_ROUNDTRIP_MISMATCH');
 const rebuilt=await invoke('--rebuild','--root',values['restore-root']);
 const after=await invoke('--root',values['restore-root'],'--query',values.query);
 const identity=hits=>hits.map(hit=>({id:hit.evidence_id,source:hit.source_ref,revision:hit.source_revision,sha256:hash(Buffer.from(hit.content))}));
 if(after.status!=='ok'||JSON.stringify(identity(before.evidence))!==JSON.stringify(identity(after.evidence)))throw new Error('RESTORED_RECALL_MISMATCH');
 return {status:'verified-local-native-fixture',archive_sha256:archive.sha256,restored_archive_sha256:roundtrip.sha256,file_count:archive.file_count,
  source_bytes:archive.source_bytes,source_sha256:rebuilt.source_sha256,mode:rebuilt.mode,restored_generation:rebuilt.receipt.generation,
  evidence:identity(after.evidence),personal_backup_acceptance:'blocked-consent-encryption-owner-key-custody'};
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{console.error('NATIVE_RECOVERY_FAILED');process.exitCode=1});
module.exports={createArchive,restoreArchive};

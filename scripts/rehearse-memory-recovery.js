'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {importPersonalArchive,exportPersonalArchive}=require('../modules/context-store/src/personal-archive');
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const sha=data=>'sha256:'+createHash('sha256').update(data).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function collect(stream){
 const parts=[];let length=0;
 for await(const part of stream){const buf=Buffer.from(part);length+=buf.length;
  if(length>16*1024*1024)throw Error('RECOVERY_ARCHIVE_TOO_LARGE');parts.push(buf)}
 return Buffer.concat(parts);
}
async function rehearseRecovery({exportPath,emptyStore,fixtures}={}){
 if(typeof exportPath!=='string'||!path.isAbsolute(exportPath)||
    !emptyStore||typeof emptyStore.listAll!=='function'||typeof emptyStore.listActive!=='function'||
    typeof emptyStore.appendOrTombstone!=='function'||!fixtures||!DIGEST.test(fixtures.expected_sha256||'')||
    !Array.isArray(fixtures.expected_ids)||!Array.isArray(fixtures.expected_active_ids)||
    fixtures.expected_ids.some(x=>typeof x!=='string')||fixtures.expected_active_ids.some(x=>typeof x!=='string'))
  throw Error('RECOVERY_INPUT_INVALID');
 const stat=await fs.lstat(exportPath);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)
  throw Error('RECOVERY_UNSAFE_ARCHIVE');
 const original=await fs.readFile(exportPath);
 if(sha(original)!==fixtures.expected_sha256)throw Error('RECOVERY_DIGEST_MISMATCH');
 if((await emptyStore.listAll()).length!==0)throw Error('RECOVERY_STORE_NOT_EMPTY');
 const expectedIds=[...fixtures.expected_ids].sort(),expectedActive=[...fixtures.expected_active_ids].sort();
 if(new Set(expectedIds).size!==expectedIds.length||new Set(expectedActive).size!==expectedActive.length||
    expectedActive.some(id=>!expectedIds.includes(id)))throw Error('RECOVERY_FIXTURE_INVALID');
 const result=await importPersonalArchive({stream:Readable.from([original]),ledger:emptyStore,dryRun:false,ownerApproved:true});
 const actualIds=(await emptyStore.listAll()).map(x=>x.event_id).sort();
 const actualActive=(await emptyStore.listActive()).map(x=>x.event_id).sort();
 if(!equal(actualIds,expectedIds)||!equal(actualActive,expectedActive)||
   result.total!==expectedIds.length)throw Error('RECOVERY_READBACK_MISMATCH');
 const reconstructed=await collect(await exportPersonalArchive({ledger:emptyStore}));
 if(!reconstructed.equals(original))throw Error('RECOVERY_ROUNDTRIP_MISMATCH');
 return Object.freeze({verified:true,receipt:Object.freeze({
  environment:'offline_fixture',restored_count:result.imported,replayed_count:result.replayed,
  archive_sha256:sha(original),restore_sha256:sha(reconstructed),
  status:'offline_recovery_verified_not_live'})});
}
module.exports={rehearseRecovery};
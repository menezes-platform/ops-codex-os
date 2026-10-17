'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {createDrivePersonalStore}=require('../modules/context-store/src/drive-personal-store');
const {createPersonalEventLedger}=require('../modules/context-store/src/personal-event-ledger');
const {exportPersonalArchive}=require('../modules/context-store/src/personal-archive');
const {rehearseRecovery}=require('../scripts/rehearse-memory-recovery');
const sha=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
async function ledger(root){
 const transport=await createLocalCorpusObjectTransport({root});
 return createPersonalEventLedger({store:createDrivePersonalStore({transport})});
}
test('task_41_contract fresh offline restore retains event identity, tombstones and digest',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rag-final-rehearsal-'));
 try{
  const source=await ledger(path.join(dir,'source'));
  const content='Synthetic test record, no personal content';
  const original={schema_version:1,event_id:'e1',scope:'personal/current',kind:'observation',
   source_type:'manual',source_ref:'manual:e1',source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',
   content,content_sha256:sha(content),consent_receipt_id:'consent-test'};
  await source.appendOrTombstone({op:'append',event:original,idempotency_key:'a-e1'});
  await source.appendOrTombstone({op:'tombstone',event_id:'del-e1',target_event_id:'e1',
   consent_receipt_id:'consent-test',observed_at:'2026-10-15T19:00:00Z',idempotency_key:'del-e1'});
  const archive=path.join(dir,'export.jsonl');
  const chunks=[];
  for await(const piece of await exportPersonalArchive({ledger:source}))chunks.push(Buffer.from(piece));
  await fs.writeFile(archive,Buffer.concat(chunks));
  const originalBytes=await fs.readFile(archive);
  const dest=await ledger(path.join(dir,'empty'));
  const result=await rehearseRecovery({exportPath:archive,emptyStore:dest,fixtures:{
    expected_sha256:sha(originalBytes),expected_ids:['e1','del-e1'],expected_active_ids:[]}});
  assert.equal(result.verified,true);
  assert.equal(result.receipt.environment,'offline_fixture');
  assert.equal(result.receipt.restored_count,2);
  assert.deepEqual((await dest.listAll()).map(x=>x.event_id).sort(),['del-e1','e1']);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('task_41_contract tampered source prevents restore',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rag-final-rehearsal-'));
 try{
  const file=path.join(dir,'corrupt.jsonl');await fs.writeFile(file,'tampered');
  const dest=await ledger(path.join(dir,'empty'));
  await assert.rejects(rehearseRecovery({exportPath:file,emptyStore:dest,fixtures:{
   expected_sha256:'sha256:'+'a'.repeat(64),expected_ids:[],expected_active_ids:[]}}),/RECOVERY_DIGEST_MISMATCH/);
  assert.deepEqual(await dest.listAll(),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
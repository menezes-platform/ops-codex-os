'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {createDrivePersonalStore}=require('../modules/context-store/src/drive-personal-store');
const {createPersonalEventLedger}=require('../modules/context-store/src/personal-event-ledger');
test('offline personal events persist through a new filesystem-backed process instance',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rag-final-personal-'));
 try {
  const t1=await createLocalCorpusObjectTransport({root});
  const ledger1=createPersonalEventLedger({store:createDrivePersonalStore({transport:t1})});
  const content='Synthetic private memory with no real identifiers';
  const event={event_id:'local-e1',scope:'personal/current',kind:'observation',
   source_type:'manual',source_ref:'manual:test',source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',
   content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),content,
   consent_receipt_id:'consent-test',schema_version:1};
  assert.equal((await ledger1.appendOrTombstone({op:'append',event,idempotency_key:'write-e1'})).status,'stored');
  const t2=await createLocalCorpusObjectTransport({root});
  const ledger2=createPersonalEventLedger({store:createDrivePersonalStore({transport:t2})});
  assert.deepEqual((await ledger2.listActive()).map(x=>x.content),[content]);
 } finally {await fs.rm(root,{recursive:true,force:true})}
});
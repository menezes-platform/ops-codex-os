'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {runControlledRecallSmoke}=require('../scripts/run-rag-final-recall-smoke');
function event(id, content) {
 return {event_id:id,scope:'personal/current',kind:'decision',source_type:'manual',source_ref:'manual:'+id,
 source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',consent_receipt_id:'consent1',schema_version:1,
 content,content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex')};
}
test('task_34_contract rebuilds an actual lexical index from persisted events and answers once with evidence',async()=>{
 const records=[event('old','The chosen memory authority is Google Drive'),event('unrelated','The garden has sunflowers')];
 const receipt=await runControlledRecallSmoke({driveFixture:{async listEvents(){return records;}},indexFixture:{query:'memory authority',allowedScope:'personal/current'}});
 assert.equal(receipt.status,'ok');assert.equal(receipt.evidence_count,1);
 assert.equal(receipt.index_backend,'local-bm25-only');assert.equal('content' in receipt,false);
});
test('task_34_contract refuses cross-scope evidence and degrades on missing archive',async()=>{
 await assert.rejects(runControlledRecallSmoke({driveFixture:{async listEvents(){return [event('ok','memory authority')]}},indexFixture:{query:'memory authority',allowedScope:'project/foreign/repo'}}),/SCOPE_DENIED/);
 const result=await runControlledRecallSmoke({driveFixture:{async listEvents(){throw Error('Drive offline')}},indexFixture:{query:'what did we decide',allowedScope:'personal/current'}});
 assert.equal(result.status,'unavailable');assert.equal(result.evidence_count,0);
});

'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {buildEvidenceRef}=require('../modules/context-store/src/personal-provenance');
const content='Synthetic fact candidate';
const event=()=>({event_id:'event-a',scope:'personal/current',kind:'decision',source_type:'manual',source_ref:'manual:event-a',source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),content,consent_receipt_id:'owner-c1',schema_version:1});
const manifest={scope:'personal/current',revision:'r1',generation_id:'generation-1'};
test('task_20_contract provenance graph binds immutable identity, revision and receipt',()=>{
 const ref=buildEvidenceRef(event(),manifest);
 assert.equal(ref.evidence_id,'event-a');assert.equal(ref.source_revision,'r1');
 assert.equal(ref.consent_receipt_id,'owner-c1');assert.equal(ref.generation_id,'generation-1');
 assert.equal(ref.content_sha256,event().content_sha256);
 assert(Object.isFrozen(ref));
});
test('task_20_contract forged hash, missing consent or revision mismatch fails closed',()=>{
 assert.throws(()=>buildEvidenceRef({...event(),content_sha256:'sha256:'+'0'.repeat(64)},manifest));
 assert.throws(()=>buildEvidenceRef({...event(),consent_receipt_id:''},manifest));
 assert.throws(()=>buildEvidenceRef(event(),{...manifest,revision:'r2'}),/REVISION_MISMATCH/);
});
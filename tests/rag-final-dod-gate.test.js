'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyRagFinalDoD,REQUIRED_GATES}=require('../scripts/verify-rag-final-dod');
test('task_42_contract blocks every absent live E2E gate',()=>{
 const blocked=verifyRagFinalDoD({});
 assert.equal(blocked.status,'blocked');
 for(const name of ['drive_authenticated_smoke','owner_consent','engram_off_recall','cross_scope_isolation','rollback_drill',
  'rust_faiss_bm25','android_device_smoke','p05_formal_exit']) assert(blocked.failedChecks.includes(name),name);
 assert.equal(blocked.failedChecks.length,REQUIRED_GATES.length);
});
test('task_42_contract synthetic or unpinned receipts are not live acceptance',()=>{
 const fake=Object.fromEntries(REQUIRED_GATES.map(name=>[name,{verified:true,proof:'PASS'}]));
 assert.equal(verifyRagFinalDoD(fake).status,'blocked');
 const digest='sha256:'+'a'.repeat(64);
 const selfClaim=Object.fromEntries(REQUIRED_GATES.map(name=>[name,{verified:true,source:'synthetic',receipt_sha256:digest,scope:'rag-final',checked_at:'2026-10-15T18:00:00Z'}]));
 assert.equal(verifyRagFinalDoD(selfClaim).status,'blocked');
});
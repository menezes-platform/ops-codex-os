'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {resolveConflicts}=require('../modules/context-gateway/src/temporal-conflicts');
test('task_22_contract verified correction supersedes older episode preserving counterevidence',()=>{
 const old={evidence_id:'e1',claim_key:'preference-1',content:'Old synthetic preference',kind:'observation',observed_at:'2026-10-10T10:00:00Z',authority:'drive-episodic'};
 const correction={evidence_id:'e2',claim_key:'preference-1',content:'Updated synthetic preference',kind:'correction',corrects_event_id:'e1',verified_correction:true,observed_at:'2026-10-15T10:00:00Z',authority:'drive-episodic'};
 const r=resolveConflicts([old,correction]);
 assert.deepEqual(r.current.map(x=>x.evidence_id),['e2']);
 assert.deepEqual(r.counterevidence.map(x=>x.evidence_id),['e1']);
 assert.equal(r.uncertainty,false);
});
test('task_22_contract conflicting unverified claims are marked uncertain, never erased',()=>{
 const a={evidence_id:'e1',claim_key:'preference-1',kind:'observation',observed_at:'2026-10-10T10:00:00Z',authority:'drive-episodic'};
 const b={evidence_id:'e2',claim_key:'preference-1',kind:'observation',observed_at:'2026-10-15T10:00:00Z',authority:'drive-episodic'};
 const r=resolveConflicts([a,b]);assert.equal(r.uncertainty,true);assert.equal(r.counterevidence.length,1);
 assert.throws(()=>resolveConflicts([{...a,claim_key:''}]));
});
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {validateRecallEvidence}=require('../modules/context-gateway/src/recall-evidence');
const digest=s=>'sha256:'+createHash('sha256').update(s).digest('hex');
const manifest={scope:'personal/current',generation_id:'g1',revision:'r2'};
const hit=(revision='r2')=>({evidence_id:'e1',scope:'personal/current',source_ref:'manual:1',source_revision:revision,
 observed_at:'2026-10-15T18:00:00Z',generation_id:'g1',content:'A synthetic note',
 content_sha256:digest('A synthetic note'),retrieval_method:'bm25'});
test('task_29_contract validates scoped evidence and marks old revisions stale',()=>{
 const current=validateRecallEvidence({hits:[hit()],manifest,sourceAuthority:'drive-episodic'});
 assert.equal(current[0].current_state,'current');
 const older=validateRecallEvidence({hits:[hit('r1')],manifest,sourceAuthority:'drive-episodic'});
 assert.equal(older[0].current_state,'superseded');
});
test('task_29_contract rejects foreign scope, invalid date and wrong digest',()=>{
 assert.throws(()=>validateRecallEvidence({hits:[{...hit(),scope:'project/foreign/repo'}],manifest,sourceAuthority:'drive-episodic'}));
 assert.throws(()=>validateRecallEvidence({hits:[{...hit(),observed_at:'not-a-date'}],manifest,sourceAuthority:'drive-episodic'}));
 assert.throws(()=>validateRecallEvidence({hits:[{...hit(),content_sha256:digest('forged')}],manifest,sourceAuthority:'drive-episodic'}));
 assert.throws(()=>validateRecallEvidence({hits:[{...hit(),generation_id:'other'}],manifest,sourceAuthority:'drive-episodic'}));
});
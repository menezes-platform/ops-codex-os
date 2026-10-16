'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {preparePromotionCandidate}=require('../modules/context-gateway/src/personal-promotion');
test('task_21_contract drafts need explicit review and never write personal Git Memory',()=>{
 const candidate=preparePromotionCandidate({evidence_id:'e1',source_ref:'manual:e1',content:'Synthetic long-term preference',current_state:'current',authority:'drive-episodic'});
 assert.equal(candidate.requiresReview,true);
 assert.equal(candidate.targetAuthority,'menezesx2k26-byte/Memory');
 assert.equal(candidate.draft,'Synthetic long-term preference');
 assert.equal(candidate.status,'candidate_only');
 assert(!('write' in candidate));
 assert.throws(()=>preparePromotionCandidate({content:'',source_ref:'unknown'}));
 assert.throws(()=>preparePromotionCandidate({content:'No source',source_ref:''}));
});
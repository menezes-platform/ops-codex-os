'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolvePersonalScope}=require('../modules/context-store/src/personal-scope');
test('task_14_contract obtains personal scope from authenticated runtime only',()=>{
 assert.equal(resolvePersonalScope({verifiedOwner:{verified:true,principal_id:'owner-123'},source:'runtime'}),'personal/current');
 assert.throws(()=>resolvePersonalScope({verifiedOwner:{verified:false,principal_id:'owner-123'},source:'runtime'}));
 assert.throws(()=>resolvePersonalScope({verifiedOwner:{verified:true,principal_id:'owner-123'},source:'model'}));
 assert.throws(()=>resolvePersonalScope({verifiedOwner:{verified:true,principal_id:'owner-123',requested_scope:'project/a/b'},source:'runtime'}));
 assert.throws(()=>resolvePersonalScope({verifiedOwner:true,source:'runtime'}));
});
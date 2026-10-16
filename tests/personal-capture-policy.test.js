'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessCapture } = require('../modules/context-gateway/src/personal-capture-policy');
const grant = { active:true,receipt_id:'consent-1',source_type:'manual',scope:'personal/current' };
test('task_13_contract is default deny and needs source-specific consent', () => {
 assert.deepEqual(assessCapture({sourceType:'manual',content:'hello'}),{allowed:false,reason:'CONSENT_REQUIRED'});
 assert.equal(assessCapture({sourceType:'manual',consentReceipt:{...grant,active:false},content:'hello'}).allowed,false);
 assert.equal(assessCapture({sourceType:'terminal',consentReceipt:grant,content:'hello'}).allowed,false);
 assert.equal(assessCapture({sourceType:'banking',consentReceipt:{...grant,source_type:'banking'},content:'hello'}).reason,'SENSITIVE_SOURCE');
});
test('task_13_contract denies credentials and leaves no sensitive data in result', () => {
 const secret = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456';
 const result=assessCapture({sourceType:'manual',consentReceipt:grant,content:secret});
 assert.deepEqual(result,{allowed:false,reason:'SECRET_DETECTED'});
 const allowed=assessCapture({sourceType:'manual',consentReceipt:grant,content:'An ordinary synthetic note'});
 assert.equal(allowed.allowed,true);
 assert.equal(allowed.content,'An ordinary synthetic note');
});
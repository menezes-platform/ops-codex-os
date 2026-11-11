'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideRecall } = require('../modules/context-gateway/src/recall-trigger-policy');

test('ambiguous domain cannot silently fetch unrelated project memory', () => {
 const r=decideRecall({userIntent:{text:'Qual deles faz isso?',domain:'automation'},historyReferences:true,availableScopes:['project/owner/projecta','personal/current']});
 assert.equal(r.required,true);assert.deepEqual(r.lanes,[]);assert.equal(r.reason,'SCOPE_UNAVAILABLE');
});
test('multiple project candidates require an explicit trusted target',()=>{
 const r=decideRecall({userIntent:{text:'What did we decide last time?',domain:'project'},availableScopes:['project/owner/projecta','project/owner/projectb']});
 assert.deepEqual(r.lanes,[]);
});
test('an explicit existing project scope is selected without leaking to first project',()=>{
 const r=decideRecall({userIntent:{text:'remember',domain:'project',projectScope:'project/owner/projectb'},availableScopes:['project/owner/projecta','project/owner/projectb'],historyReferences:true});
 assert.deepEqual(r.lanes,['project/owner/projectb']);
});
test('a context-dependent follow-up must recall its personal context first',()=>{
 const r=decideRecall({userIntent:{text:'Qual deles faz o que o COS faz?',domain:'personal',contextDependent:true},availableScopes:['personal/current','project/owner/projecta']});
 assert.equal(r.required,true);assert.deepEqual(r.lanes,['personal/current']);
});
test('irrelevant arithmetic must not access personal memory',()=>{
 const r=decideRecall({userIntent:{text:'2+2',domain:'math'},availableScopes:['personal/current']});
 assert.equal(r.required,false);assert.deepEqual(r.lanes,[]);
});

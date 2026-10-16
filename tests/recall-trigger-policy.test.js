'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {decideRecall}=require('../modules/context-gateway/src/recall-trigger-policy');
test('task_27_contract enforces history recall but avoids irrelevant personal access',()=>{
 const past=decideRecall({userIntent:{text:'What did we decide last time?',domain:'project'},
  availableScopes:['project/menezes-platform/ops-codex-os','personal/current'],historyReferences:true});
 assert.equal(past.required,true);assert.deepEqual(past.lanes,['project/menezes-platform/ops-codex-os']);
 const trivial=decideRecall({userIntent:{text:'2+2',domain:'math'},availableScopes:['personal/current'],historyReferences:false});
 assert.equal(trivial.required,false);assert.deepEqual(trivial.lanes,[]);
 const missing=decideRecall({userIntent:{text:'as we decided before',domain:'personal'},availableScopes:[]});
 assert.equal(missing.required,true);assert.deepEqual(missing.lanes,[]);
});
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPersonalRecall} = require('../modules/context-gateway/src/personal-recall');

function fixture() {
  const requests = [];
  const recall = createPersonalRecall({
    ownerResolver: async () => ({verified: true, principal_id: 'owner-123'}),
    executionPlaneClient: {
      async retrieve(input) {
        requests.push(input);
        return {status:'miss',evidence:[]};
      }
    }
  });
  return {recall,requests};
}

test('B25 boundary refuses dates which parse but do not exist', async () => {
  const {recall,requests}=fixture();
  await assert.rejects(recall.recall({query:'history',filters:{after:'2026-02-30T00:00:00Z'}}),/FILTERS_INVALID/);
  assert.equal(requests.length,0);
});
test('B25 boundary refuses a time range with after later than before', async () => {
  const {recall,requests}=fixture();
  await assert.rejects(recall.recall({query:'history',filters:{
    after:'2026-10-20T00:00:00Z',before:'2026-10-18T00:00:00Z'
  }}),/FILTERS_INVALID/);
  assert.equal(requests.length,0);
});
test('B25 boundary orders UTC seconds and fractional timestamps chronologically',async()=>{
  const {recall,requests}=fixture();
  await recall.recall({query:'history',filters:{
    after:'2026-10-18T00:00:00Z',before:'2026-10-18T00:00:00.100Z'
  }});
  assert.equal(requests.length,1);
  await assert.rejects(recall.recall({query:'history',filters:{
    after:'2026-10-18T00:00:00.100Z',before:'2026-10-18T00:00:00Z'
  }}),/FILTERS_INVALID/);
  assert.equal(requests.length,1);
});
test('B25 boundary denies foreign and nonarray source filters before accessing owner data',async()=>{
  const {recall,requests}=fixture();
  await assert.rejects(recall.recall({query:'history',filters:{source_types:'chat'}}),/FILTERS_INVALID/);
  await assert.rejects(recall.recall({query:'history',filters:{source_types:['chat','foreign']}}),/FILTERS_INVALID/);
  assert.equal(requests.length,0);
});
test('B25 boundary rejects control characters and unexpected types in revision and times',async()=>{
  const {recall,requests}=fixture();
  await assert.rejects(recall.recall({query:'history',filters:{revision:'v1\nforged'}}),/FILTERS_INVALID/);
  await assert.rejects(recall.recall({query:'history',filters:{after:12345}}),/FILTERS_INVALID/);
  assert.equal(requests.length,0);
});
test('B25 boundary forwards only valid bounded trusted filters without letting model choose scope',async()=>{
  const {recall,requests}=fixture();
  await recall.recall({query:'history',filters:{
    source_types:['manual','chat'],revision:'r2',
    after:'2026-10-18T00:00:00Z', before:'2026-10-20T00:00:00Z'
  }});
  assert.equal(requests.length,1);
  assert.equal(requests[0].scope,'personal/current');
  assert.deepEqual(requests[0].filters.source_types,['manual','chat']);
});


'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {classifyMemoryEvent}=require('../modules/context-gateway/src/personal-event-classifier');
const event=(kind,source_type)=>{const content='Synthetic note';return {event_id:'e1',scope:'personal/current',kind,source_type,source_ref:'manual:e1',source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),content,consent_receipt_id:'c1',schema_version:1}};
test('task_19_contract no transient chatter or unverified speculation becomes canonical truth',()=>{
 assert.deepEqual(classifyMemoryEvent(event('observation','chat')),{class:'excluded',reason:'TRANSIENT_CHAT'});
 assert.deepEqual(classifyMemoryEvent(event('observation','manual')),{class:'episode',reason:'NONCANONICAL_EPISODE'});
 assert.deepEqual(classifyMemoryEvent(event('decision','manual')),{class:'candidate',reason:'REQUIRES_OWNER_REVIEW'});
 assert.equal(classifyMemoryEvent(event('tombstone','manual')).class,'excluded');
 assert.equal(classifyMemoryEvent({...event('observation','manual'),content_sha256:'sha256:'+'0'.repeat(64)}).class,'excluded');
});
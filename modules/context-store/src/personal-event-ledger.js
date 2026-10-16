'use strict';
const {createHash}=require('node:crypto');
const {normalizeMemoryEvent}=require('./personal-event-schema');
function createPersonalEventLedger({store}={}) {
 if (!store || typeof store.putEvent!=='function' || typeof store.listEvents!=='function')
   throw new Error('PERSONAL_LEDGER_STORE_REQUIRED');
 async function listActive() {
  const events=await store.listEvents();
  const deleted=new Set(events.filter(event=>event.kind==='tombstone').map(event=>event.content));
  return events.filter(event=>event.kind!=='tombstone' && !deleted.has(event.event_id));
 }
 async function appendOrTombstone(command) {
  if (!command || typeof command!=='object' || Array.isArray(command))
    throw new Error('PERSONAL_COMMAND_INVALID');
  if (command.op==='append') {
   const event=normalizeMemoryEvent(command.event);
   const events=await store.listEvents();
   if (events.some(item=>item.kind==='tombstone' && item.content===event.event_id))
     throw new Error('EVENT_TOMBSTONED');
   return store.putEvent({event,idempotency_key:command.idempotency_key});
  }
  if (command.op==='tombstone') {
   const {target_event_id,event_id,consent_receipt_id,observed_at,idempotency_key}=command;
   if (![target_event_id,event_id,consent_receipt_id,observed_at,idempotency_key].every(x=>typeof x==='string'&&x.trim()) ||
       target_event_id===event_id) throw new Error('TOMBSTONE_INVALID');
   const all=await store.listEvents();
   if (!all.some(e=>e.event_id===target_event_id && e.kind!=='tombstone'))
     throw new Error('TARGET_EVENT_UNAVAILABLE');
   const content=target_event_id;
   const event=normalizeMemoryEvent({
    event_id,scope:'personal/current',kind:'tombstone',source_type:'manual',
    source_ref:'tombstone:'+target_event_id,source_revision:'r1',observed_at,
    content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),
    content,consent_receipt_id,schema_version:1
   });
   return store.putEvent({event,idempotency_key});
  }
  throw new Error('PERSONAL_COMMAND_INVALID');
 }
 return Object.freeze({appendOrTombstone,listActive,listAll:()=>store.listEvents()});
}
module.exports={createPersonalEventLedger};
'use strict';
const {createHash}=require('node:crypto');
const {normalizeMemoryEvent}=require('./personal-event-schema');
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const keys = {
 event:id=>'personal/current/events/'+hash(Buffer.from(id,'utf8')).slice(7)+'.json',
 receipt:key=>'personal/current/receipts/'+hash(Buffer.from(key,'utf8')).slice(7)+'.json',
};
const ORDER=['event_id','scope','kind','source_type','source_ref','source_revision','observed_at',
  'content_sha256','content','consent_receipt_id','schema_version'];
function createDrivePersonalStore({transport}={}) {
 if (!transport || typeof transport.getObject!=='function' ||
     typeof transport.putObjectIfAbsent!=='function') throw new Error('PERSONAL_TRANSPORT_REQUIRED');
 async function read(key) {
  let value;
  try {value=await transport.getObject({key});}
  catch {throw new Error('PERSONAL_OBJECT_UNAVAILABLE');}
  if (value==null) return null;
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new Error('PERSONAL_OBJECT_INVALID');
  return Buffer.from(value);
 }
 async function putVerified(key,bytes) {
  try {await transport.putObjectIfAbsent({key,content:bytes});}
  catch {throw new Error('PERSONAL_OBJECT_UNAVAILABLE');}
  const actual=await read(key);
  if (!actual || !actual.equals(bytes)) throw new Error('PERSONAL_OBJECT_DIGEST_MISMATCH');
 }
 async function readEvent({event_id}={}) {
  if (typeof event_id!=='string' || !event_id.trim() || event_id.length>2048) throw new Error('EVENT_ID_INVALID');
  const bytes=await read(keys.event(event_id));
  if (!bytes) return null;
  let parsed;
  try { parsed=normalizeMemoryEvent(JSON.parse(bytes.toString('utf8'))); }
  catch { throw new Error('PERSONAL_OBJECT_INVALID'); }
  if (parsed.event_id!==event_id) throw new Error('PERSONAL_OBJECT_INVALID');
  const canonical=Buffer.from(JSON.stringify(Object.fromEntries(ORDER.map(field=>[field,parsed[field]]))),'utf8');
  if (!canonical.equals(bytes)) throw new Error('PERSONAL_OBJECT_DIGEST_MISMATCH');
  return parsed;
 }
 async function putEvent({event,idempotency_key}={}) {
  const checked=normalizeMemoryEvent(event);
  if (typeof idempotency_key!=='string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotency_key))
    throw new Error('IDEMPOTENCY_KEY_INVALID');
  const bytes=Buffer.from(JSON.stringify(Object.fromEntries(ORDER.map(field=>[field,checked[field]]))),'utf8');
  const manifest_ref=hash(bytes);
  const receiptKey=keys.receipt(idempotency_key), eventKey=keys.event(checked.event_id);
  const receiptFields={scope:checked.scope,event_id:checked.event_id,content_sha256:checked.content_sha256,
    manifest_ref,observed_at:checked.observed_at};
  const existingReceipt=await read(receiptKey);
  if (existingReceipt) {
   let prior;
   try {prior=JSON.parse(existingReceipt.toString('utf8'));}
   catch {throw new Error('PERSONAL_RECEIPT_INVALID');}
   if (Object.keys(prior).length!==Object.keys(receiptFields).length ||
       Object.entries(receiptFields).some(([k,v])=>prior[k]!==v))
       throw new Error('IDEMPOTENCY_CONFLICT');
   const stored=await read(eventKey);
   if (!stored || !stored.equals(bytes)) throw new Error('PERSONAL_OBJECT_DIGEST_MISMATCH');
   return Object.freeze({...receiptFields,status:'replayed'});
  }
  const priorEvent=await read(eventKey);
  if (priorEvent && !priorEvent.equals(bytes)) throw new Error('EVENT_CONFLICT');
  await putVerified(eventKey,bytes);
  await putVerified(receiptKey,Buffer.from(JSON.stringify(receiptFields),'utf8'));
  return Object.freeze({...receiptFields,status:'stored'});
 }
 async function listEvents() {
  if (typeof transport.listObjectKeys !== 'function') throw new Error('PERSONAL_LIST_UNAVAILABLE');
  let listed;
  try {listed=await transport.listObjectKeys({prefix:'personal/current/events/'});}
  catch {throw new Error('PERSONAL_LIST_UNAVAILABLE');}
  if (!Array.isArray(listed) || listed.length>10000 ||
      listed.some(key => typeof key!=='string' || !/^personal\/current\/events\/[a-f0-9]{64}\.json$/.test(key)) ||
      new Set(listed).size !== listed.length) throw new Error('PERSONAL_LIST_INVALID');
  const result=[];
  for (const key of listed.sort()) {
   const bytes=await read(key);
   if (!bytes) throw new Error('PERSONAL_OBJECT_UNAVAILABLE');
   let parsed;
   try {parsed=normalizeMemoryEvent(JSON.parse(bytes.toString('utf8')));}
   catch {throw new Error('PERSONAL_OBJECT_INVALID');}
   if (keys.event(parsed.event_id)!==key) throw new Error('PERSONAL_OBJECT_INVALID');
   const canonical=Buffer.from(JSON.stringify(Object.fromEntries(ORDER.map(field=>[field,parsed[field]]))),'utf8');
   if (!canonical.equals(bytes)) throw new Error('PERSONAL_OBJECT_DIGEST_MISMATCH');
   result.push(parsed);
  }
  return result.sort((a,b)=>a.observed_at.localeCompare(b.observed_at)||a.event_id.localeCompare(b.event_id));
 } return Object.freeze({putEvent,readEvent,listEvents});
}
module.exports={createDrivePersonalStore};
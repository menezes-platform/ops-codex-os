'use strict';
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {normalizeMemoryEvent}=require('./personal-event-schema');
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const FORMAT='rag-personal-archive-v1';
const MAX_BYTES=16*1024*1024;
function mustLedger(ledger) {
 if (!ledger || typeof ledger.listAll!=='function' || typeof ledger.appendOrTombstone!=='function')
   throw new Error('ARCHIVE_LEDGER_REQUIRED');
}
async function exportPersonalArchive({ledger}={}) {
 mustLedger(ledger);
 const events=await ledger.listAll();
 if (!Array.isArray(events) || events.length>10000) throw new Error('ARCHIVE_TOO_LARGE');
 const records=events.map(value=>{
  const event=normalizeMemoryEvent(value);
  return JSON.stringify({type:'event',sha256:sha(JSON.stringify(event)),event})+'\n';
 });
 const aggregate=sha(records.join(''));
 const manifest=JSON.stringify({type:'manifest',format:FORMAT,count:records.length,root_sha256:aggregate})+'\n';
 return Readable.from([manifest,...records]);
}
async function readArchive(stream) {
 if (!stream || typeof stream[Symbol.asyncIterator]!=='function') throw new Error('ARCHIVE_STREAM_REQUIRED');
 let data='',size=0;
 for await (const part of stream) {
  const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);
  size+=bytes.length;
  if (size>MAX_BYTES) throw new Error('ARCHIVE_TOO_LARGE');
  data+=bytes.toString('utf8');
 }
 if (!data.endsWith('\n')) throw new Error('ARCHIVE_TRUNCATED');
 const lines=data.trimEnd().split('\n');
 if (lines.length>10001 || lines.length<1) throw new Error('ARCHIVE_INVALID');
 let manifest;
 try {manifest=JSON.parse(lines.shift());}
 catch {throw new Error('ARCHIVE_MANIFEST_INVALID');}
 if (!manifest || manifest.type!=='manifest' || manifest.format!==FORMAT ||
     !Number.isSafeInteger(manifest.count) || manifest.count!==lines.length ||
     Object.keys(manifest).length!==4 || manifest.root_sha256!==sha(lines.map(s=>s+'\n').join('')))
   throw new Error('ARCHIVE_DIGEST_MISMATCH');
 const ids=new Set(),events=[];
 for (const raw of lines) {
  let entry;
  try {entry=JSON.parse(raw);}
  catch {throw new Error('ARCHIVE_RECORD_INVALID');}
  if (!entry || Object.keys(entry).length!==3 || entry.type!=='event')
   throw new Error('ARCHIVE_RECORD_INVALID');
  let event;
  try {event=normalizeMemoryEvent(entry.event);}
  catch {throw new Error('ARCHIVE_RECORD_INVALID');}
  if (sha(JSON.stringify(event))!==entry.sha256 || ids.has(event.event_id))
   throw new Error('ARCHIVE_RECORD_DIGEST_MISMATCH');
  ids.add(event.event_id);
  events.push(event);
 }
 for (const event of events.filter(e=>e.kind==='tombstone')) {
  if (!ids.has(event.content) || event.event_id===event.content)
   throw new Error('ARCHIVE_TOMBSTONE_INVALID');
 }
 return events;
}
async function importPersonalArchive({stream,ledger,dryRun=true,ownerApproved=false}={}) {
 mustLedger(ledger);
 const events=await readArchive(stream); // validate ENTIRE archive before first write
 if (dryRun) return Object.freeze({status:'validated',total:events.length,imported:0});
 if (ownerApproved!==true) throw new Error('ARCHIVE_OWNER_APPROVAL_REQUIRED');
 // Apply original events first, tombstones last (idempotency-safe after partial outage).
 let imported=0,replayed=0;
 for (const event of [...events.filter(e=>e.kind!=='tombstone'),...events.filter(e=>e.kind==='tombstone')]) {
  const previouslyStored=(await ledger.listAll()).find(item=>item.event_id===event.event_id);
  if (previouslyStored) {
   if (JSON.stringify(previouslyStored)!==JSON.stringify(event)) throw new Error('ARCHIVE_EVENT_CONFLICT');
   replayed++; continue;
  }
  const idempotency_key='restore-'+sha(JSON.stringify(event)).slice(7);
  const command=event.kind==='tombstone'
    ? {op:'tombstone',event_id:event.event_id,target_event_id:event.content,
       consent_receipt_id:event.consent_receipt_id,observed_at:event.observed_at,idempotency_key}
    : {op:'append',event,idempotency_key};
  const result=await ledger.appendOrTombstone(command);
  if (result.status==='stored') imported++;
  else if (result.status==='replayed') replayed++;
  else throw new Error('ARCHIVE_WRITE_RECEIPT_INVALID');
 }
 return Object.freeze({status:'restored',total:events.length,imported,replayed});
}
module.exports={exportPersonalArchive,importPersonalArchive};
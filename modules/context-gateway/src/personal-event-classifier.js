'use strict';
const {normalizeMemoryEvent}=require('../../context-store/src/personal-event-schema');
function classifyMemoryEvent(raw) {
 let event;
 try {event=normalizeMemoryEvent(raw);}
 catch {return Object.freeze({class:'excluded',reason:'INVALID_UNVERIFIED_EVENT'});}
 if (event.kind==='tombstone') return Object.freeze({class:'excluded',reason:'ERASURE_MARKER'});
 if (event.source_type==='chat') return Object.freeze({class:'excluded',reason:'TRANSIENT_CHAT'});
 if (event.kind==='decision'||event.kind==='correction')
  return Object.freeze({class:'candidate',reason:'REQUIRES_OWNER_REVIEW'});
 return Object.freeze({class:'episode',reason:'NONCANONICAL_EPISODE'});
}
module.exports={classifyMemoryEvent};
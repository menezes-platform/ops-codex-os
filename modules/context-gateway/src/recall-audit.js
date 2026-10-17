'use strict';
const STATES=new Set(['ok','miss','unavailable','denied','stale','not_required']);
function recordRecallAudit({request,receipt}={}) {
 if (!receipt || !STATES.has(receipt.status)) throw new Error('AUDIT_STATUS_INVALID');
 const number=(n,max)=>Number.isInteger(n) && n>=0 && n<=max?n:0;
 return Object.freeze({event_type:'memory_recall',
  status:receipt.status,required:receipt.required===true,
  evidence_count:number(receipt.evidence_count,100),
  latency_ms:number(receipt.latency_ms,30000),
  generation_id:typeof receipt.generation_id==='string'&&/^[-A-Za-z0-9._:]{1,128}$/.test(receipt.generation_id)
    ?receipt.generation_id:null});
}
module.exports={recordRecallAudit};
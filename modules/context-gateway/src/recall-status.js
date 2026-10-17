'use strict';
const STATUSES=new Set(['ok','miss','unavailable','denied','stale']);
function normalizeRecallStatus({primary,secondary,policy={}}={}) {
 // Secondary episodic providers are candidates only; no automatic authority fallback.
 const state=primary && typeof primary==='object' && STATUSES.has(primary.status) ? primary.status : 'unavailable';
 const evidence=state==='ok' && Array.isArray(primary.evidence) && primary.evidence.length<=100 ?
   primary.evidence.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) : [];
 const status=state==='ok' ? (evidence.length?'ok':'miss') : state;
 const reason_code=status==='ok'?'EVIDENCE_VERIFIED':status==='miss'?'NO_EVIDENCE':
   status==='unavailable'?'SOURCE_UNAVAILABLE':status==='denied'?'ACCESS_DENIED':'SOURCE_STALE';
 return Object.freeze({status,evidence:status==='ok'?evidence:[],
  generation_id:primary&&typeof primary.generation_id==='string'?primary.generation_id:null,
  last_sync_at:primary&&typeof primary.last_sync_at==='string'?primary.last_sync_at:null,
  reason_code});
}
module.exports={normalizeRecallStatus};
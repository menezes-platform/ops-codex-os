'use strict';
// Conservative structural evidence gate. External readbacks/CI still required; a self-asserted JSON is not proof.
const REQUIRED_GATES=Object.freeze([
 'p03_formal_exit','p04_formal_exit','p05_formal_exit',
 'drive_authenticated_smoke','drive_change_cursor','owner_consent','engram_off_recall',
 'cross_scope_isolation','live_corpus_recall','rust_faiss_bm25',
 'index_current_previous','rollback_drill','backup_restore','secret_redaction',
 'android_debug_build','android_device_smoke','resource_budget','full_suites',
 'security_review','freshness_rollback','no_paid_service'
]);
const SOURCES=new Set(['github_ci','drive_readback','execution_primary','android_device','owner_recovery']);
function validReceipt(value) {
 return value && typeof value==='object' && !Array.isArray(value) && value.verified===true &&
  SOURCES.has(value.source) && value.scope==='rag-final' &&
  typeof value.checked_at==='string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value.checked_at) &&
  Number.isFinite(Date.parse(value.checked_at)) &&
  /^sha256:[a-f0-9]{64}$/.test(value.receipt_sha256||'');
}
function verifyRagFinalDoD(evidenceManifest={}) {
 if (!evidenceManifest || typeof evidenceManifest!=='object' || Array.isArray(evidenceManifest))
   return Object.freeze({status:'blocked',failedChecks:[...REQUIRED_GATES]});
 const failedChecks=REQUIRED_GATES.filter(key=>!validReceipt(evidenceManifest[key]));
 return Object.freeze({status:failedChecks.length===0?'passed':'blocked',failedChecks});
}
module.exports={verifyRagFinalDoD,REQUIRED_GATES};
'use strict';
const {normalizeMemoryEvent}=require('./personal-event-schema');
function buildEvidenceRef(raw,manifest) {
 const event=normalizeMemoryEvent(raw);
 if (!manifest || typeof manifest!=='object' || Array.isArray(manifest) ||
     manifest.scope!=='personal/current' || typeof manifest.revision!=='string' ||
     typeof manifest.generation_id!=='string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(manifest.generation_id))
   throw new Error('EVIDENCE_MANIFEST_INVALID');
 if (event.source_revision!==manifest.revision) throw new Error('EVIDENCE_REVISION_MISMATCH');
 return Object.freeze({
  evidence_id:event.event_id,scope:event.scope,kind:event.kind,source_type:event.source_type,
  source_ref:event.source_ref,source_revision:event.source_revision,observed_at:event.observed_at,
  generation_id:manifest.generation_id,consent_receipt_id:event.consent_receipt_id,
  content_sha256:event.content_sha256,content:event.content,authority:'drive-episodic',
  current_state:'current'
 });
}
module.exports={buildEvidenceRef};
'use strict';
function preparePromotionCandidate(evidence) {
 if (!evidence || typeof evidence!=='object' || Array.isArray(evidence) ||
     typeof evidence.evidence_id!=='string' || !evidence.evidence_id.trim() ||
     typeof evidence.source_ref!=='string' || !evidence.source_ref.trim() ||
     typeof evidence.content!=='string' || !evidence.content.trim() ||
     Buffer.byteLength(evidence.content,'utf8')>16384 ||
     evidence.current_state!=='current' || evidence.authority!=='drive-episodic')
   throw new Error('PERSONAL_PROMOTION_CANDIDATE_INVALID');
 return Object.freeze({draft:evidence.content,requiresReview:true,status:'candidate_only',
  targetAuthority:'menezesx2k26-byte/Memory',evidence_id:evidence.evidence_id,
  source_ref:evidence.source_ref});
}
module.exports={preparePromotionCandidate};
'use strict';
const {createHash}=require('node:crypto');
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const AUTHORITIES=new Set(['git','drive-episodic','memory']);
const METHODS=new Set(['bm25','faiss','hybrid','manual']);
function validateRecallEvidence({hits,manifest,sourceAuthority}={}) {
 if (!manifest || typeof manifest.scope!=='string' || !manifest.scope ||
     typeof manifest.revision!=='string' || !manifest.revision ||
     typeof manifest.generation_id!=='string' || !manifest.generation_id ||
     !AUTHORITIES.has(sourceAuthority) || !Array.isArray(hits) || hits.length>100)
   throw new Error('EVIDENCE_MANIFEST_INVALID');
 return Object.freeze(hits.map(hit=>{
  if (!hit || typeof hit!=='object' || hit.scope!==manifest.scope ||
      typeof hit.evidence_id!=='string' || !hit.evidence_id ||
      typeof hit.source_ref!=='string' || !hit.source_ref ||
      typeof hit.source_revision!=='string' || !hit.source_revision ||
      typeof hit.content!=='string' || Buffer.byteLength(hit.content,'utf8')>16384 ||
      !METHODS.has(hit.retrieval_method) || hit.generation_id!==manifest.generation_id ||
      typeof hit.observed_at!=='string' || !UTC.test(hit.observed_at) ||
      !Number.isFinite(Date.parse(hit.observed_at)) ||
      new Date(hit.observed_at).toISOString().slice(0,19)!==hit.observed_at.slice(0,19))
    throw new Error('EVIDENCE_INVALID');
  const digest='sha256:'+createHash('sha256').update(hit.content,'utf8').digest('hex');
  if (hit.content_sha256!==digest) throw new Error('EVIDENCE_DIGEST_MISMATCH');
  return Object.freeze({evidence_id:hit.evidence_id,scope:hit.scope,source_ref:hit.source_ref,
   source_revision:hit.source_revision,observed_at:hit.observed_at,
   current_state:hit.source_revision===manifest.revision?'current':'superseded',
   authority:sourceAuthority,content:hit.content,retrieval_method:hit.retrieval_method,
   generation_id:manifest.generation_id,content_sha256:digest});
 }));
}
module.exports={validateRecallEvidence};
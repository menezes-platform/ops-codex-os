'use strict';
const {resolvePersonalScope}=require('../../context-store/src/personal-scope');
const {normalizeRecallStatus}=require('./recall-status');
const {validateRecallEvidence}=require('./recall-evidence');
function createPersonalRecall({executionPlaneClient,ownerResolver}={}) {
 if (!executionPlaneClient || typeof executionPlaneClient.retrieve!=='function' ||
     typeof ownerResolver!=='function') throw new Error('PERSONAL_RECALL_ADAPTERS_REQUIRED');
 return Object.freeze({
  async recall(request) {
   if (!request || typeof request!=='object' || Array.isArray(request) ||
       Object.keys(request).some(key=>!['query','filters'].includes(key))) throw new Error('REQUEST_FIELD_INVALID');
   if (typeof request.query!=='string' || !request.query.trim() || request.query.length>16000)
     throw new Error('QUERY_INVALID');
   const filters=request.filters??{};
   if (!filters || typeof filters!=='object' || Array.isArray(filters) ||
       Object.keys(filters).some(key=>!['source_types','revision','after','before'].includes(key)))
     throw new Error('FILTERS_INVALID');
   const owner=await ownerResolver();
   const scope=resolvePersonalScope({verifiedOwner:owner,source:'runtime'});
   const raw=await executionPlaneClient.retrieve({scope,query:request.query,filters});
   if (raw && Array.isArray(raw.evidence)) {
    if (raw.evidence.length>100) throw new Error('EVIDENCE_LIMIT_EXCEEDED');
    for (const hit of raw.evidence) {
     if (!hit || hit.scope!==scope || hit.owner_principal_id!==owner.principal_id)
       throw new Error('FOREIGN_OWNER_EVIDENCE');
    }
   }
   const verified = raw && raw.status==='ok' && Array.isArray(raw.evidence) && raw.evidence.length
     ? {...raw,evidence:validateRecallEvidence({hits:raw.evidence,
        manifest:{scope,revision:raw.revision,generation_id:raw.generation_id},
        sourceAuthority:'drive-episodic'})} : raw;
   return normalizeRecallStatus({primary:verified,policy:{allowEngram:false}});
  }
 });
}
module.exports={createPersonalRecall};
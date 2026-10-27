'use strict';
const {resolvePersonalScope}=require('../../context-store/src/personal-scope');
const {normalizeRecallStatus}=require('./recall-status');
const {validateRecallEvidence}=require('./recall-evidence');
const FILTER_KEYS = new Set(['source_types','revision','after','before']);
const PERSONAL_SOURCE_TYPES = new Set(['manual','git','agent','android','chat']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function validUtc(value) {
 if (typeof value !== 'string' || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) return false;
 const normalized=new Date(value).toISOString();
 return normalized.slice(0,19)===value.slice(0,19);
}
function normalizePersonalFilters(raw={}) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
     Object.keys(raw).some(key=>!FILTER_KEYS.has(key))) throw new Error('FILTERS_INVALID');
 const filters={...raw};
 if (filters.source_types!==undefined) {
  if (!Array.isArray(filters.source_types) || filters.source_types.length>PERSONAL_SOURCE_TYPES.size ||
      filters.source_types.some(s=>typeof s!=='string' || !PERSONAL_SOURCE_TYPES.has(s)) ||
      new Set(filters.source_types).size!==filters.source_types.length) throw new Error('FILTERS_INVALID');
  filters.source_types=[...filters.source_types];
 }
 if (filters.revision!==undefined && (
   typeof filters.revision!=='string' || !filters.revision.trim() ||
   filters.revision!==filters.revision.trim() || !filters.revision.isWellFormed() ||
   Buffer.byteLength(filters.revision,'utf8')>500 ||
   /[\u0000-\u001f\u007f-\u009f]/u.test(filters.revision))) throw new Error('FILTERS_INVALID');
 for (const key of ['after','before']) {
  if (filters[key]!==undefined && !validUtc(filters[key])) throw new Error('FILTERS_INVALID');
 }
 if (filters.after && filters.before &&
     Date.parse(filters.after)>Date.parse(filters.before)) throw new Error('FILTERS_INVALID');
 return filters;
}
function createPersonalRecall({executionPlaneClient,ownerResolver}={}) {
 if (!executionPlaneClient || typeof executionPlaneClient.retrieve!=='function' ||
     typeof ownerResolver!=='function') throw new Error('PERSONAL_RECALL_ADAPTERS_REQUIRED');
 return Object.freeze({
  async recall(request) {
   if (!request || typeof request!=='object' || Array.isArray(request) ||
       Object.keys(request).some(key=>!['query','filters'].includes(key))) throw new Error('REQUEST_FIELD_INVALID');
   if (typeof request.query!=='string' || !request.query.trim() ||
       !request.query.isWellFormed() || Buffer.byteLength(request.query,'utf8')>4096 ||
       /[\u0000-\u001f\u007f-\u009f]/u.test(request.query))
     throw new Error('QUERY_INVALID');
   const filters=normalizePersonalFilters(request.filters??{});
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
module.exports={createPersonalRecall,normalizePersonalFilters};


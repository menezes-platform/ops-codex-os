'use strict';
const PRI={memory:3,git:2,'drive-episodic':1};
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function resolveConflicts(evidenceList) {
 if (!Array.isArray(evidenceList) || evidenceList.length>100) throw new Error('TEMPORAL_EVIDENCE_INVALID');
 const groups=new Map(),ids=new Set();
 for(const item of evidenceList){
  if (!item || typeof item!=='object' || Array.isArray(item) ||
      typeof item.evidence_id!=='string' || !/^[\w.:-]{1,200}$/.test(item.evidence_id) ||
      typeof item.claim_key!=='string' || !/^[\w.:-]{1,200}$/.test(item.claim_key) ||
      !PRI[item.authority] || typeof item.observed_at!=='string' || !UTC.test(item.observed_at) ||
      !Number.isFinite(Date.parse(item.observed_at)) ||
      new Date(item.observed_at).toISOString().slice(0,19)!==item.observed_at.slice(0,19) ||
      ids.has(item.evidence_id)) throw new Error('TEMPORAL_EVIDENCE_INVALID');
  ids.add(item.evidence_id);
  if (!groups.has(item.claim_key)) groups.set(item.claim_key,[]);
  groups.get(item.claim_key).push(item);
 }
 const current=[],counterevidence=[];let uncertainty=false;
 for(const group of groups.values()){
  const ranked=[...group].sort((a,b)=>
    PRI[b.authority]-PRI[a.authority] ||
    Number(b.kind==='correction'&&b.verified_correction===true)-
    Number(a.kind==='correction'&&a.verified_correction===true) ||
    b.observed_at.localeCompare(a.observed_at) || a.evidence_id.localeCompare(b.evidence_id));
  const candidate=ranked[0];
  const safeCorrection=candidate.kind==='correction' && candidate.verified_correction===true &&
      group.some(item=>item.evidence_id===candidate.corrects_event_id && item.evidence_id!==candidate.evidence_id);
  if (group.length>1 && !safeCorrection) uncertainty=true;
  current.push(candidate);counterevidence.push(...ranked.slice(1));
 }
 return Object.freeze({current:Object.freeze(current),counterevidence:Object.freeze(counterevidence),uncertainty});
}
module.exports={resolveConflicts};
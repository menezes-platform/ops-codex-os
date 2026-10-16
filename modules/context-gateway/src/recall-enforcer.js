'use strict';
const {decideRecall}=require('./recall-trigger-policy');
const {normalizeRecallStatus}=require('./recall-status');
const {sanitizeEvidenceForModel}=require('./evidence-sanitizer');
// Only controlled hosts can enforce this policy. Consumer ChatGPT cannot be forced to invoke Drive.
async function enforceRecall({intent,gateway,answerProducer}={}) {
 if (typeof answerProducer!=='function') throw new Error('ANSWER_PRODUCER_REQUIRED');
 const decision=decideRecall(intent);
 if (!decision.required) {
  const answer=await answerProducer({evidence:[],memoryStatus:'not_required'});
  return {answer,receipt:Object.freeze({required:false,status:'not_required',reason_code:'NOT_RELEVANT'})};
 }
 if (decision.lanes.length!==1 || !gateway)
  return {answer:null,receipt:Object.freeze({required:true,status:'unavailable',reason_code:'SCOPE_OR_GATEWAY_UNAVAILABLE'})};
 let primary;
 try {
  const scope=decision.lanes[0];
  if (scope==='personal/current') {
   if (typeof gateway.recallPersonal!=='function') throw new Error('PERSONAL_RECALL_NOT_AVAILABLE');
   primary=await gateway.recallPersonal({query:intent.userIntent.text});
  }
  else if (typeof gateway.recall==='function')
   primary=await gateway.recall({query:intent.userIntent.text});
  else throw new Error('RECALL_NOT_AVAILABLE');
 }
 catch {primary={status:'unavailable'};}
 const normalized=normalizeRecallStatus({primary,policy:{allowEngram:false}});
 if (normalized.status!=='ok')
  return {answer:null,receipt:Object.freeze({required:true,status:normalized.status,reason_code:normalized.reason_code})};
 const safe=sanitizeEvidenceForModel(normalized.evidence);
 if (safe.evidence.every(item=>item.suspicious))
  return {answer:null,receipt:Object.freeze({required:true,status:'denied',reason_code:'EVIDENCE_UNTRUSTED'})};
 const answer=await answerProducer({evidence:safe.evidence,promptBoundary:safe.promptBoundary,memoryStatus:'ok'});
 return {answer,receipt:Object.freeze({required:true,status:'ok',reason_code:'EVIDENCE_VERIFIED',
  generation_id:normalized.generation_id,evidence_count:normalized.evidence.length})};
}
module.exports={enforceRecall};
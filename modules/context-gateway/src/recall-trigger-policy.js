'use strict';
// Inputs are trusted host classifications; free-text hints are supplementary, not authority.
const HISTORY=/(\b(?:as we decided|what did we|last time|previously|we discussed|remember when)\b|\b(?:lembra|decidimos|combinamos|conversamos antes|ontem)\b)/i;
const PROJECT=/^project\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
function decideRecall({userIntent,availableScopes=[],historyReferences=false}={}) {
 const domain=userIntent && typeof userIntent==='object' ? userIntent.domain : undefined;
 const content=userIntent && typeof userIntent.text==='string' ? userIntent.text.slice(0,16000) : '';
 const required=historyReferences===true || (Array.isArray(historyReferences)&&historyReferences.length>0) ||
  Boolean(userIntent&&(userIntent.kind==='recall'||userIntent.contextDependent===true)) || HISTORY.test(content);
 if (!required) return Object.freeze({required:false,lanes:[],reason:'NOT_RELEVANT'});
 if (!Array.isArray(availableScopes)) throw new Error('RECALL_SCOPES_INVALID');
 const scopes=availableScopes.filter(s=>s==='personal/current'||(typeof s==='string'&&PROJECT.test(s)));
 const projectScopes=[...new Set(scopes.filter(s=>s.startsWith('project/')))];
 const preferred=userIntent && typeof userIntent.projectScope==='string' ? userIntent.projectScope : null;
 const selected=domain==='personal' ? scopes.find(s=>s==='personal/current') :
  domain==='project' ? (preferred ? projectScopes.find(s=>s===preferred) :
    (projectScopes.length===1 ? projectScopes[0] : undefined)) : undefined;
 return Object.freeze({required:true,lanes:selected?[selected]:[],reason:selected?'HISTORY_REFERENCE':'SCOPE_UNAVAILABLE'});
}
module.exports={decideRecall};
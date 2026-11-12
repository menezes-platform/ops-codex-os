'use strict';
const { createHash } = require('node:crypto');

// Transport for a separately authenticated, cloud-hosted personal retrieval
// service. It never opens local files or calls the Windows/Resident desktop.
// The receiving server MUST independently verify the bearer, owner identity,
// encryption and index generation; this client cannot provision any of them.
const SCOPE = 'personal/current';
const FILTERS = new Set(['source_types','revision','after','before']);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const METHODS = new Set(['bm25','faiss','vector','hybrid','manual']);
const STATUS = new Set(['ok','miss','unavailable','denied','stale']);
const MAX_BODY = 1024 * 1024;

function plainObject(value) {
 return !!value && typeof value==='object' && !Array.isArray(value);
}
function instant(value) {
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return NaN;
 const time=Date.parse(value);
 return Number.isFinite(time) && new Date(time).toISOString().slice(0,19)===value.slice(0,19) ? time : NaN;
}
function safeBaseUrl(raw) {
 let parsed;
 try{parsed=new URL(raw)}catch{throw Error('CLOUD_RAG_URL_UNSAFE')}
 if(typeof raw!=='string'||parsed.protocol!=='https:'||parsed.username||parsed.password||
   parsed.pathname!=='/'||parsed.search||parsed.hash||
   ['localhost','127.0.0.1','[::1]','::1'].includes(parsed.hostname.toLowerCase())||
   parsed.hostname.toLowerCase().endsWith('.localhost'))throw Error('CLOUD_RAG_URL_UNSAFE');
 return parsed.origin;
}
function validateRequest(request) {
 if(!plainObject(request)||Object.keys(request).some(key=>!['scope','query','filters'].includes(key))||
    request.scope!==SCOPE||typeof request.query!=='string'||!request.query.trim()||
    Buffer.byteLength(request.query,'utf8')>4096)throw Error('CLOUD_RAG_REQUEST_DENIED');
 const filters=request.filters??{};
 if(!plainObject(filters)||Object.keys(filters).some(key=>!FILTERS.has(key))||
    (filters.source_types!==undefined&&(!Array.isArray(filters.source_types)||
     filters.source_types.length>10||filters.source_types.some(x=>typeof x!=='string'||!x.trim())))||
    ['revision','after','before'].some(k=>filters[k]!==undefined&&(
      typeof filters[k]!=='string'||!filters[k].trim()||filters[k].length>200)))throw Error('CLOUD_RAG_REQUEST_DENIED');
 return {scope:SCOPE,query:request.query,filters};
}
function validateEvidence(hits,revision,generation) {
 if(!Array.isArray(hits)||hits.length<1||hits.length>100)throw Error('CLOUD_RAG_RESPONSE_INVALID');
 const seen=new Set();
 for(const hit of hits){
  if(!plainObject(hit)||hit.scope!==SCOPE||
     typeof hit.owner_principal_id!=='string'||!hit.owner_principal_id.trim()||
     typeof hit.evidence_id!=='string'||!hit.evidence_id.trim()||
     typeof hit.source_ref!=='string'||!hit.source_ref.trim()||
     typeof hit.source_revision!=='string'||hit.source_revision!==revision||
     typeof hit.generation_id!=='string'||hit.generation_id!==generation||
     typeof hit.content!=='string'||Buffer.byteLength(hit.content)>16384||
     !SHA256.test(hit.content_sha256)||
     hit.content_sha256!=='sha256:'+createHash('sha256').update(hit.content).digest('hex')||
     !METHODS.has(hit.retrieval_method)||!Number.isFinite(instant(hit.observed_at))||
     seen.has(hit.evidence_id))throw Error('CLOUD_RAG_RESPONSE_INVALID');
  seen.add(hit.evidence_id);
 }
 return hits;
}
async function boundedJson(reply) {
 const header=reply.headers?.get?.('content-length');
 if(header!==null&&header!==undefined&&(+header>MAX_BODY||!Number.isFinite(+header)))throw Error('CLOUD_RAG_RESPONSE_INVALID');
 if(reply.body?.getReader){
  const reader=reply.body.getReader();const chunks=[];let total=0;
  try{
   for(;;){const part=await reader.read();if(part.done)break;
    if(!(part.value instanceof Uint8Array))throw Error('CLOUD_RAG_RESPONSE_INVALID');
    total+=part.value.byteLength;
    if(total>MAX_BODY){await reader.cancel();throw Error('CLOUD_RAG_RESPONSE_INVALID')}
    chunks.push(Buffer.from(part.value));
   }
  }finally{reader.releaseLock?.()}
  try{return JSON.parse(Buffer.concat(chunks,total).toString('utf8'))}catch{throw Error('CLOUD_RAG_RESPONSE_INVALID')}
 }
 // The .json() path supports injected test transports. Production fetch has a stream.
 const parsed=await reply.json();
 if(Buffer.byteLength(JSON.stringify(parsed))>MAX_BODY)throw Error('CLOUD_RAG_RESPONSE_INVALID');
 return parsed;
}
function createCloudPersonalRetrievalClient({baseUrl,getCapability,fetchImpl=globalThis.fetch,
    timeoutMs=5000,maxSyncAgeMs=86400000,now=Date.now}={}) {
 const base=safeBaseUrl(baseUrl);
 if(typeof getCapability!=='function'||typeof fetchImpl!=='function'||typeof now!=='function')throw Error('CLOUD_RAG_ADAPTERS_REQUIRED');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
    !Number.isSafeInteger(maxSyncAgeMs)||maxSyncAgeMs<1||maxSyncAgeMs>7*86400000)throw Error('CLOUD_RAG_LIMIT_INVALID');
 return Object.freeze({async retrieve(request){
  const payload=validateRequest(request);
  let bearer;
  try{bearer=await getCapability()}catch{throw Error('CLOUD_RAG_CAPABILITY_REQUIRED')}
  if(typeof bearer!=='string'||bearer.length<1||bearer.length>4096||/[\x00-\x20\x7f]/.test(bearer))throw Error('CLOUD_RAG_CAPABILITY_REQUIRED');
  let reply;
  try{reply=await fetchImpl(base+'/v1/indexing/personal/retrieve',{
   method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+bearer},
   body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(timeoutMs)
  })}catch{return {status:'unavailable',evidence:[]}}
  if(!reply||reply.redirected)throw Error('CLOUD_RAG_REDIRECT_DENIED');
  if(reply.status===401||reply.status===403)return {status:'denied',evidence:[]};
  if(!reply.ok)return {status:'unavailable',evidence:[]};
  let data;
  try{data=await boundedJson(reply)}catch{throw Error('CLOUD_RAG_RESPONSE_INVALID')}
  if(!plainObject(data)||!STATUS.has(data.status))throw Error('CLOUD_RAG_RESPONSE_INVALID');
  if(data.status==='unavailable'||data.status==='denied'||data.status==='stale')return {status:data.status,evidence:[]};
  if(data.scope!==SCOPE||!Number.isFinite(instant(data.last_sync_at)))return {status:'stale',evidence:[]};
  const checkedAt=now(),syncedAt=instant(data.last_sync_at);
  if(!Number.isFinite(checkedAt)||syncedAt>checkedAt+300000||checkedAt-syncedAt>maxSyncAgeMs)return {status:'stale',evidence:[]};
  if(data.status==='miss'){
   if(typeof data.revision!=='string'||!data.revision.trim()||
      typeof data.generation_id!=='string'||!data.generation_id.trim()||
      !Array.isArray(data.evidence)||data.evidence.length)return {status:'unavailable',evidence:[]};
   return {status:'miss',evidence:[],last_sync_at:data.last_sync_at};
  }
  if(typeof data.revision!=='string'||!data.revision.trim()||
    typeof data.generation_id!=='string'||!data.generation_id.trim())throw Error('CLOUD_RAG_RESPONSE_INVALID');
  validateEvidence(data.evidence,data.revision,data.generation_id);
  return {status:'ok',scope:SCOPE,revision:data.revision,generation_id:data.generation_id,
   last_sync_at:data.last_sync_at,evidence:data.evidence};
 }});
}
module.exports={createCloudPersonalRetrievalClient};

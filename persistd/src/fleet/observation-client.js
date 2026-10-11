const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {authorityUrl}=require('./executor-client');
const {signNodeRequest,verifyNodeRequest}=require('./auth');
const {OPERATIONS,CODES,argsValid,validateResult}=require('./observation');

class ObservationClient {
  constructor({baseUrl,nodeId,secret,operations,receiptDir,fetchImpl=globalThis.fetch,hostUrl='http://127.0.0.1:48731',tokenReader}={}) {
    this.baseUrl=authorityUrl(baseUrl);
    if(nodeId!=='desktop-primary' || !secret || !Array.isArray(operations) || !operations.length || operations.some(o=>!Object.hasOwn(OPERATIONS,o))) throw Error('OBSERVATION_CONFIG_INVALID');
    const local=new URL(hostUrl);
    if(local.protocol!=='http:' || local.hostname!=='127.0.0.1' || local.username || local.password || local.pathname!=='/' || local.search || local.hash) throw Error('OBSERVATION_LOOPBACK_REQUIRED');
    if(!path.isAbsolute(receiptDir||'')) throw Error('OBSERVATION_CONFIG_INVALID');
    this.nodeId=nodeId;this.secret=secret;this.operations=operations;this.receiptDir=receiptDir;this.fetch=fetchImpl;this.hostUrl=local.origin;
    this.tokenReader=tokenReader||(()=>fs.readFileSync(path.join(process.env.LOCALAPPDATA,'Dev-Orquestra','Desktop','token.txt'),'utf8').trim());
    fs.mkdirSync(receiptDir,{recursive:true});
    for(let parent=receiptDir;;parent=path.dirname(parent)){if(fs.lstatSync(parent).isSymbolicLink())throw Error('OBSERVATION_CONFIG_INVALID');if(path.dirname(parent)===parent)break;}
  }
  async body(response,maxBytes) {
    const chunks=[];let count=0;
    for await(const chunk of response.body||[]){count+=chunk.length;if(count>maxBytes)throw Error('INVALID_OBSERVATION_RESULT');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks).toString('utf8');
  }
  async request(action,input) {
    const timestamp=new Date().toISOString(),route=`/v1/fleet/nodes/${this.nodeId}/observations/${action}`,body=JSON.stringify(input);
    const response=await this.fetch(this.baseUrl+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json','x-persistflow-node-id':this.nodeId,'x-persistflow-node-timestamp':timestamp,
        'x-persistflow-node-signature':signNodeRequest({nodeId:this.nodeId,secret:this.secret,timestamp,method:'POST',path:route,body})},body});
    const rawBody=await this.body(response,action==='poll'?4096:2048);
    if(!verifyNodeRequest({nodeId:this.nodeId,timestamp:response.headers.get('x-persistflow-node-timestamp'),signature:response.headers.get('x-persistflow-node-signature'),method:'RESPONSE-'+response.status,path:route,rawBody,secrets:{[this.nodeId]:this.secret},maxSkewMs:60000})) throw Error('OBSERVATION_AUTH_FAILED');
    const value=JSON.parse(rawBody);if(!response.ok)throw Error('OBSERVATION_AUTHORITY_REJECTED');return value;
  }
  validateJob(job) {
    if(!job || Object.keys(job).some(k=>!['runId','generation','operationId','nodeId','operation','arguments','requestId','expiresAt'].includes(k))
      || job.nodeId!==this.nodeId || !this.operations.includes(job.operation) || typeof job.runId!=='string' || job.runId.length>128
      || !Number.isInteger(job.generation) || job.generation<1 || !/^[A-Za-z0-9_-]{1,128}$/.test(job.operationId||'')
      || !/^[a-f0-9-]{36}$/.test(job.requestId||'') || !Number.isFinite(job.expiresAt) || job.expiresAt<=Date.now() || job.expiresAt>Date.now()+16000) throw Error('OBSERVATION_JOB_INVALID');
    argsValid(job.operation,job.arguments);return job;
  }
  async local(job) {
    const token=this.tokenReader();if(typeof token!=='string'||token.length<16)throw Error('AUTH_REQUIRED');
    const response=await this.fetch(this.hostUrl+'/v1/observe',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({version:1,request_id:job.requestId,operation:job.operation,arguments:job.arguments})});
    if(response.status===401)throw Error('AUTH_REQUIRED');
    if(response.status===404)throw Error('DESKTOP_HOST_UNAVAILABLE');
    const envelope=JSON.parse(await this.body(response,2*1024*1024));
    if(envelope.request_id!==job.requestId || envelope.version!==1) throw Error('OBSERVATION_FAILED');
    if(!envelope.ok)throw Error(CODES.has(envelope.error?.code)?envelope.error.code:'OBSERVATION_FAILED');
    return validateResult(job.operation,envelope.result);
  }
  async once() {
    const {job}=await this.request('poll',{});if(job===null)return null;this.validateJob(job);
    const file=path.join(this.receiptDir,crypto.createHash('sha256').update(job.requestId).digest('hex')+'.json');
    if(fs.readdirSync(this.receiptDir).length>=4096)throw Error('OBSERVATION_RECEIPT_LIMIT');
    // Durable before capture. An uncertain/replayed delivery never recaptures after a restart.
    let descriptor;
    try {descriptor=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('OBSERVATION_REPLAY');throw e;}
    try {fs.writeFileSync(descriptor,JSON.stringify({requestId:job.requestId,startedAt:new Date().toISOString()}));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
    let result,error;
    try {result=await this.local(job);} catch(e){error=CODES.has(e.message)?e.message:'OBSERVATION_FAILED';}
    const ack=await this.request('report',{...job,...(result?{result}:{error})});
    if(ack.acknowledged!==true||ack.requestId!==job.requestId)throw Error('OBSERVATION_AUTH_FAILED');
    return {requestId:job.requestId,status:error?'FAILED':'COMPLETED'};
  }
}
function configuredObservation({env=process.env}={}) {
  if(env.PERSISTFLOW_DESKTOP_OBSERVATION_ENABLED!=='1')return null;
  return new ObservationClient({baseUrl:env.PERSISTFLOW_BASE_URL,nodeId:env.PERSISTFLOW_FLEET_NODE_ID,secret:env.PERSISTFLOW_FLEET_NODE_SECRET,
    operations:JSON.parse(env.PERSISTFLOW_DESKTOP_OBSERVATION_OPERATIONS_JSON||'[]'),receiptDir:env.PERSISTFLOW_DESKTOP_OBSERVATION_RECEIPT_DIR});
}
async function runObservationLoop(client,{signal,log=()=>{}}={}) {
  let previous;
  while(!signal?.aborted) {
    try{await client.once();previous=null;}catch{if(previous!=='OBSERVATION_LOOP_FAILED')log('OBSERVATION_LOOP_FAILED');previous='OBSERVATION_LOOP_FAILED';}
    if(!signal?.aborted)await new Promise(ok=>setTimeout(ok,1000));
  }
}
module.exports={ObservationClient,configuredObservation,runObservationLoop};

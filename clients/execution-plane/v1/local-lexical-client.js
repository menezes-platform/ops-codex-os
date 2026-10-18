'use strict';
// Local OS-authorized diagnostic adapter; no HTTP listener or service credentials.
const {spawn}=require('node:child_process');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {assertProjectScope}=require('../../../modules/context-gateway/src');
const DIGEST=/^sha256:[a-f0-9]{64}$/;

function runNativeLexical({executable,request}={}){
 if(typeof executable!=='string'||!path.isAbsolute(executable))throw new Error('NATIVE_EXECUTABLE_REQUIRED');
 const input=JSON.stringify(request);
 if(Buffer.byteLength(input)>65536)throw new Error('NATIVE_REQUEST_TOO_LARGE');
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],timeout:30000});
  const chunks=[];let size=0,finished=false;
  const fail=()=>{if(!finished){finished=true;reject(new Error('NATIVE_INDEX_UNAVAILABLE'))}};
  child.on('error',fail);child.stdin.on('error',fail);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){fail();child.kill()}else chunks.push(chunk)});
  child.on('close',code=>{
   if(finished)return;
   if(code!==0)return fail();
   let result;
   try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return fail()}
   finished=true;resolve(result);
  });
  child.stdin.end(input);
 });
}

function createLocalLexicalClient({executable,indexRoot,receipt}={}){
 if(typeof indexRoot!=='string'||!path.isAbsolute(indexRoot)||!receipt||
    receipt.backend!=='rust-sqlite-fts5-bm25'||!DIGEST.test(receipt.artifact_sha256)||
    typeof receipt.revision!=='string'||!receipt.revision.trim()||!path.isAbsolute(receipt.artifact||''))
  throw new Error('NATIVE_RECEIPT_INVALID');
 const scope=assertProjectScope(receipt.scope);
 // Copy host-owned configuration; later mutation cannot switch project/artifact.
 const revision=receipt.revision,artifact=receipt.artifact,artifactDigest=receipt.artifact_sha256;
 const generation='lexical:'+artifactDigest.slice(7);
 return Object.freeze({
  async indexProject(){throw new Error('LEXICAL_QUALIFICATION_READ_ONLY')},
  async retrieve(request){
   if(!request||request.scope!==scope||request.allowlisted_scopes!==undefined)throw new Error('SCOPE_DENIED');
   if(typeof request.query!=='string'||!request.query.trim()||Buffer.byteLength(request.query)>4096)throw new Error('QUERY_INVALID');
   const filters=request.filters??{};
   if(!filters||typeof filters!=='object'||Array.isArray(filters)||
      Object.keys(filters).some(key=>key!=='revision'))throw new Error('FILTERS_UNSUPPORTED');
   if(filters.revision!==undefined&&filters.revision!==revision)throw new Error('SOURCE_STALE');
   const result=await runNativeLexical({executable,request:{action:'search',scope,revision,index_root:indexRoot,
    artifact,artifact_sha256:artifactDigest,query:request.query}});
   if(!result||!['ok','miss'].includes(result.status)||result.scope!==scope||result.revision!==revision||
      result.backend!=='rust-sqlite-fts5-bm25'||result.artifact_sha256!==artifactDigest||
      !Array.isArray(result.evidence)||result.evidence.length>5)throw new Error('NATIVE_EVIDENCE_INVALID');
   const evidence=result.evidence.map(hit=>{
    if(hit.scope!==scope||hit.source_revision!==revision||hit.retrieval_method!=='bm25'||
       typeof hit.content!=='string'||hit.content_sha256!=='sha256:'+createHash('sha256').update(hit.content).digest('hex'))
     throw new Error('NATIVE_EVIDENCE_INVALID');
    return {...hit,generation_id:generation,observed_at:new Date().toISOString()};
   });
   return {status:result.status,revision,generation_id:generation,evidence};
  }
 });
}
module.exports={runNativeLexical,createLocalLexicalClient};

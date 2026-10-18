'use strict';
// Reproducible local qualification; derived SQLite indexes remain disposable.
const fs=require('node:fs/promises');
const path=require('node:path');
const {parseArgs}=require('node:util');
const {createHash,randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {createContextGateway}=require('../modules/context-gateway/src');
const {runNativeLexical,createLocalLexicalClient}=require('../clients/execution-plane/v1/local-lexical-client');
const SCOPE='project/rag-validation/aurora';
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');

async function main(){
 const {values}=parseArgs({options:{prepare:{type:'boolean'},rebuild:{type:'boolean'},hybrid:{type:'boolean'},root:{type:'string'},source:{type:'string'},
  'source-ref':{type:'string'},revision:{type:'string'},query:{type:'string'}}});
 if(!values.root||!path.isAbsolute(values.root))throw new Error('ABSOLUTE_ROOT_REQUIRED');
 const executable=process.env.RAG_NATIVE_BIN;
 if(!executable||!path.isAbsolute(executable))throw new Error('RAG_NATIVE_BIN_REQUIRED');
 const root=values.root,corpusRoot=path.join(root,'corpus'),indexRoot=path.join(root,'indexes');
 const stateFile=path.join(root,'qualification.json');
 const started=performance.now();
 const store=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root:corpusRoot})});
 if(values.prepare){
  if(!values.source||!values['source-ref']||!values.revision)throw new Error('SOURCE_AND_REVISION_REQUIRED');
  const stat=await fs.stat(values.source);
  if(!stat.isFile()||stat.size>1024*1024)throw new Error('SOURCE_SIZE_INVALID');
  const bytes=await fs.readFile(values.source);
  const content=new TextDecoder('utf8',{fatal:true}).decode(bytes);
  const revision=values.revision;
  const persisted=await store.putCorpusProjection({scope:SCOPE,source_revision:revision,
   idempotency_key:'qualification-'+hash(bytes).slice(7),documents:[{source_ref:values['source-ref'],path:'aurora-runbook-v1.md',content}]});
  const readback=await store.readCorpusProjection({scope:SCOPE,corpus_manifest_ref:persisted.corpus_manifest_ref});
  if(hash(Buffer.from(readback.documents[0].content))!==hash(bytes))throw new Error('SOURCE_INTEGRITY_FAILED');
  const receipt=await runNativeLexical({executable,request:{action:'build',scope:SCOPE,revision,
   corpus_root:corpusRoot,index_root:indexRoot,manifest_ref:persisted.corpus_manifest_ref,...(values.hybrid?{hybrid:true}:{})}});
  const state={schema_version:1,mode:values.hybrid?'local-native-hybrid':'local-native-lexical',scope:SCOPE,revision,source_ref:values['source-ref'],
   source_sha256:hash(bytes),corpus_manifest_ref:persisted.corpus_manifest_ref,receipt};
  await fs.writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
  return {...state,elapsed_ms:performance.now()-started};
 }
 if(!values.rebuild&&(typeof values.query!=='string'||!values.query.trim()))throw new Error('QUERY_REQUIRED');
 const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
 if(state.scope!==SCOPE||!['local-native-lexical','local-native-hybrid'].includes(state.mode))throw new Error('QUALIFICATION_STATE_INVALID');
 const corpus=await store.readCorpusProjection({scope:SCOPE,corpus_manifest_ref:state.corpus_manifest_ref});
 if(corpus.manifest.source_revision!==state.revision||corpus.documents.length!==1||
    hash(Buffer.from(corpus.documents[0].content))!==state.source_sha256)throw new Error('SOURCE_INTEGRITY_FAILED');
 if(values.rebuild){
  const receipt=await runNativeLexical({executable,request:{action:'build',scope:SCOPE,revision:state.revision,
   corpus_root:corpusRoot,index_root:indexRoot,manifest_ref:state.corpus_manifest_ref,
   idempotency_key:'rebuild:'+randomUUID(),...(state.mode==='local-native-hybrid'?{hybrid:true}:{})}});
  const updated={...state,receipt};
  const temporary=stateFile+'.'+randomUUID()+'.tmp';
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(updated,null,2)+'\n');await handle.sync()}finally{await handle.close()}
  await fs.rename(temporary,stateFile);
  return {...updated,elapsed_ms:performance.now()-started};
 }
 const client=createLocalLexicalClient({executable,indexRoot,receipt:state.receipt});
 const gateway=createContextGateway({executionPlaneClient:client,resolveProjectScope:async()=>SCOPE});
 let evidence=[];
 const result=await gateway.answerWithContext({userIntent:{text:values.query,domain:'project'},historyReferences:true,
  answerProducer:async input=>{
   evidence=input.evidence;
   return evidence.map(hit=>`${hit.content}\n[${hit.evidence_id}] ${hit.source_ref} @ ${hit.source_revision}`).join('\n\n');
  }});
 if(result.receipt.status==='unavailable')throw new Error('NATIVE_RETRIEVAL_UNAVAILABLE');
 return {mode:state.mode,status:result.receipt.status,answer_mode:'extractive-no-model',answer:result.answer,
  evidence,receipt:result.receipt,elapsed_ms:performance.now()-started,rss_bytes:process.memoryUsage().rss};
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result,null,2)))
 .catch(()=>{console.error('RAG_SLICE_FAILED: source or index unavailable/invalid');process.exitCode=1});
module.exports={main};

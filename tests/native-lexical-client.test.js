'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const {createLocalCorpusObjectTransport}=require('../modules/context-store/src/local-corpus-transport');
const {runNativeLexical,createLocalLexicalClient}=require('../clients/execution-plane/v1/local-lexical-client');
const {createContextGateway}=require('../modules/context-gateway/src');

test('actual Node corpus and Rust FTS5 return verified contextual answers after restart',
 {skip:!process.env.RAG_NATIVE_BIN && 'RAG_NATIVE_BIN must name the qualified native resident-rag binary'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rag-native-'));
 try{
  const scope='project/demo/alpha',revision='native-v1';
  const corpusRoot=path.join(root,'corpus'),indexRoot=path.join(root,'indexes');
  const store=createDriveCorpusStore({transport:await createLocalCorpusObjectTransport({root:corpusRoot})});
  const persisted=await store.putCorpusProjection({scope,source_revision:revision,idempotency_key:'native-test-v1',documents:[{
   source_ref:'git:runbook',path:'runbook.md',content:'# Recovery\nRestore the previous intact generation and verify SHA-256 before resuming.'
  }]});
  const receipt=await runNativeLexical({executable:process.env.RAG_NATIVE_BIN,request:{action:'build',scope,revision,
   corpus_root:corpusRoot,index_root:indexRoot,manifest_ref:persisted.corpus_manifest_ref}});
  const client=createLocalLexicalClient({executable:process.env.RAG_NATIVE_BIN,indexRoot,receipt});
  const gateway=createContextGateway({executionPlaneClient:client,resolveProjectScope:async()=>scope});
  const result=await gateway.answerWithContext({userIntent:{text:'Which generation should recovery restore?',domain:'project'},historyReferences:true,
   answerProducer:async({evidence})=>`${evidence[0].content} [${evidence[0].source_ref}@${evidence[0].source_revision}]`});
  assert.equal(result.receipt.status,'ok');assert.match(result.answer,/previous intact generation/);
  assert.match(result.answer,/git:runbook@native-v1/);
  await assert.rejects(client.retrieve({scope:'project/demo/beta',query:'recovery',filters:{}}),/SCOPE_DENIED/);
  await assert.rejects(client.retrieve({scope,query:'recovery',filters:{after:'2026-01-01T00:00:00Z'}}),/FILTERS_UNSUPPORTED/);
  await fs.writeFile(receipt.artifact,'broken');
  let answered=false;
  const unavailable=await gateway.answerWithContext({userIntent:{text:'Recovery earlier?',domain:'project'},historyReferences:true,
   answerProducer:async()=>{answered=true}});
  assert.equal(unavailable.receipt.status,'unavailable');assert.equal(answered,false);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

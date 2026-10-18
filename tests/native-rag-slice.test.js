'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
test('repeatable native slice uses persisted state across separate Node processes',
 {skip:!process.env.RAG_NATIVE_BIN&&'requires qualified native binary'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rag-slice-'));
 const cli=path.resolve(__dirname,'../scripts/native-rag-slice.js');
 const invoke=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8',env:process.env}));
 try{
  const source=path.resolve(__dirname,'fixtures/rag-validation/aurora-runbook-v1.md');
  const hybrid=process.env.RAG_NATIVE_HYBRID==='1';
  const prepared=invoke('--prepare',...(hybrid?['--hybrid']:[]),'--root',root,'--source',source,'--source-ref','git:test:aurora','--revision','aurora-v1');
  assert.equal(prepared.mode,hybrid?'local-native-hybrid':'local-native-lexical');assert.equal(prepared.source_sha256.length,71);
  const answer=invoke('--root',root,'--query','Qual checksum deve ser conferido após uma interrupção?');
  assert.equal(answer.status,'ok');assert.match(answer.answer,/SHA-256/);assert.match(answer.answer,/git:test:aurora/);
  assert.ok(answer.evidence.every(hit=>hit.source_revision==='aurora-v1'));
  await fs.rename(path.join(root,'corpus'),path.join(root,'unavailable-corpus'));
  assert.throws(()=>invoke('--root',root,'--query','checksum'),/Command failed/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

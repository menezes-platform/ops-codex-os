'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const script=path.resolve(__dirname,'../scripts/p05-local-corpus-smoke.js');
const fixture=path.resolve(__dirname,'fixtures/p05-local-public-corpus.json');
function run(root,...args){return spawnSync(process.execPath,[script,'--fixture',fixture,'--root',root,...args],{encoding:'utf8',timeout:15000});}
test('local corpus smoke persists and rematerializes public fixture without exposing content',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'p05-smoke-'));
 try{
  const first=run(dir);
  assert.equal(first.status,0,first.stderr);
  const data=JSON.parse(first.stdout);
  assert.equal(data.status,'verified_offline');
  assert.equal(data.document_count,2);
  assert.equal(data.scope,'project/demo/alpha');
  assert.match(data.corpus_manifest_ref,/^sha256:[0-9a-f]{64}$/);
  assert.ok(!first.stdout.includes('Recovery'));
  const second=run(dir);
  assert.equal(second.status,0,second.stderr);
  assert.equal(JSON.parse(second.stdout).corpus_manifest_ref,data.corpus_manifest_ref);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('smoke script fails on unexpected arguments rather than starting implicit production writes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'p05-smoke-'));
 try{
  const out=run(dir,'--production');
  assert.notEqual(out.status,0);
  assert.match(out.stderr,/P05_SMOKE_ARGUMENTS_INVALID/);
  assert.equal(out.stdout,'');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

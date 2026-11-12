'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createCloudPersonalRetrievalClient} = require('../clients/execution-plane/v1/cloud-personal-retrieval-client');

const ORIGIN = 'https://rag.fixture.invalid';
const NOW = '2026-11-11T23:00:00.000Z';
const TEXT = 'Fixture: continue recovery when the developer PC is offline';
const digest = 'sha256:' + crypto.createHash('sha256').update(TEXT).digest('hex');

function readBounded(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', chunk => {
      size += chunk.length;
      if(size > 8192) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); }
      else parts.push(chunk);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) } catch(e) {reject(e)} });
    req.on('error', reject);
  });
}
async function createSyntheticHttpsService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'rag-tls-smoke-'));
  const keyfile = path.join(dir,'key.pem');
  const certfile = path.join(dir,'cert.pem');
  const result = spawnSync('openssl',[
    'req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',keyfile,'-out',certfile,'-days','2',
    '-subj','/CN=rag.fixture.invalid','-addext','subjectAltName=DNS:rag.fixture.invalid'
  ],{encoding:'utf8',timeout:8000});
  if(result.status !== 0) throw new Error('FIXTURE_OPENSSL_FAILED');
  const ca=await fs.readFile(certfile);
  const server=https.createServer({key:await fs.readFile(keyfile),cert:ca},async(req,res)=>{
    const send=(code,body)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    try {
      if(req.url!=='/v1/indexing/personal/retrieve' || req.method!=='POST')return send(404,{status:'unavailable'});
      if(req.headers.authorization!=='Bearer fixture-only-key')return send(401,{status:'denied'});
      const data=await readBounded(req);
      if(data.scope!=='personal/current' || typeof data.query!=='string')return send(403,{status:'denied'});
      const issued={status:'ok',scope:'personal/current',revision:'fixture-v1',generation_id:'fixture-g1',
        last_sync_at:'2026-11-11T22:59:00Z',evidence:[{
          evidence_id:'fixture-hit',scope:'personal/current',owner_principal_id:'fixture-owner',
          source_ref:'manual:synthetic-evidence',source_revision:'fixture-v1',
          generation_id:'fixture-g1',observed_at:'2026-11-11T22:55:00Z',
          content:TEXT,content_sha256:digest,retrieval_method:'manual'
        }]};
      return send(200,issued);
    }catch{return send(400,{status:'unavailable'})}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {server,ca,dir,port:server.address().port};
}
function transport({ca,port}) {
  return async (url,options) => {
    const u=new URL(url);
    assert.equal(u.origin,ORIGIN);
    return new Promise((resolve,reject)=>{
      const req=https.request({hostname:'127.0.0.1',port,servername:'rag.fixture.invalid',
        ca,rejectUnauthorized:true,path:u.pathname,method:options.method,headers:{...options.headers,host:u.hostname},
        signal:options.signal},r=>{
        let bytes=0;const parts=[];
        r.on('data',part=>{bytes+=part.length;if(bytes>1024*1024)r.destroy(new Error('OVERSIZED'));else parts.push(part)});
        r.on('end',()=>resolve({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,
          redirected:false,headers:{get:k=>r.headers[k]},
          json:async()=>JSON.parse(Buffer.concat(parts).toString('utf8'))}));
        r.on('error',reject);
      });
      req.on('error',reject);
      req.end(options.body);
    });
  };
}
test('actual TLS handshake + strict client validates an offline-PC retrieval response',async t=>{
  const s=await createSyntheticHttpsService();
  t.after(async()=>{await new Promise(resolve=>s.server.close(resolve));await fs.rm(s.dir,{recursive:true,force:true})});
  const provider=createCloudPersonalRetrievalClient({baseUrl:ORIGIN,fetchImpl:transport(s),
    getCapability:async()=> 'fixture-only-key',now:()=>Date.parse(NOW)});
  const r=await provider.retrieve({scope:'personal/current',query:'Offline cloud RAG',filters:{}});
  assert.equal(r.status,'ok');
  assert.equal(r.generation_id,'fixture-g1');
  assert.equal(r.evidence.length,1);
  assert.equal(r.evidence[0].source_ref,'manual:synthetic-evidence');
  assert.equal(r.evidence[0].content_sha256,digest);
  assert.equal(r.last_sync_at,'2026-11-11T22:59:00Z');
});
test('actual TLS handshake rejects wrong capability without data',async t=>{
  const s=await createSyntheticHttpsService();
  t.after(async()=>{await new Promise(resolve=>s.server.close(resolve));await fs.rm(s.dir,{recursive:true,force:true})});
  const provider=createCloudPersonalRetrievalClient({baseUrl:ORIGIN,fetchImpl:transport(s),
    getCapability:async()=> 'invalid-fixture-key',now:()=>Date.parse(NOW)});
  const r=await provider.retrieve({scope:'personal/current',query:'Offline cloud RAG',filters:{}});
  assert.deepEqual(r,{status:'denied',evidence:[]});
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {verifyNodeRequest}=require('../persistd/src/fleet/auth');
const {createWorkerDriveAccess}=require('../persistd/src/fleet/worker-drive-access');

test('fetches short-lived Drive access with signed node request, never passing refresh credentials', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worker-drive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const secretPath=path.join(dir,'secret.txt');fs.writeFileSync(secretPath,'a'.repeat(64));
 let calls=0;
 const access=createWorkerDriveAccess({baseUrl:'https://authority.example',nodeId:'conthabil-martha',secretPath,now:()=>new Date('2026-10-27T20:00:00Z'),fetchImpl:async (url,options)=>{
  calls++;
  assert.equal(url,'https://authority.example/v1/fleet/nodes/conthabil-martha/drive-token');
  assert.equal(options.body,'{}');
  assert.equal(verifyNodeRequest({nodeId:'conthabil-martha',timestamp:options.headers['x-persistflow-node-timestamp'],signature:options.headers['x-persistflow-node-signature'],method:'POST',path:'/v1/fleet/nodes/conthabil-martha/drive-token',rawBody:options.body,secrets:{'conthabil-martha':'a'.repeat(64)},nowMs:()=>Date.parse('2026-10-27T20:00:00Z')}),true);
  assert.equal(options.body.includes('refresh'),false);
  return {ok:true,json:async()=>({accessToken:'ephemeral-token',rootId:'root-id',scope:'https://www.googleapis.com/auth/drive.file',expiresAt:'2026-10-27T20:30:00Z'})};
 }});
 const first=await access();const second=await access();
 assert.equal(first.accessToken,'ephemeral-token');assert.equal(first.rootId,'root-id');assert.equal(calls,1);assert.equal((JSON.stringify({access})||'').includes('ephemeral-token'),false);
});

test('missing Drive worker configuration fails closed before any job runs',()=>{
 assert.throws(()=>createWorkerDriveAccess({baseUrl:'http://unsecured.test',nodeId:'node',secretPath:'ignored'}),/DRIVE_AUTHORITY_HTTPS_REQUIRED/);
});

test('no Drive auth or missing root never grants durable permission',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worker-drive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const secretPath=path.join(dir,'secret.txt');fs.writeFileSync(secretPath,'a'.repeat(64));
 const denied=createWorkerDriveAccess({baseUrl:'https://authority.example',nodeId:'conthabil-martha',secretPath,fetchImpl:async()=>({ok:false,status:503})});
 await assert.rejects(denied(),/DRIVE_TOKEN_HTTP_503/);
 const incomplete=createWorkerDriveAccess({baseUrl:'https://authority.example',nodeId:'conthabil-martha',secretPath,fetchImpl:async()=>({ok:true,json:async()=>({accessToken:'token'})})});
 await assert.rejects(incomplete(),/DRIVE_ACCESS_INVALID/);
});
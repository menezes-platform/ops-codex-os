const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlandexCodespaceController } = require('./src/plandex/codespaces');
const NAME = 'ideal-guacamole-p77r9rqq4r7xh7xrr';
const REPO = 'menezesx2k26-byte/ops-infra-workbench';
const state = (status='Shutdown') => ({name:NAME,state:status,pending_operation:false,repository:{full_name:REPO},machine:{name:'basicLinux32gb'},idle_timeout_minutes:10,updated_at:'2026-11-04T11:00:00Z'});
const response = (body,status=200) => ({ok:status>=200&&status<300,status,json:async()=>body,text:async()=>JSON.stringify(body)});
function fakeGithub(handle){const calls=[];const fetchImpl=async(url,opt={})=>{calls.push({url,method:opt.method||'GET',headers:opt.headers});return handle(url,opt,calls)};return {fetchImpl,calls};}
const make=(o)=>createPlandexCodespaceController({githubToken:'test-token-not-a-real-secret',...o});

test('fails closed with missing GitHub token without a request',async()=>{
  const c=createPlandexCodespaceController({githubToken:'',fetchImpl:()=>{throw Error('network not allowed')}});
  await assert.rejects(c.status(),/GITHUB_AUTH_UNAVAILABLE/);
});
test('status uses the one fixed private Codespace and sanitizes output',async()=>{
  const f=fakeGithub(url=>{assert.equal(url,'https://api.github.com/user/codespaces/'+NAME);return response({...state(),secrets:'NEVER_RETURN'});});
  const got=await make({fetchImpl:f.fetchImpl}).status();
  assert.deepEqual(got,{codespace:NAME,repository:REPO,state:'Shutdown',pendingOperation:false,machine:'basicLinux32gb',idleTimeoutMinutes:10,updatedAt:'2026-11-04T11:00:00Z'});
  assert.equal(f.calls[0].headers.authorization,'Bearer test-token-not-a-real-secret');
});
test('different repository causes refusal',async()=>{
  const f=fakeGithub(()=>response({...state(),repository:{full_name:'attacker/other'}}));
  await assert.rejects(make({fetchImpl:f.fetchImpl}).status(),/CODESPACE_REPOSITORY_MISMATCH/);
});
test('malformed or missing repository causes refusal',async()=>{
  const f=fakeGithub(()=>response({name:NAME,state:'Shutdown'}));
  await assert.rejects(make({fetchImpl:f.fetchImpl}).status(),/CODESPACE_REPOSITORY_MISMATCH/);
});
test('net-zero billing is insufficient without trusted verifier',async()=>{
  const f=fakeGithub(()=>response(state()));
  await assert.rejects(make({fetchImpl:f.fetchImpl}).start(),/BUDGET_NOT_PROVEN_BLOCKED/);
  assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('unverified budget cannot call start',async()=>{
  const f=fakeGithub(()=>response(state()));
  await assert.rejects(make({fetchImpl:f.fetchImpl,budgetVerifier:async()=>({usageBlocked:false,checkedAt:Date.now()})}).start(),/BUDGET_NOT_PROVEN_BLOCKED/);
  assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('stale budget cannot call start',async()=>{
  const now=Date.parse('2026-11-04T11:00:00Z');const f=fakeGithub(()=>response(state()));
  const c=make({fetchImpl:f.fetchImpl,now:()=>now,budgetVerifier:async()=>({usageBlocked:true,checkedAt:now-3600000,source:'github-settings',account:'menezesx2k26-byte'})});
  await assert.rejects(c.start(),/BUDGET_PROOF_STALE/);
  assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('fresh trusted server proof permits exact start with state readback',async()=>{
  const n=Date.parse('2026-11-04T11:00:00Z');
  const f=fakeGithub((url,opt,calls)=>response(state(opt.method==='POST'?'Starting':calls.some(x=>x.method==='POST')?'Available':'Shutdown'),opt.method==='POST'?202:200));
  const c=make({fetchImpl:f.fetchImpl,now:()=>n,budgetVerifier:async()=>({usageBlocked:true,checkedAt:n,source:'github-authenticated-settings',account:'menezesx2k26-byte'})});
  const out=await c.start();
  assert.equal(out.confirmed,true);assert.equal(out.state,'Available');
  assert.equal(f.calls.find(x=>x.method==='POST').url,'https://api.github.com/user/codespaces/'+NAME+'/start');
});
test('start is not claimed complete when GitHub has transitional state',async()=>{
  const n=Date.now();const f=fakeGithub((url,opt,calls)=>response(state(calls.some(x=>x.method==='POST')?'Starting':'Shutdown')));
  const c=make({fetchImpl:f.fetchImpl,now:()=>n,budgetVerifier:async()=>({usageBlocked:true,checkedAt:n,source:'github-settings',account:'menezesx2k26-byte'})});
  const out=await c.start();assert.equal(out.confirmed,false);assert.equal(out.state,'Starting');
});
test('stop is idempotent on Shutdown and makes no POST',async()=>{
  const f=fakeGithub(()=>response(state('Shutdown')));const out=await make({fetchImpl:f.fetchImpl}).stop();
  assert.equal(out.confirmed,true);assert.ok(f.calls.every(x=>x.method==='GET'));
});
test('stop performs POST and confirms via fresh readback',async()=>{
  const f=fakeGithub((url,opt,calls)=>response(state(opt.method==='POST'?'ShuttingDown':calls.some(x=>x.method==='POST')?'Shutdown':'Available')));
  const out=await make({fetchImpl:f.fetchImpl}).stop();
  assert.equal(out.confirmed,true);assert.equal(out.state,'Shutdown');
  assert.equal(f.calls.find(x=>x.method==='POST').url,'https://api.github.com/user/codespaces/'+NAME+'/stop');
});
test('ShuttingDown is pending, not verified stopped',async()=>{
  const f=fakeGithub((url,opt,calls)=>response(state(calls.some(x=>x.method==='POST')?'ShuttingDown':'Available')));
  const out=await make({fetchImpl:f.fetchImpl}).stop();
  assert.equal(out.confirmed,false);assert.equal(out.state,'ShuttingDown');
});
test('GitHub errors do not reveal credentials or response bodies',async()=>{
  const f=fakeGithub(()=>response({message:'token exposed'},403));
  await assert.rejects(make({fetchImpl:f.fetchImpl}).status(),e=>e.message==='GITHUB_API_UNAVAILABLE_403');
});
test('untrusted caller budget proof is ignored',async()=>{
  const f=fakeGithub(()=>response(state()));
  await assert.rejects(make({fetchImpl:f.fetchImpl}).start({usageBlocked:true}),/BUDGET_NOT_PROVEN_BLOCKED/);
});


test('concurrent start calls serialize and send only one POST', async()=>{
  let mode = 'Shutdown', posts=0;
  const f=fakeGithub(async (url,opt)=>{
    if(opt.method==='POST'){posts++;await new Promise(resolve=>setTimeout(resolve,10));mode='Available';return response({},202);}
    return response(state(mode));
  });
  const n=Date.now();
  const c=make({fetchImpl:f.fetchImpl,now:()=>n,budgetVerifier:async()=>({usageBlocked:true,checkedAt:n,source:'github-settings-verified',account:'menezesx2k26-byte'})});
  const [a,b]=await Promise.all([c.start(),c.start()]);
  assert.equal(posts,1);
  assert.equal(a.confirmed,true);
  assert.equal(b.confirmed,true);
});
test('concurrent stop calls serialize and avoid repeated stop POST', async()=>{
  let mode='Available',posts=0;
  const f=fakeGithub(async(url,opt)=>{
    if(opt.method==='POST'){posts++;await new Promise(resolve=>setTimeout(resolve,10));mode='Shutdown';return response({},202);}
    return response(state(mode));
  });
  const c=make({fetchImpl:f.fetchImpl});
  const [a,b]=await Promise.all([c.stop(),c.stop()]);
  assert.equal(posts,1);assert.equal(a.confirmed,true);assert.equal(b.confirmed,true);
});

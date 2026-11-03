const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('./src/persistflow/http-server');
const { FileOAuthStore } = require('./src/persistflow/oauth-store');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-token-'));
  t.after(() => fs.rmSync(dataDirectory, {recursive:true,force:true}));
  const directory = path.join(dataDirectory,'owner-auth');
  const file = path.join(directory,'current.sha256');
  return {dataDirectory,directory,file};
}
function load(options) {
  const filename = path.join(__dirname,'src/persistflow/owner-token-digest.js');
  assert.ok(fs.existsSync(filename),'private owner digest loader is missing');
  return require(filename).loadOwnerTokenDigest(options);
}
test('private owner digest is optional until explicitly provisioned', t => {
  const f = fixture(t);
  assert.equal(load(f),'');
  fs.mkdirSync(f.directory,{mode:0o700});
  fs.writeFileSync(f.file,'a'.repeat(64)+'\n',{mode:0o600});
  assert.equal(load(f),'a'.repeat(64));
});
test('present invalid, exposed or symlinked owner digests fail closed', t => {
  const f = fixture(t); fs.mkdirSync(f.directory,{mode:0o700});
  fs.writeFileSync(f.file,'fixture-never-log',{mode:0o600});
  assert.throws(() => load(f), error => error.message==='OWNER_DIGEST_INVALID');
  fs.writeFileSync(f.file,'a'.repeat(64)); fs.chmodSync(f.file,0o644);
  assert.throws(() => load(f), /OWNER_DIGEST_INVALID/);
  fs.unlinkSync(f.file);
  const target = path.join(f.dataDirectory,'target'); fs.writeFileSync(target,'a'.repeat(64),{mode:0o600});
  fs.symlinkSync(target,f.file);
  assert.throws(() => load(f), /OWNER_DIGEST_INVALID/);
  fs.unlinkSync(f.file); fs.rmdirSync(f.directory); fs.symlinkSync(f.dataDirectory,f.directory);
  assert.throws(() => load(f), /OWNER_DIGEST_INVALID/);
});
test('owner reset revokes OAuth and changes approval while preserving service bearer', async t => {
  const f = fixture(t), oldData = process.env.PERSISTFLOW_DATA_DIR;
  process.env.PERSISTFLOW_DATA_DIR=f.dataDirectory;
  t.after(() => { if(oldData===undefined) delete process.env.PERSISTFLOW_DATA_DIR; else process.env.PERSISTFLOW_DATA_DIR=oldData; });
  const oauthStore = new FileOAuthStore(path.join(f.dataDirectory,'oauth'));
  const serviceKey='fixture-service-key', newOwner='fixture-new-owner-key';
  const options={oauthStore,mcpToken:serviceKey,mcpTokenDigest:digest(serviceKey)};
  let server=createServer(options);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port, origin='http://127.0.0.1:'+port;
  t.after(async()=>{ if(server.listening) await new Promise(r=>server.close(r)); });
  const client=oauthStore.registerClient({redirect_uris:['https://chatgpt.com/callback']});
  const pair=oauthStore.issueTokenPair({clientId:client.client_id,resource:origin+'/mcp',scope:'persistflow'});
  const initialize = bearer => fetch(origin+'/mcp',{method:'POST',headers:{
    'content-type':'application/json','accept':'application/json, text/event-stream','authorization':'Bearer '+bearer,
  },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}}})});
  assert.equal((await initialize(pair.access_token)).status,200,'old OAuth grant must be valid before reset');
  await new Promise(r=>server.close(r));
  fs.mkdirSync(f.directory,{mode:0o700});
  fs.writeFileSync(f.file,digest(newOwner)+'\n',{mode:0o600});
  server=createServer(options);
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  assert.equal((await initialize(pair.access_token)).status,401);
  assert.equal((await initialize(serviceKey)).status,200,'service bearer must remain independent');
  assert.ok(oauthStore.getClient(client.client_id));
  const authorize = owner => fetch(origin+'/oauth/authorize',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
    response_type:'code',client_id:client.client_id,redirect_uri:'https://chatgpt.com/callback',
    code_challenge:crypto.createHash('sha256').update('fixture-pkce').digest('base64url'),code_challenge_method:'S256',resource:origin+'/mcp',
    scope:'persistflow',state:'fixture-state',owner_secret:owner,
  })});
  assert.equal((await authorize(serviceKey)).status,401,'old owner key must fail approval');
  assert.equal((await authorize(newOwner)).status,302,'new owner key must approve OAuth');
});

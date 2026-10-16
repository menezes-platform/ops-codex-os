'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createGoogleDriveObjectTransport} = require('../modules/context-store/src/google-drive-object-transport');

const key = 'personal/current/events/' + 'a'.repeat(64) + '.json';
const folderId = 'folder-123ABC';
function response(status, value, extra={}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: {get: () => 'application/json'},
    async json() {return value;},
    async arrayBuffer() {const b=Buffer.from(value); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},
    ...extra
  };
}
function makeApi() {
  const calls = [];
  const files = [];
  let id = 0;
  const fetchImpl = async (url, opts={}) => {
    const u = new URL(url);
    calls.push({url:u, opts});
    if (opts.headers?.Authorization !== 'Bearer test-token') throw Error('TOKEN_LEAK_OR_MISSING');
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') || '';
      const matches = files.filter(f => !q.includes('name = ') || q.includes("'" + f.name + "'"));
      return response(200, {files: matches.map(({id,name,appProperties})=>({id,name,mimeType:'application/octet-stream',parents:[folderId],appProperties})),nextPageToken:null});
    }
    if (u.pathname === '/upload/drive/v3/files') {
      assert.equal(opts.method,'POST');
      assert.equal(u.searchParams.get('uploadType'), 'multipart');
      const payload = Buffer.from(opts.body);
      const marker = Buffer.from('\r\nContent-Type: application/octet-stream\r\n\r\n');
      const start = payload.indexOf(marker);
      assert.ok(start >= 0);
      const after = start + marker.length;
      const end = payload.indexOf(Buffer.from('\r\n--'),after);
      assert.ok(end >= after);
      const head = payload.toString('utf8',0,start);
      const meta = JSON.parse(head.slice(head.indexOf('{'),head.lastIndexOf('}')+1));
      const f = {id: 'file-'+(++id), ...meta, body:payload.subarray(after,end)};
      files.push(f);
      return response(200,{id:f.id,name:f.name,appProperties:f.appProperties,parents:[folderId]});
    }
    const match=/^\/drive\/v3\/files\/(file-[0-9]+)$/.exec(u.pathname);
    if (match && u.searchParams.get('alt')==='media') {
      const f = files.find(f=>f.id===match[1]);
      return f ? response(200,f.body) : response(404,{error:'missing'});
    }
    throw Error('UNEXPECTED_HTTP_PATH');
  };
  return {calls,files,fetchImpl};
}
test('real Drive REST adapter uses private folder, no plaintext name, verified readback and list',async()=>{
  const api=makeApi();
  const transport=createGoogleDriveObjectTransport({
    folderId, getAccessToken:async()=> 'test-token',fetchImpl:api.fetchImpl
  });
  const content=Buffer.from('private synthetic event');
  await transport.putObjectIfAbsent({key,content});
  assert.deepEqual(await transport.getObject({key}),content);
  assert.deepEqual(await transport.listObjectKeys({prefix:'personal/current/events/'}),[key]);
  assert.equal(api.files.length,1);
  assert.match(api.files[0].name,/^ragv1-[a-f0-9]{64}$/);
  assert.equal(api.files[0].appProperties.rag_key,key);
  assert.ok(api.calls.every(c=>!c.url.href.includes('private synthetic event')));
  assert.ok(api.calls.every(c=>c.opts.headers.Authorization==='Bearer test-token'));
});
test('rejects duplicate Drive names rather than choosing arbitrary data',async()=>{
  const api=makeApi();
  const transport=createGoogleDriveObjectTransport({folderId,getAccessToken:async()=> 'test-token',fetchImpl:api.fetchImpl});
  await transport.putObjectIfAbsent({key,content:Buffer.from('good')});
  api.files.push({...api.files[0],id:'file-999',body:Buffer.from('bad')});
  await assert.rejects(transport.getObject({key}),/DRIVE_OBJECT_AMBIGUOUS/);
  await assert.rejects(transport.putObjectIfAbsent({key,content:Buffer.from('good')}),/DRIVE_OBJECT_AMBIGUOUS/);
  await assert.rejects(transport.listObjectKeys({prefix:'personal/current/events/'}),/DRIVE_OBJECT_AMBIGUOUS/);
});
test('denies other lanes, no authentication, and provider failures without exposing secrets',async()=>{
  const api=makeApi();
  const transport=createGoogleDriveObjectTransport({folderId,getAccessToken:async()=> '',fetchImpl:api.fetchImpl});
  await assert.rejects(transport.getObject({key:'projects/a/b/corpus/'+'a'.repeat(64)}),/DRIVE_KEY_DENIED/);
  await assert.rejects(transport.getObject({key}),/DRIVE_AUTH_UNAVAILABLE/);
  assert.equal(api.calls.length,0);
  const failure=createGoogleDriveObjectTransport({folderId,getAccessToken:async()=> 'secret-token',fetchImpl:async()=>response(401,{message:'secret-token'})});
  await assert.rejects(failure.getObject({key}),e=>e.message==='DRIVE_API_UNAVAILABLE' && !e.message.includes('secret-token'));
});
test('personal store uses Drive REST transport for immutable event and receipt, without Engram',async()=>{
  const {createDrivePersonalStore}=require('../modules/context-store/src/drive-personal-store');
  const {createHash}=require('node:crypto');
  const api=makeApi();
  const transport=createGoogleDriveObjectTransport({folderId,getAccessToken:async()=> 'test-token',fetchImpl:api.fetchImpl});
  const store=createDrivePersonalStore({transport});
  const content='A synthetic fact, not personal data';
  const event={event_id:'synthetic-1',scope:'personal/current',kind:'observation',source_type:'manual',
    source_ref:'manual:test',source_revision:'r1',observed_at:'2026-10-15T18:00:00Z',
    content_sha256:'sha256:'+createHash('sha256').update(content).digest('hex'),
    content,consent_receipt_id:'test-consent',schema_version:1};
  const receipt=await store.putEvent({event,idempotency_key:'synthetic-idem'});
  assert.equal(receipt.status,'stored');
  assert.deepEqual((await store.listEvents()).map(e=>e.event_id),['synthetic-1']);
  assert.equal((await store.putEvent({event,idempotency_key:'synthetic-idem'})).status,'replayed');
  assert.equal(api.files.length,2);
});
test('stops oversized streaming downloads before collecting unbounded bytes',async()=>{
  const api=makeApi();
  const original=createGoogleDriveObjectTransport({folderId,getAccessToken:async()=> 'test-token',fetchImpl:api.fetchImpl});
  await original.putObjectIfAbsent({key,content:Buffer.from('tiny')});
  let reads=0;
  const fetchImpl=async(url,opts)=>{
    if(new URL(url).searchParams.get('alt')==='media') return {
      ok:true,
      body:{getReader(){return {
        async read(){reads++; return {done:false,value:Buffer.alloc(9*1024*1024)};},
        async cancel(){}
      };}},
      async arrayBuffer(){throw Error('UNBOUNDED_DOWNLOAD');}
    };
    return api.fetchImpl(url,opts);
  };
  const transport=createGoogleDriveObjectTransport({folderId,getAccessToken:async()=> 'test-token',fetchImpl});
  await assert.rejects(transport.getObject({key}),/DRIVE_OBJECT_TOO_LARGE/);
  assert.equal(reads,2);
});

'use strict';
const {createHash, randomBytes} = require('node:crypto');

// This is a real Google Drive v3 REST adapter, NOT an atomic CAS provider.
// Drive permits duplicate names. Ambiguous keys fail closed; live concurrency
// and authenticated DR gates remain required before authority migration.
const API = 'https://www.googleapis.com';
const KEY = /^personal\/current\/(?:events|receipts)\/[a-f0-9]{64}\.json$/;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PAGES = 100;
function assertKey(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('DRIVE_KEY_DENIED');
  return key;
}
function nameFor(key) {
  return 'ragv1-' + createHash('sha256').update(key).digest('hex');
}
function assertFolderId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{5,128}$/.test(id)) throw new Error('DRIVE_FOLDER_INVALID');
}
function createGoogleDriveObjectTransport({folderId,getAccessToken,fetchImpl=globalThis.fetch}={}) {
  assertFolderId(folderId);
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') throw new Error('DRIVE_AUTH_PROVIDER_REQUIRED');

  async function request(path,{method='GET',headers={},body,media=false}={}) {
    let token;
    try { token=await getAccessToken(); } catch {throw new Error('DRIVE_AUTH_UNAVAILABLE');}
    if (typeof token!=='string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('DRIVE_AUTH_UNAVAILABLE');
    let res;
    try {
      res=await fetchImpl(API + path,{
        method,headers:{Authorization:'Bearer '+token,...headers},body,
        signal:AbortSignal.timeout(30000),redirect:'error'
      });
    } catch { throw new Error('DRIVE_API_UNAVAILABLE'); }
    if (!res || !res.ok) throw new Error('DRIVE_API_UNAVAILABLE');
    try {
      if (media) {
        if(res.body?.getReader){const reader=res.body.getReader(),chunks=[];let total=0;try{for(;;){const part=await reader.read();if(part.done)break;if(!(part.value instanceof Uint8Array))throw new Error('DRIVE_RESPONSE_INVALID');total+=part.value.byteLength;if(total>MAX_BYTES){await reader.cancel();throw new Error('DRIVE_OBJECT_TOO_LARGE');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock?.();}return Buffer.concat(chunks,total);}
        const data=Buffer.from(await res.arrayBuffer());
        if (data.length>MAX_BYTES) throw new Error('DRIVE_OBJECT_TOO_LARGE');
        return data;
      }
      return await res.json();
    } catch(error) {
      if (error.message==='DRIVE_OBJECT_TOO_LARGE') throw error;
      throw new Error('DRIVE_RESPONSE_INVALID');
    }
  }

  function validateFile(f) {
    if (!f || typeof f.id!=='string' || !/^[A-Za-z0-9_-]{1,256}$/.test(f.id) ||
        typeof f.name!=='string' || !/^ragv1-[a-f0-9]{64}$/.test(f.name) ||
        f.mimeType!=='application/octet-stream' ||
        !Array.isArray(f.parents) || !f.parents.includes(folderId) ||
        !f.appProperties || typeof f.appProperties.rag_key!=='string') throw new Error('DRIVE_OBJECT_INVALID');
    const key=assertKey(f.appProperties.rag_key);
    if (nameFor(key)!==f.name) throw new Error('DRIVE_OBJECT_INVALID');
    return {id:f.id,key,name:f.name};
  }
  async function listAll() {
    const all=[];
    const tokens=new Set();
    let pageToken=null;
    for(let page=0;page<MAX_PAGES;page++){
      const params=new URLSearchParams({
        q:"'"+folderId+"' in parents and trashed = false",
        fields:'nextPageToken,files(id,name,mimeType,parents,appProperties)',
        pageSize:'1000'
      });
      if(pageToken) params.set('pageToken',pageToken);
      const result=await request('/drive/v3/files?'+params);
      if(!result || !Array.isArray(result.files) || result.files.length>1000) throw new Error('DRIVE_LIST_INVALID');
      for(const item of result.files){
        if (typeof item.name!=='string' || !item.name.startsWith('ragv1-')) continue;
        all.push(validateFile(item));
        if(all.length>10000) throw new Error('DRIVE_LIST_TOO_LARGE');
      }
      if(!result.nextPageToken){
        const seen=new Set();
        for(const item of all){
          if(seen.has(item.key)) throw new Error('DRIVE_OBJECT_AMBIGUOUS');
          seen.add(item.key);
        }
        return all;
      }
      if(typeof result.nextPageToken!=='string' || result.nextPageToken.length>4096 || tokens.has(result.nextPageToken))
        throw new Error('DRIVE_LIST_INVALID');
      tokens.add(result.nextPageToken);
      pageToken=result.nextPageToken;
    }
    throw new Error('DRIVE_LIST_TOO_LARGE');
  }
  async function lookup(key) {
    assertKey(key);
    // A folder-wide scan also detects duplicate filenames and rejects unknown
    // app-owned keys; this is intentionally conservative, not low-latency.
    const matches=(await listAll()).filter(item=>item.key===key);
    if(matches.length>1) throw new Error('DRIVE_OBJECT_AMBIGUOUS');
    return matches[0]||null;
  }
  async function getObject({key}={}) {
    const found=await lookup(key);
    if(!found) return null;
    const bytes=await request('/drive/v3/files/'+encodeURIComponent(found.id)+'?alt=media',{media:true});
    return bytes;
  }
  async function putObjectIfAbsent({key,content}={}) {
    assertKey(key);
    if(!Buffer.isBuffer(content) && !(content instanceof Uint8Array)) throw new Error('DRIVE_CONTENT_INVALID');
    const bytes=Buffer.from(content);
    if(bytes.length>MAX_BYTES) throw new Error('DRIVE_OBJECT_TOO_LARGE');
    if(await lookup(key)) return {status:'existing'};
    const boundary='rag-'+randomBytes(12).toString('hex');
    const metadata=JSON.stringify({
      name:nameFor(key),mimeType:'application/octet-stream',
      parents:[folderId],appProperties:{rag_key:key}
    });
    const body=Buffer.concat([
      Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+metadata+'\r\n--'+boundary+'\r\nContent-Type: application/octet-stream\r\n\r\n'),
      bytes,Buffer.from('\r\n--'+boundary+'--\r\n')
    ]);
    await request('/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,appProperties',{
      method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body
    });
    // Detect competing creates and eventual readback, never claim atomic CAS.
    const stored=await getObject({key});
    if(!stored || !stored.equals(bytes)) throw new Error('DRIVE_OBJECT_DIGEST_MISMATCH');
    return {status:'stored'};
  }
  async function listObjectKeys({prefix}={}) {
    if(typeof prefix!=='string' || !/^personal\/current\/(?:events|receipts)\/$/.test(prefix))
      throw new Error('DRIVE_PREFIX_DENIED');
    return (await listAll()).filter(f=>f.key.startsWith(prefix)).map(f=>f.key).sort();
  }
  return Object.freeze({getObject,putObjectIfAbsent,listObjectKeys});
}
module.exports={createGoogleDriveObjectTransport};

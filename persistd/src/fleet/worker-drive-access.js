'use strict';
const fs=require('node:fs');
const {signNodeRequest}=require('./auth');
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
function createWorkerDriveAccess({baseUrl,nodeId,secretPath,fetchImpl=globalThis.fetch,now=()=>new Date()}={}){
 let url;
 try {url=new URL(baseUrl);}catch{throw new Error('DRIVE_AUTHORITY_HTTPS_REQUIRED');}
 if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('DRIVE_AUTHORITY_HTTPS_REQUIRED');
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(nodeId||'')))throw new Error('DRIVE_NODE_ID_INVALID');
 if(!secretPath)throw new Error('DRIVE_NODE_SECRET_FILE_REQUIRED');
 const base=url.origin;
 const requestPath='/v1/fleet/nodes/'+encodeURIComponent(nodeId)+'/drive-token';
 let cached=null;
 return async function getAccess(){
  const time=now();
  if(cached && Date.parse(cached.expiresAt)-time.getTime()>60_000)return {...cached};
  const secret=fs.readFileSync(secretPath,'utf8').trim();
  if(!/^[0-9a-f]{64}$/i.test(secret))throw new Error('DRIVE_NODE_SECRET_INVALID');
  const timestamp=time.toISOString(),body='{}';
  const signature=signNodeRequest({nodeId,secret,timestamp,method:'POST',path:requestPath,body});
  const response=await fetchImpl(base+requestPath,{method:'POST',headers:{'content-type':'application/json','x-persistflow-node-id':nodeId,'x-persistflow-node-timestamp':timestamp,'x-persistflow-node-signature':signature},body});
  if(!response.ok)throw new Error('DRIVE_TOKEN_HTTP_'+Number(response.status));
  const value=await response.json();
  if(!value?.accessToken||!value?.rootId||!Number.isFinite(Date.parse(value?.expiresAt||''))||Date.parse(value.expiresAt)-time.getTime()<60_000 || !String(value.scope||'').split(/\s+/).includes(DRIVE_SCOPE))throw new Error('DRIVE_ACCESS_INVALID');
  cached={accessToken:String(value.accessToken),rootId:String(value.rootId),expiresAt:String(value.expiresAt),scope:String(value.scope)};
  return {...cached};
 };
}
module.exports={createWorkerDriveAccess};
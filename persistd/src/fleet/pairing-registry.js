'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const SECRET=/^[a-f0-9]{64}$/i;
function hash(code){return crypto.createHash('sha256').update(String(code),'utf8').digest('hex');}
class PairingRegistry {
 constructor({directory,clock=Date.now,expiryMs=10*60*1000}={}){
  if(!directory)throw new Error('PAIRING_STORAGE_REQUIRED');
  this.directory=directory;this.file=path.join(directory,'pairing.json');
  this.clock=clock;this.expiryMs=expiryMs;
 }
 read(){
  try{
   const value=JSON.parse(fs.readFileSync(this.file,'utf8'));
   if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('PAIRING_STORE_CORRUPT');
   if(!value.invitations||!value.nodes)throw new Error('PAIRING_STORE_CORRUPT');
   return value;
  }catch(e){if(e.code==='ENOENT')return {schema:1,invitations:{},nodes:{}};throw e;}
 }
 write(value){
  fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
  const temp=this.file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});fs.renameSync(temp,this.file);}catch(e){try{fs.rmSync(temp,{force:true});}catch{}throw e;}
 }
 issue(){
  const value=this.read(),now=this.clock();
  for(const [digest,invitation] of Object.entries(value.invitations))if(invitation.expiresAtMs<now)delete value.invitations[digest];
  const pairingCode=crypto.randomBytes(24).toString('base64url');
  const expiresAtMs=now+this.expiryMs;
  value.invitations[hash(pairingCode)]={expiresAtMs};
  this.write(value);
  return {pairingCode,expiresAt:new Date(expiresAtMs).toISOString()};
 }
 enroll({pairingCode,nodeId,secret}={}){
  if(!ID.test(String(nodeId||'')))throw new Error('PAIRING_NODE_ID_INVALID');
  if(!SECRET.test(String(secret||'')))throw new Error('PAIRING_NODE_SECRET_INVALID');
  const value=this.read(),key=hash(pairingCode||'');
  const invitation=value.invitations[key];
  if(!invitation)throw new Error('PAIRING_CODE_INVALID');
  if(invitation.expiresAtMs<=this.clock())throw new Error('PAIRING_CODE_EXPIRED');
  if(Object.hasOwn(value.nodes,nodeId))throw new Error('PAIRING_NODE_ALREADY_REGISTERED');
  const node={id:nodeId,platform:'win32',arch:'unknown',capabilities:['git','node'],affinities:['background','tests'],concurrencyLimit:1,drained:true};
  value.nodes[nodeId]={node,secret:String(secret),joinedAt:new Date(this.clock()).toISOString()};
  delete value.invitations[key];
  this.write(value);
  return {node};
 }
 mergeInto(fleetConfig,fleetNodeSecrets){
  const registry=this.read(),ids=new Set((fleetConfig.nodes||[]).map(n=>n.id));
  for(const [id,value] of Object.entries(registry.nodes)){
   if(ids.has(id)||Object.hasOwn(fleetNodeSecrets,id)||!ID.test(id)||!SECRET.test(value.secret))throw new Error('PAIRING_NODE_CONFLICT');
  }
  for(const [id,value] of Object.entries(registry.nodes)){
   // Even after restart/persisted corruption, enrolled nodes never become schedulable.
   fleetConfig.nodes.push({...value.node,id,drained:true});
   fleetNodeSecrets[id]=value.secret;
  }
 }
}
module.exports={PairingRegistry};
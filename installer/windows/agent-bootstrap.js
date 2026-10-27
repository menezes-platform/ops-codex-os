'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {runAgent}=require('./node-agent');
function loadIdentity(dir=__dirname){
 const config=JSON.parse(fs.readFileSync(path.join(dir,'worker-config.json'),'utf8').replace(/^\uFEFF/,''));
 const secret=fs.readFileSync(path.join(dir,'..','node-secret.txt'),'utf8').trim();
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(config.nodeId||'')))throw new Error('INVALID_NODE_ID');
 const url=new URL(config.baseUrl);
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('INVALID_AUTHORITY_URL');
 if(!/^[0-9a-f]{64}$/i.test(secret))throw new Error('INVALID_NODE_SECRET');
 return {nodeId:config.nodeId,baseUrl:url.origin,secret};
}
async function main(){
 const identity=loadIdentity();
 process.env.PERSISTFLOW_FLEET_NODE_SECRET=identity.secret;
 process.env.PERSISTFLOW_FLEET_NODE_ID=identity.nodeId;
 process.env.PERSISTFLOW_BASE_URL=identity.baseUrl;
 process.env.PERSISTFLOW_FLEET_CAPABILITIES='git,node';
 await runAgent();
}
if(require.main===module)main().catch(err=>{process.stderr.write('FLEET_AGENT_EXIT: '+String(err?.code||err?.message||'unknown')+'\n');process.exitCode=1;});
module.exports={loadIdentity,main};
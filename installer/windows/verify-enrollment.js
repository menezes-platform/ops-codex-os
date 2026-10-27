'use strict';
const {loadIdentity}=require('./agent-bootstrap');
const {collectHeartbeat,postHeartbeat}=require('./node-agent');
(async()=>{
 const {nodeId,baseUrl,secret}=loadIdentity();
 const heartbeat=await collectHeartbeat();
 await postHeartbeat({baseUrl,nodeId,secret,heartbeat});
 process.stdout.write('FLEET_HEARTBEAT_ACCEPTED\n');
})().catch(err=>{process.stderr.write('ENROLLMENT_NOT_READY: '+String(err?.code||err?.message||'unknown')+'\n');process.exitCode=1;});
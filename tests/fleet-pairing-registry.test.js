'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PairingRegistry}=require('../persistd/src/fleet/pairing-registry');
function registry(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-pair-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,store:new PairingRegistry({directory:dir,clock:()=>Date.parse('2026-10-27T22:00:00Z')})};}
test('invitation has 10m expiry, strong random pairing token, and no plaintext in persisted records',t=>{
 const {dir,store}=registry(t);const {pairingCode,expiresAt}=store.issue();
 assert.ok(pairingCode.length>=32);assert.equal(Date.parse(expiresAt),Date.parse('2026-10-27T22:10:00Z'));
 const raw=fs.readFileSync(path.join(dir,'pairing.json'),'utf8');
 assert.equal(raw.includes(pairingCode),false);
});
test('invited machine joins drained and survives authority restart',t=>{
 const {dir,store}=registry(t);const {pairingCode}=store.issue();const secret=crypto.randomBytes(32).toString('hex');
 const entry=store.enroll({pairingCode,nodeId:'node-foo',secret});
 assert.equal(entry.node.drained,true);assert.deepEqual(entry.node.capabilities,['git','node']);
 const after=new PairingRegistry({directory:dir});const fleetConfig={nodes:[]},fleetNodeSecrets={};
 after.mergeInto(fleetConfig,fleetNodeSecrets);
 assert.equal(fleetConfig.nodes[0].drained,true);assert.equal(fleetConfig.nodes[0].id,'node-foo');assert.equal(fleetNodeSecrets['node-foo'],secret);
 assert.equal(fs.readFileSync(path.join(dir,'pairing.json'),'utf8').includes(secret),true);
});
test('pairing code cannot be replayed and a node cannot silently replace existing identity',t=>{
 const {store}=registry(t);const invite=store.issue();const secret=crypto.randomBytes(32).toString('hex');
 store.enroll({pairingCode:invite.pairingCode,nodeId:'node-foo',secret});
 assert.throws(()=>store.enroll({pairingCode:invite.pairingCode,nodeId:'node-second',secret}),/PAIRING_CODE_INVALID/);
 const second=store.issue();assert.throws(()=>store.enroll({pairingCode:second.pairingCode,nodeId:'node-foo',secret:crypto.randomBytes(32).toString('hex')}),/PAIRING_NODE_ALREADY_REGISTERED/);
});
test('invalid credentials, expired code, bad node names are rejected',t=>{
 const {dir,store}=registry(t);const {pairingCode}=store.issue();
 assert.throws(()=>store.enroll({pairingCode:'not-valid',nodeId:'node-foo',secret:'a'.repeat(64)}),/PAIRING_CODE_INVALID/);
 assert.throws(()=>store.enroll({pairingCode,nodeId:'UPPER_BAD',secret:'a'.repeat(64)}),/PAIRING_NODE_ID_INVALID/);
 assert.throws(()=>store.enroll({pairingCode,nodeId:'node-ok',secret:'bad'}),/PAIRING_NODE_SECRET_INVALID/);
 const future=new PairingRegistry({directory:dir,clock:()=>Date.parse('2026-10-27T22:11:00Z')});
 assert.throws(()=>future.enroll({pairingCode,nodeId:'node-ok',secret:'a'.repeat(64)}),/PAIRING_CODE_EXPIRED/);
});
test('merge refuses configured node collision with persisted node, without overwriting static secrets',t=>{
 const {store}=registry(t),pair=store.issue(),secret='a'.repeat(64);
 store.enroll({pairingCode:pair.pairingCode,nodeId:'node-foo',secret});
 const fleetConfig={nodes:[{id:'node-foo',drained:false}]},fleetNodeSecrets={'node-foo':'b'.repeat(64)};
 assert.throws(()=>store.mergeInto(fleetConfig,fleetNodeSecrets),/PAIRING_NODE_CONFLICT/);
 assert.equal(fleetNodeSecrets['node-foo'],'b'.repeat(64));
});
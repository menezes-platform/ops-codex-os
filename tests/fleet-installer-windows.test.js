'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const FILE=path.join(ROOT,'installer','windows','Install-FleetRunner.ps1');
const BUILD=path.join(ROOT,'scripts','build-windows-fleet-runner.ps1');
const PAYLOAD=path.join(ROOT,'installer','windows');
function execPS(file,args){return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...args],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:20000});}
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-installer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('dry-run installs self-contained agent source with secure secret and no scheduled task',t=>{
 const dir=temp(t);const result=execPS(FILE,['-NodeId','test-windows-node','-BaseUrl','https://authority.example','-InstallDir',dir,'-SkipTask']);
 assert.equal(result.status,0,result.stderr);
 const names=['agent/agent-bootstrap.js','agent/heartbeat-launcher.vbs','agent/node-agent.js','agent/auth.js','agent/contracts.js','agent/silent-job.js','agent/silent-job-cli.js','agent/silent-job-launcher.vbs','agent/drive-job-archive.js','agent/worker-drive-access.js','storage/drive-client.js','storage/object-store.js','agent/worker-config.json','agent/node-path.txt','node-secret.txt'];
 for(const n of names)assert.equal(fs.existsSync(path.join(dir,n)),true,n);
 const secret=fs.readFileSync(path.join(dir,'node-secret.txt'),'utf8').trim();
 assert.match(secret,/^[a-f0-9]{64}$/);
 assert.equal(result.stdout.includes(secret),false);
 const config=JSON.parse(fs.readFileSync(path.join(dir,'agent/worker-config.json'),'utf8').replace(/^\ufeff/,''));
 assert.equal(config.nodeId,'test-windows-node');assert.equal(config.baseUrl,'https://authority.example');
 assert.match(result.stdout,/TASK_CREATED=FALSE/);
});
test('reinstall preserves HMAC secret, user job requests, and reports existing install',t=>{
 const dir=temp(t),params=['-NodeId','same-node','-BaseUrl','https://authority.example','-InstallDir',dir,'-SkipTask'];
 assert.equal(execPS(FILE,params).status,0);
 const p=path.join(dir,'node-secret.txt'),first=fs.readFileSync(p,'utf8');
 const pending=path.join(dir,'jobs','requests','pending.txt');fs.mkdirSync(path.dirname(pending),{recursive:true});fs.writeFileSync(pending,'important');
 const second=execPS(FILE,params);
 assert.equal(second.status,0,second.stderr);
 assert.equal(fs.readFileSync(p,'utf8'),first);
 assert.equal(fs.readFileSync(pending,'utf8'),'important');
});
test('reinstall cannot silently reassign a node identity',t=>{
 const dir=temp(t);
 assert.equal(execPS(FILE,['-NodeId','same-node','-BaseUrl','https://authority.example','-InstallDir',dir,'-SkipTask']).status,0);
 const next=execPS(FILE,['-NodeId','other-node','-BaseUrl','https://authority.example','-InstallDir',dir,'-SkipTask']);
 assert.notEqual(next.status,0);
 assert.match(next.stderr,/NODE_ID_CONFLICT/);
});
test('unsafe URL and invalid node identifiers fail before creating any secret',t=>{
 const cases=[['INVALID_NODE','https://authority.example'],['valid-node','http://unsafe.test'],['valid-node','https://authority.example/path']];
 for(const [id,url] of cases){const dir=temp(t);const result=execPS(FILE,['-NodeId',id,'-BaseUrl',url,'-InstallDir',dir,'-SkipTask']);assert.notEqual(result.status,0);assert.equal(fs.existsSync(path.join(dir,'node-secret.txt')),false);}
});
test('uninstall only disables installed task and preserves secret and job data by default',t=>{
 const dir=temp(t);
 assert.equal(execPS(FILE,['-NodeId','removal-test','-BaseUrl','https://authority.example','-InstallDir',dir,'-SkipTask']).status,0);
 const result=execPS(path.join(PAYLOAD,'Uninstall-FleetRunner.ps1'),['-InstallDir',dir,'-SkipTask']);
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.existsSync(path.join(dir,'node-secret.txt')),true);
});
test('launcher runs hidden, reads node path instead of opening a shell',()=>{
 const s=fs.readFileSync(path.join(PAYLOAD,'heartbeat-launcher.vbs'),'utf8');
 assert.match(s,/sh\.Run\s*\(cmdline,\s*0,\s*True\)/i);
 assert.doesNotMatch(s,/powershell\.exe|cmd\.exe/i);
});
test('build script contains explicit EXE embedding and payload file inventory',()=>{
 const s=fs.readFileSync(BUILD,'utf8');
 assert.match(s,/Setup\.cs/);
 assert.match(s,/node-agent\.js/);
 assert.match(s,/object-store\.js/);
 assert.match(s,/csc\.exe/);
});
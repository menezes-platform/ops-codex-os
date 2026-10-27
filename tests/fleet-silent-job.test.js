const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSilentJob } = require('../persistd/src/fleet/silent-job');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-silent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('runs a bounded Node job without a console and persists output and receipt', async (t) => {
  const root = sandbox(t);
  const result = await runSilentJob({ taskId:'probe-1', tool:'node', args:['-e', 'process.stdout.write("silent-ok")'], cwd: root, allowedRoot: root, logRoot: path.join(root, 'logs') });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.windowsHide, true);
  assert.equal(result.shell, false);
  assert.equal(fs.readFileSync(result.stdoutPath,'utf8'), 'silent-ok');
  assert.equal(JSON.parse(fs.readFileSync(result.receiptPath,'utf8')).taskId, 'probe-1');
});

test('rejects any request that requires graphical interaction', async (t) => {
  const root = sandbox(t);
  await assert.rejects(runSilentJob({ taskId:'ui-1', tool:'node', args:['-e','0'], cwd:root, allowedRoot:root, requiresInteractiveUi:true }), /SILENT_JOB_INTERACTIVE_FORBIDDEN/);
  await assert.rejects(runSilentJob({ taskId:'browser-1', tool:'node', args:['-e','0'], cwd:root, allowedRoot:root, requiresBrowserSession:true }), /SILENT_JOB_INTERACTIVE_FORBIDDEN/);
});

test('rejects shell, powershell, and arbitrary tool names', async (t) => {
  const root = sandbox(t);
  for (const tool of ['cmd.exe','powershell.exe','pwsh.exe','explorer.exe','npm.cmd','evil']) {
    await assert.rejects(runSilentJob({ taskId:'bad', tool, args:[], cwd:root, allowedRoot:root }), /SILENT_JOB_TOOL_FORBIDDEN/);
  }
  await assert.rejects(runSilentJob({ taskId:'shell-1', tool:'node', args:['-e','0'], shell:true, cwd:root, allowedRoot:root }), /SILENT_JOB_SHELL_FORBIDDEN/);
});

test('enforces a working directory within the trusted workspace', async (t) => {
  const root=sandbox(t);
  const outside=sandbox(t);
  await assert.rejects(runSilentJob({ taskId:'escape-1',tool:'node',args:['-e','0'],cwd:outside,allowedRoot:root }),/SILENT_JOB_CWD_OUTSIDE_ROOT/);
});

test('enforces duration and records the failure without a foreground window', async (t) => {
  const root = sandbox(t);
  const result=await runSilentJob({taskId:'timeout-1',tool:'node',args:['-e','setInterval(()=>{}, 1000)'],cwd:root,allowedRoot:root,logRoot:path.join(root,'logs'),timeoutMs:350});
  assert.equal(result.status,'timeout');
  assert.equal(result.windowsHide,true);
});

test('limits log size and marks output truncation while draining the child', async (t) => {
  const root = sandbox(t);
  const result=await runSilentJob({taskId:'spam-1',tool:'node',args:['-e','process.stdout.write("X".repeat(25000))'],cwd:root,allowedRoot:root,logRoot:path.join(root,'logs'),maxOutputBytes:1024});
  assert.equal(result.status,'completed');
  assert.equal(result.truncated,true);
  assert.equal(fs.statSync(result.stdoutPath).size,1024);
});

test('records a nonzero exit as failure', async (t) => {
 const root = sandbox(t);
 const result=await runSilentJob({taskId:'fail-1',tool:'node',args:['-e','process.exit(3)'],cwd:root,allowedRoot:root,logRoot:path.join(root,'logs')});
 assert.equal(result.status,'failed');
 assert.equal(result.exitCode,3);
});

test('does not expose a Fleet HMAC secret to job child process',async (t)=>{
 const root=sandbox(t);
 const prior=process.env.PERSISTFLOW_FLEET_NODE_SECRET;
 process.env.PERSISTFLOW_FLEET_NODE_SECRET='sensitive-test-not-a-real-secret';
 try{
 const result=await runSilentJob({taskId:'secret-1',tool:'node',args:['-e','process.stdout.write(process.env.PERSISTFLOW_FLEET_NODE_SECRET || "ABSENT")'],cwd:root,allowedRoot:root,logRoot:path.join(root,'logs')});
 assert.equal(fs.readFileSync(result.stdoutPath,'utf8'),'ABSENT');
 }finally{if(prior===undefined)delete process.env.PERSISTFLOW_FLEET_NODE_SECRET;else process.env.PERSISTFLOW_FLEET_NODE_SECRET=prior;}
});

test('the command launcher uses WScript hidden mode and no cmd/PowerShell',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../persistd/src/fleet/silent-job-launcher.vbs'),'utf8');
 assert.match(source,/\.Run\(cmdline,\s*0,\s*True\)/);
 assert.doesNotMatch(source,/cmd\.exe|powershell\.exe|pwsh\.exe/i);
});

test('one manifest runs silently with a local trusted CLI and a replay gets rejected', async t=>{
 const root=sandbox(t);
 const manifest=path.join(root,'smoke.json');
 fs.writeFileSync(manifest,JSON.stringify({taskId:'cli-smoke',tool:'node',args:['-e','process.stdout.write("cli-ok")'],cwd:root}));
 const cli=path.join(__dirname,'../persistd/src/fleet/silent-job-cli.js');
 const {spawnSync}=require('node:child_process');
 const first=spawnSync(process.execPath,[cli,manifest],{env:{...process.env,FLEET_SILENT_JOB_ROOT:root},encoding:'utf8',windowsHide:true});
 assert.equal(first.status,0,first.stderr);
 assert.equal(fs.readFileSync(path.join(root,'logs','cli-smoke','stdout.log'),'utf8'),'cli-ok');
 const second=spawnSync(process.execPath,[cli,manifest],{env:{...process.env,FLEET_SILENT_JOB_ROOT:root},encoding:'utf8',windowsHide:true});
 assert.notEqual(second.status,0);
 assert.match(second.stderr,/EEXIST/);
});

test('CLI rejects manifests outside trusted workspace',t=>{
 const root=sandbox(t);
 const outside=sandbox(t);
 const manifest=path.join(outside,'malicious.json');
 fs.writeFileSync(manifest,JSON.stringify({taskId:'bad',tool:'node',args:['-e','0'],cwd:outside}));
 const {spawnSync}=require('node:child_process');
 const cli=path.join(__dirname,'../persistd/src/fleet/silent-job-cli.js');
 const result=spawnSync(process.execPath,[cli,manifest],{env:{...process.env,FLEET_SILENT_JOB_ROOT:root},encoding:'utf8',windowsHide:true});
 assert.equal(result.status,1);
 assert.match(result.stderr,/SILENT_JOB_MANIFEST_OUTSIDE_ROOT/);
});

test('Windows PowerShell UTF-8 BOM manifests are accepted without a visible shell',t=>{
 const root=sandbox(t);
 const manifest=path.join(root,'bom.json');
 fs.writeFileSync(manifest,'\ufeff'+JSON.stringify({taskId:'bom-smoke',tool:'node',args:['-e','process.stdout.write("BOM_OK")'],cwd:root}));
 const {spawnSync}=require('node:child_process');
 const cli=path.join(__dirname,'../persistd/src/fleet/silent-job-cli.js');
 const result=spawnSync(process.execPath,[cli,manifest],{env:{...process.env,FLEET_SILENT_JOB_ROOT:root},encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.readFileSync(path.join(root,'logs','bom-smoke','stdout.log'),'utf8'),'BOM_OK');
});

test('Windows Store Python alias is rejected rather than spawning a graphical installer',t=>{
 const root=sandbox(t);
 const {prepareSilentJob}=require('../persistd/src/fleet/silent-job');
 const old=process.env.FLEET_PYTHON_EXE;
 try{
  delete process.env.FLEET_PYTHON_EXE;
  assert.throws(()=>prepareSilentJob({taskId:'python-missing',tool:'python',args:['--version'],cwd:root,allowedRoot:root}),/SILENT_JOB_PYTHON_NOT_CONFIGURED/);
  process.env.FLEET_PYTHON_EXE='C:\\Users\\ODETE\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe';
  assert.throws(()=>prepareSilentJob({taskId:'python-alias',tool:'python',args:['--version'],cwd:root,allowedRoot:root}),/SILENT_JOB_PYTHON_NOT_CONFIGURED/);
 }finally{if(old===undefined)delete process.env.FLEET_PYTHON_EXE;else process.env.FLEET_PYTHON_EXE=old;}
});

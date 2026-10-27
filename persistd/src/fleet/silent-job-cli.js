'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runSilentJob} = require('./silent-job');

function inside(root, target) {
 const rel = path.relative(root,target);
 return rel === '' || (rel !== '..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel));
}

async function main(args = process.argv.slice(2), env = process.env) {
 const localData = env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local');
 const root = fs.realpathSync(env.FLEET_SILENT_JOB_ROOT || path.join(localData,'ConthabilFleet','jobs'));
 if(args.length !== 1 || !args[0]) throw new Error('SILENT_JOB_MANIFEST_REQUIRED');
 const manifestPath = fs.realpathSync(path.resolve(args[0]));
 if(!inside(root,manifestPath)) throw new Error('SILENT_JOB_MANIFEST_OUTSIDE_ROOT');
 const job = JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/, ''));
 const receipt = await runSilentJob({
  ...job,
  allowedRoot: root,
  logRoot: path.join(root,'logs'),
 });
 process.stdout.write(JSON.stringify({taskId:receipt.taskId,status:receipt.status,receiptPath:receipt.receiptPath})+'\n');
 if(receipt.status !== 'completed') process.exitCode = 1;
 return receipt;
}

if(require.main === module) main().catch(error=>{
 process.stderr.write('SILENT_JOB_REJECTED: '+String(error?.code || error?.message || 'unknown')+'\n');
 process.exitCode=1;
});
module.exports={main};

'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {createArchive,restoreArchive}=require('../scripts/rehearse-native-recovery');
test('complete filesystem archive restores exact bytes and rejects tampering before writes',async()=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'rag-backup-'));
 try{
  const source=path.join(base,'source'),restored=path.join(base,'restored');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'qualification.json'),JSON.stringify({scope:'project/rag-validation/aurora',mode:'local-native-hybrid'}));
  await fs.mkdir(path.join(source,'corpus'));await fs.writeFile(path.join(source,'corpus','public.txt'),'Verificação SHA-256 após interrupção.');
  const archive=await createArchive(source);
  await restoreArchive({bytes:archive.bytes,expectedSha256:archive.sha256,root:restored});
  assert.equal(await fs.readFile(path.join(restored,'corpus','public.txt'),'utf8'),'Verificação SHA-256 após interrupção.');
  const tampered=Buffer.from(archive.bytes);tampered[20]^=1;
  const badRoot=path.join(base,'bad');
  await assert.rejects(restoreArchive({bytes:tampered,expectedSha256:archive.sha256,root:badRoot}),/BACKUP_DIGEST_MISMATCH/);
  await assert.rejects(fs.stat(badRoot),{code:'ENOENT'});
 }finally{await fs.rm(base,{recursive:true,force:true})}
});

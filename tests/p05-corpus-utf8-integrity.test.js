'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const sha=content=>'sha256:'+createHash('sha256').update(content).digest('hex');

test('materialization refuses malformed UTF-8 even when raw bytes match a forged manifest digest',async()=>{
 const scope='project/demo/alpha';
 const badBytes=Buffer.from([0xc3,0x28]);
 const docRef=sha(badBytes);
 const canonical={schema_version:1,scope,source_revision:'rev-1',documents:[{source_ref:'git:alpha:README.md',path:'README.md',content_sha256:docRef}]};
 const manifestRef=sha(JSON.stringify(canonical));
 const manifest={...canonical,corpus_manifest_ref:manifestRef};
 const objects=new Map([
  ['projects/demo/alpha/manifests/'+manifestRef.slice(7)+'.json',Buffer.from(JSON.stringify(manifest))],
  ['projects/demo/alpha/corpus/'+docRef.slice(7),badBytes],
 ]);
 const store=createDriveCorpusStore({transport:{
  async putObjectIfAbsent(){throw new Error('writes forbidden')},
  async getObject({key}){return objects.get(key)||null;},
 }});
 await assert.rejects(store.readCorpusProjection({scope,corpus_manifest_ref:manifestRef}),/CORPUS_OBJECT_INVALID_UTF8/);
});

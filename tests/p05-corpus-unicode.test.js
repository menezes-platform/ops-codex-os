'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCorpusManifest}=require('../modules/context-store/src/corpus-manifest');
const {createDriveCorpusStore}=require('../modules/context-store/src/drive-corpus-store');
const good={scope:'project/demo/alpha',source_revision:'rev-1',documents:[{source_ref:'git:alpha:README.md',path:'README.md',content:'Hello world'}]};

test('ill-formed UTF-16 metadata and content are rejected before hash canonicalization',()=>{
 const bad='\uD800';
 const scenarios=[
  [{...good,source_revision:'revision-'+bad},/SOURCE_REVISION_REQUIRED/],
  [{...good,documents:[{...good.documents[0],source_ref:'git:alpha:'+bad}]},/SOURCE_REF_REQUIRED/],
  [{...good,documents:[{...good.documents[0],path:'docs/'+bad}]},/CORPUS_DOCUMENT_INVALID/],
  [{...good,documents:[{...good.documents[0],content:'prefix'+bad+'suffix'}]},/DOCUMENT_CONTENT_REQUIRED/],
 ];
 for(const [input,code] of scenarios)assert.throws(()=>createCorpusManifest(input),code);
});

test('ill-formed corpus input must not produce immutable objects',async()=>{
 const writes=[];
 const store=createDriveCorpusStore({transport:{
  async getObject(){return null;},
  async putObjectIfAbsent({key}){writes.push(key);},
 }});
 await assert.rejects(store.putCorpusProjection({...good,idempotency_key:'key-a',documents:[{...good.documents[0],content:'\uDFFF'}]}),/DOCUMENT_CONTENT_REQUIRED/);
 await assert.rejects(store.putCorpusProjection({...good,idempotency_key:'key-\uD800'}),/IDEMPOTENCY_KEY_INVALID/);
 assert.equal(writes.length,0);
});

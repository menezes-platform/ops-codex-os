'use strict';
const {normalizeMemoryEvent}=require('../modules/context-store/src/personal-event-schema');
const {createContextGateway}=require('../modules/context-gateway/src');
// Offline-only BM25 adapter for smoke tests, NOT the production Rust/FAISS Execution Plane.
function tokenize(value){
 return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{2,}/g)||[];
}
function localBM25(events,query){
 const terms=[...new Set(tokenize(query))], corpus=events.map(e=>tokenize(e.content));
 const n=corpus.length, avg=corpus.reduce((a,b)=>a+b.length,0)/(n||1);
 const scored=events.map((event,i)=>{
  const frequency=new Map();
  for(const word of corpus[i]) frequency.set(word,(frequency.get(word)||0)+1);
  let score=0;
  for(const word of terms){
   const tf=frequency.get(word)||0;if(!tf)continue;
   const df=corpus.filter(tokens=>tokens.includes(word)).length;
   const idf=Math.log(1+(n-df+0.5)/(df+0.5));
   const length=corpus[i].length,k1=1.2,b=.75;
   score+=idf*tf*(k1+1)/(tf+k1*(1-b+b*length/(avg||1)));
  }
  return {event,score};
 });
 return scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||
  b.event.observed_at.localeCompare(a.event.observed_at)||a.event.event_id.localeCompare(b.event.event_id));
}
async function runControlledRecallSmoke({driveFixture,indexFixture}={}){
 if(!indexFixture||indexFixture.allowedScope!=='personal/current')throw new Error('SCOPE_DENIED');
 if(typeof indexFixture.query!=='string'||!indexFixture.query.trim()||indexFixture.query.length>1000)
  throw new Error('QUERY_INVALID');
 if(!driveFixture||typeof driveFixture.listEvents!=='function')throw new Error('DRIVE_FIXTURE_REQUIRED');
 const owner={verified:true,principal_id:'smoke-local-owner'};
 const gateway=createContextGateway({
  resolveProjectScope:async()=> 'project/smoke/local',resolvePersonalOwner:async()=>owner,
  executionPlaneClient:{
   async indexProject(){throw new Error('NO_INDEX_MUTATION');},
   async retrieve({scope,query}){
    if(scope!=='personal/current')throw new Error('SCOPE_DENIED');
    let events=await driveFixture.listEvents();
    if(!Array.isArray(events)||events.length>1000)throw new Error('CORPUS_INVALID');
    events=events.map(normalizeMemoryEvent).filter(e=>e.scope==='personal/current'&&e.kind!=='tombstone');
    const tombstones=new Set((await driveFixture.listEvents()).filter(e=>e.kind==='tombstone').map(e=>e.content));
    events=events.filter(e=>!tombstones.has(e.event_id));
    const ranked=localBM25(events,query);
    const selected=ranked.slice(0,1).map(x=>({
     evidence_id:x.event.event_id,scope:'personal/current',owner_principal_id:owner.principal_id,
     source_ref:x.event.source_ref,source_revision:x.event.source_revision,
     observed_at:x.event.observed_at,generation_id:'offline-1',
     content:x.event.content,content_sha256:x.event.content_sha256,retrieval_method:'bm25'
    }));
    return {status:'ok',revision:selected[0]?.source_revision||'r1',generation_id:'offline-1',evidence:selected};
   }
  }
 });
 const result=await gateway.answerWithContext({
   userIntent:{text:indexFixture.query,domain:'personal'},historyReferences:true,
   answerProducer:async({evidence})=>evidence[0]?.content||null
 });
 return Object.freeze({status:result.receipt.status,evidence_count:result.receipt.evidence_count||0,
  index_backend:'local-bm25-only',mode:'offline_synthetic_smoke'});
}
module.exports={runControlledRecallSmoke,localBM25};
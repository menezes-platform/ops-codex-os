const crypto = require('node:crypto');
const { eligibleNodes } = require('./eligibility');

const OPERATIONS = Object.freeze({
  'desktop.status': [], 'desktop.screenshot': ['kind', 'ref'], 'desktop.windows.list': [],
  'desktop.window.inspect': ['ref'], 'desktop.ui.inspect': ['window_ref', 'max_depth', 'max_nodes'],
  'desktop.files.list': ['offset', 'limit'], 'desktop.files.stat': ['name'], 'desktop.files.preview': ['name'],
});
const CODES = new Set(['OBSERVATION_DISABLED','WINDOWS_USER_MISMATCH','DESKTOP_HOST_UNAVAILABLE','SESSION_LOCKED',
  'SESSION_CHANGED','DESKTOP_FOLDER_UNAVAILABLE','DESKTOP_PATH_DENIED','DESKTOP_FILE_PROTECTED','PREVIEW_UNSUPPORTED',
  'PREVIEW_TOO_LARGE','SCREENSHOT_TOO_LARGE','INVALID_SCREENSHOT_TARGET','INVALID_ARGUMENTS','INVALID_UI_LIMIT',
  'STALE_WINDOW_REF','WINDOW_NOT_FOUND','DESKTOP_SERVICE_UNAVAILABLE','UIA_TIMEOUT','UIA_PROVIDER_UNAVAILABLE',
  'OBSERVATION_FAILED','OBSERVATION_TIMEOUT','OBSERVATION_OPERATION_DENIED','OBSERVATION_UNSUPPORTED','INVALID_IMAGE',
  'DESKTOP_DIRECTORY_TOO_LARGE','AUTH_REQUIRED','RESPONSE_TOO_LARGE','OBSERVATION_RATE_LIMIT']);
function argsValid(operation, args) {
  if (!Object.hasOwn(OPERATIONS, operation) || !args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(k => !OPERATIONS[operation].includes(k))) throw Error('INVALID_OBSERVATION_REQUEST');
  for (const [key,value] of Object.entries(args)) {
    if (['offset','limit','max_depth','max_nodes'].includes(key)) {
      const range={offset:[0,1000],limit:[1,100],max_depth:[0,5],max_nodes:[1,100]}[key];
      if (!Number.isInteger(value) || value<range[0] || value>range[1]) throw Error('INVALID_OBSERVATION_REQUEST');
    } else if (typeof value!=='string' || value.length<1 || value.length>255) throw Error('INVALID_OBSERVATION_REQUEST');
  }
  if (operation==='desktop.screenshot' && (!['virtual_desktop','monitor','window'].includes(args.kind || 'virtual_desktop')
    || ['monitor','window'].includes(args.kind) && !args.ref || (!args.kind || args.kind==='virtual_desktop') && args.ref)) throw Error('INVALID_OBSERVATION_REQUEST');
  if (operation==='desktop.window.inspect' && !args.ref || operation==='desktop.ui.inspect' && !args.window_ref
    || ['desktop.files.stat','desktop.files.preview'].includes(operation) && (!args.name || /[\\/:\0]|^\.\.?$/.test(args.name))) throw Error('INVALID_OBSERVATION_REQUEST');
  return args;
}
function validateResult(operation,result,now=Date.now()) {
  if (!result || typeof result!=='object' || Array.isArray(result) || Buffer.byteLength(JSON.stringify(result))>2*1024*1024) throw Error('INVALID_OBSERVATION_RESULT');
  if (operation==='desktop.screenshot') {
    if(Object.keys(result).some(k=>!['mimeType','data','width','height','sourceBounds','capturedAt','expiresAt','evidenceId','coordinateSpace'].includes(k))
      || result.coordinateSpace!=='physical_pixels' || !result.sourceBounds || typeof result.sourceBounds!=='object'
      || !['X','Y','Width','Height'].every(k=>Number.isInteger(result.sourceBounds[k]))
      || result.sourceBounds.Width<1 || result.sourceBounds.Height<1 || result.sourceBounds.Width*result.sourceBounds.Height>16000000) throw Error('INVALID_OBSERVATION_RESULT');
    if (result.mimeType!=='image/png' || typeof result.data!=='string' || result.data.length>1398104 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)) throw Error('INVALID_OBSERVATION_RESULT');
    const bytes=Buffer.from(result.data,'base64');
    if (bytes.toString('base64')!==result.data || bytes.length<45 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      || bytes.toString('ascii',12,16)!=='IHDR' || bytes.readUInt32BE(16)!==result.width || bytes.readUInt32BE(20)!==result.height
      || !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width<1 || result.height<1 || result.width>1600 || result.height>1600
      || bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND'
      || typeof result.capturedAt!=='string' || typeof result.expiresAt!=='string' || !Number.isFinite(Date.parse(result.expiresAt))
      || !Number.isFinite(Date.parse(result.capturedAt)) || Math.abs(now-Date.parse(result.capturedAt))>30000
      || Date.parse(result.expiresAt)<=now || Date.parse(result.expiresAt)>Date.parse(result.capturedAt)+30000
      || typeof result.evidenceId!=='string' || !/^[a-f0-9]{32}$/.test(result.evidenceId)) throw Error('INVALID_OBSERVATION_RESULT');
  } else {
    const object=value=>value && typeof value==='object' && !Array.isArray(value);
    const keys=(value,allowed)=>object(value) && Object.keys(value).every(k=>allowed.includes(k));
    const text=(value,max=1024)=>typeof value==='string' && value.length<=max;
    const bounds=b=>keys(b,['X','Y','Width','Height']) && ['X','Y','Width','Height'].every(k=>Number.isInteger(b[k])) && b.Width>0 && b.Height>0;
    const window=w=>keys(w,['Ref','ProcessId','ProcessName','Title','Bounds','State','Foreground']) && text(w.Ref,255)
      && Number.isInteger(w.ProcessId) && text(w.ProcessName) && text(w.Title) && bounds(w.Bounds) && text(w.State,32) && typeof w.Foreground==='boolean';
    const entry=e=>keys(e,['name','type','size','modifiedAt']) && text(e.name,255) && ['file','directory','shortcut'].includes(e.type)
      && (e.size===null || Number.isSafeInteger(e.size) && e.size>=0) && typeof e.modifiedAt==='string' && Number.isFinite(Date.parse(e.modifiedAt));
    let valid=false;
    if(operation==='desktop.status') valid=keys(result,['available','sessionId','userSid','hostname','monitors','coordinateSpace']) && result.available===true
      && Number.isInteger(result.sessionId) && result.sessionId>0 && text(result.userSid,256) && text(result.hostname,256)
      && result.coordinateSpace==='physical_pixels' && Array.isArray(result.monitors) && result.monitors.length<=32
      && result.monitors.every(m=>keys(m,['id','bounds']) && text(m.id,32) && bounds(m.bounds));
    if(operation==='desktop.windows.list') valid=keys(result,['windows']) && Array.isArray(result.windows) && result.windows.length<=100 && result.windows.every(window);
    if(operation==='desktop.window.inspect') valid=keys(result,['window']) && window(result.window);
    if(operation==='desktop.ui.inspect') valid=keys(result,['elements']) && Array.isArray(result.elements) && result.elements.length<=100
      && result.elements.every(e=>keys(e,['name','controlType']) && text(e.name) && text(e.controlType));
    if(operation==='desktop.files.list') valid=keys(result,['entries','nextOffset','scope']) && result.scope==='windows_known_folder_desktop'
      && Array.isArray(result.entries) && result.entries.length<=100 && result.entries.every(entry)
      && (result.nextOffset===null || Number.isInteger(result.nextOffset) && result.nextOffset>=0 && result.nextOffset<=1000);
    if(operation==='desktop.files.stat') valid=entry(result);
    if(operation==='desktop.files.preview') valid=keys(result,['name','format','text']) && text(result.name,255) && result.format==='utf8_text'
      && text(result.text,16384) && Buffer.byteLength(result.text)<=16384;
    if(!valid || Buffer.byteLength(JSON.stringify(result))>240*1024) throw Error('INVALID_OBSERVATION_RESULT');
  }
  return result;
}
function mcpResult(operation,result,replayed=false) {
  const observation=operation==='desktop.screenshot' ? Object.fromEntries(Object.entries(result).filter(([key])=>key!=='data')) : result;
  const structuredContent={operation,observation,replayed};
  const content=[{type:'text',text:JSON.stringify(structuredContent)}];
  if (operation==='desktop.screenshot') content.push({type:'image',mimeType:'image/png',data:result.data});
  return {content,structuredContent};
}

class ObservationQueue {
  constructor({service,enabled=false,nodes={},clock=Date.now,waitMs=15000}={}) {
    this.service=service;this.enabled=enabled===true;this.nodes=nodes;this.clock=clock;this.waitMs=waitMs;
    this.waiters=new Map();this.results=new Map();this.nextAllowed=new Map();
  }
  authorize(nodeId,operation) {
    if (!this.enabled) throw Error('OBSERVATION_DISABLED');
    if (!Object.hasOwn(this.nodes,nodeId) || !this.nodes[nodeId]?.hostname || !Array.isArray(this.nodes[nodeId].operations)) throw Error('OBSERVATION_NODE_DENIED');
    if (operation && (!Object.hasOwn(OPERATIONS,operation) || !this.nodes[nodeId].operations.includes(operation))) throw Error('OBSERVATION_OPERATION_DENIED');
  }
  fresh(nodeId) {
    const row=this.service.fleetStatus().nodes.find(n=>n.nodeId===nodeId);
    if (!row?.fresh || row.heartbeat?.hostname!==this.nodes[nodeId].hostname) throw Error('OBSERVATION_NODE_UNAVAILABLE');
    if (this.service.fleetConfig && !eligibleNodes({config:this.service.fleetConfig,snapshot:this.service.fleetStatus(),intent:{pinnedNodeId:nodeId,requiresInteractiveUi:true,estimatedScratchBytes:0}}).some(n=>n.id===nodeId)) throw Error('OBSERVATION_NODE_UNAVAILABLE');
  }
  key(runId,operationId) {return JSON.stringify([runId,operationId]);}
  prune() {
    for(const [key,item] of this.results) if(item.expires<=this.clock()) this.results.delete(key);
  }
  async observe(input) {
    const {runId,generation,operationId,nodeId,operation,arguments:args}=input||{};
    if (Object.keys(input||{}).some(k=>!['runId','generation','operationId','nodeId','operation','arguments'].includes(k))
      || typeof runId!=='string' || !runId || runId.length>128 || !/^[a-zA-Z0-9_-]{1,128}$/.test(operationId||'')) throw Error('INVALID_OBSERVATION_REQUEST');
    this.authorize(nodeId,operation);argsValid(operation,args);
    const run=this.service.assertRunGeneration(runId,generation);
    const key=this.key(runId,operationId),fingerprint=crypto.createHash('sha256').update(JSON.stringify({generation,nodeId,operation,args})).digest('hex');
    const prior=Object.hasOwn(run.desktopObservations||{},operationId) ? run.desktopObservations[operationId] : null;
    this.prune();
    if(prior) {
      if(prior.fingerprint!==fingerprint) throw Error('OBSERVATION_ID_CONFLICT');
      const cached=this.results.get(key);if(cached) {
        this.fresh(nodeId);this.authorize(nodeId,operation);
        if(cached.error) throw Error(cached.error);
        return mcpResult(operation,cached.result,true);
      }
      if(this.waiters.has(key)) return this.waiters.get(key).promise;
      throw Error('OBSERVATION_RESULT_EXPIRED');
    }
    this.fresh(nodeId);
    if(this.waiters.size>=32 || (this.nextAllowed.get(nodeId)||0)>this.clock()
      || this.service.store.list().some(r=>Object.values(r.desktopObservations||{}).some(o=>o.nodeId===nodeId && ['QUEUED','CLAIMED'].includes(o.status) && o.expiresAt>this.clock()))) throw Error('OBSERVATION_RATE_LIMIT');
    if(Object.keys(run.desktopObservations||{}).length>=128) throw Error('OBSERVATION_RUN_LIMIT');
    const job={runId,generation,operationId,nodeId,operation,arguments:args,requestId:crypto.randomUUID(),expiresAt:this.clock()+this.waitMs};
    this.service.store.update(runId,current=>{
      if(current.generation!==generation) throw Error('STALE_GENERATION');
      return {...current,desktopObservations:{...(current.desktopObservations||{}),[operationId]:{...job,fingerprint,status:'QUEUED'}}};
    });
    this.nextAllowed.set(nodeId,this.clock()+2000);
    let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
    const timer=setTimeout(()=>{
      this.waiters.delete(key);
      try {this.service.store.update(runId,r=>({...r,desktopObservations:{...r.desktopObservations,[operationId]:{...r.desktopObservations[operationId],status:'TIMED_OUT'}}}));}
      catch {reject(Error('OBSERVATION_STORAGE_UNAVAILABLE'));return;}
      reject(Error('OBSERVATION_TIMEOUT'));
    },this.waitMs);
    this.waiters.set(key,{promise,resolve,reject,timer});return promise;
  }
  poll(nodeId) {
    this.authorize(nodeId);this.prune();this.fresh(nodeId);
    for(const run of this.service.store.list()) for(const op of Object.values(run.desktopObservations||{})) {
      if(op.nodeId!==nodeId || op.status!=='QUEUED' || op.generation!==run.generation || op.expiresAt<=this.clock()) continue;
      try { this.service.assertRunGeneration(run.runId,op.generation); } catch { continue; }
      this.authorize(nodeId,op.operation);
      // Lost in-memory owner wait after restart means no delivery and no silent recapture.
      if(!this.waiters.has(this.key(run.runId,op.operationId))) continue;
      this.service.store.update(run.runId,r=>({...r,desktopObservations:{...r.desktopObservations,[op.operationId]:{...op,status:'CLAIMED'}}}));
      const {fingerprint,status,...job}=op;return {job};
    }
    return {job:null};
  }
  report(nodeId,input) {
    this.authorize(nodeId,input?.operation);
    if (!input || Object.keys(input).some(k=>!['runId','generation','operationId','nodeId','operation','arguments','requestId','expiresAt','result','error'].includes(k)) || (!!input.result===!!input.error)) throw Error('INVALID_OBSERVATION_RESULT');
    const run=this.service.assertRunGeneration(input.runId,input.generation);
    const op=Object.hasOwn(run.desktopObservations||{},input.operationId) ? run.desktopObservations[input.operationId] : null;
    if(!op || op.nodeId!==nodeId || op.nodeId!==input.nodeId || op.requestId!==input.requestId || op.operation!==input.operation
      || JSON.stringify(op.arguments)!==JSON.stringify(input.arguments) || op.expiresAt!==input.expiresAt || op.expiresAt<=this.clock()
      || op.status!=='CLAIMED') throw Error('OBSERVATION_REPLAY');
    const key=this.key(input.runId,input.operationId),waiter=this.waiters.get(key);
    if(!waiter) throw Error('OBSERVATION_REPLAY');
    if(input.error && !CODES.has(input.error)) throw Error('INVALID_OBSERVATION_RESULT');
    if(input.result) validateResult(op.operation,input.result,this.clock());
    this.service.store.update(input.runId,r=>({...r,desktopObservations:{...r.desktopObservations,[input.operationId]:{...op,status:input.error?'FAILED':'COMPLETED',finishedAt:this.clock()}}}));
    const expires=input.result?.expiresAt ? Date.parse(input.result.expiresAt) : this.clock()+30000;
    this.results.set(key,{result:input.result,error:input.error,expires});
    const expiryTimer=setTimeout(()=>this.results.delete(key),Math.max(1,expires-this.clock()));expiryTimer.unref?.();
    clearTimeout(waiter.timer);this.waiters.delete(key);
    if(input.error) waiter.reject(Error(input.error));else waiter.resolve(mcpResult(op.operation,input.result));
    return {acknowledged:true,requestId:op.requestId};
  }
}
module.exports={ObservationQueue,OPERATIONS,CODES,argsValid,validateResult,mcpResult};

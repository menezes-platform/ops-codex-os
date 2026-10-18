'use strict';
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const VALID_CURSOR=s=>typeof s==='string' && s.length>0 && s.length<=4096 && !/[\x00-\x1f]/.test(s);

function canonicalize(val) {
 if (val === null || typeof val !== 'object') return val;
 if (Array.isArray(val)) return val.map(canonicalize);
 const keys = Object.keys(val).sort();
 const res = {};
 for (const k of keys) {
  res[k] = canonicalize(val[k]);
 }
 return res;
}

function getFingerprint(obj) {
 return JSON.stringify(canonicalize(obj));
}

async function syncPersonalChanges({cursorStore,drive,ledger}={}) {
 if (!cursorStore || typeof cursorStore.get!=='function' || typeof cursorStore.set!=='function' ||
     !drive || typeof drive.listChanges!=='function' ||
     !ledger || typeof ledger.appendOrTombstone!=='function') throw new Error('SYNC_ADAPTERS_REQUIRED');
 const prior=await cursorStore.get();
 if (prior!==null && prior!==undefined && !VALID_CURSOR(prior)) throw new Error('SYNC_CURSOR_INVALID');
 let page;
 try {page=await drive.listChanges({cursor:prior??null});}
 catch(error) {
  if (!error || error.code!=='CURSOR_EXPIRED' || typeof drive.fullSnapshot!=='function') throw error;
  page=await drive.fullSnapshot();
 }
 if (!page || !Array.isArray(page.changes) || page.changes.length>500 ||
     !VALID_CURSOR(page.next_cursor)) throw new Error('SYNC_PAGE_INVALID');
 const seenKeys=new Map();
 let applied=0;
 for (const change of page.changes) {
  if (!change || typeof change!=='object' || Array.isArray(change) ||
      (change.op!=='append' && change.op!=='tombstone') ||
      typeof change.idempotency_key!=='string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(change.idempotency_key))
    throw new Error('SYNC_CHANGE_INVALID');
  if (change.op==='append' && (!change.event || change.event.scope!=='personal/current'))
    throw new Error('SYNC_SCOPE_INVALID');

  const fingerprint = getFingerprint(change);
  if (seenKeys.has(change.idempotency_key)) {
   if (seenKeys.get(change.idempotency_key) !== fingerprint) {
    throw new Error('SYNC_IDEMPOTENCY_CONFLICT');
   }
   continue;
  }
  seenKeys.set(change.idempotency_key, fingerprint);

  const receipt=await ledger.appendOrTombstone(change);
  if (!receipt || !['stored','replayed'].includes(receipt.status) ||
      !DIGEST.test(receipt.manifest_ref)) throw new Error('SYNC_RECEIPT_INVALID');
  if (receipt.status==='stored') applied++;
 }
 // Never advance before every write has a validated receipt and verified backend readback.
 await cursorStore.set(page.next_cursor);
 return Object.freeze({cursor:page.next_cursor,applied});
}
module.exports={syncPersonalChanges};

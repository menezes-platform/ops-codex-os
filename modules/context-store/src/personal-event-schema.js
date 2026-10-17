'use strict';
const { createHash } = require('node:crypto');
const FIELDS = ['event_id','scope','kind','source_type','source_ref','source_revision','observed_at','content_sha256','content','consent_receipt_id','schema_version'];
const MAX_CONTENT_BYTES = 16 * 1024;
const KINDS = new Set(['observation','decision','correction','tombstone']);
const SOURCES = new Set(['manual','git','agent','android','chat']);
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function normalizeMemoryEvent(raw) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
     Object.keys(raw).length !== FIELDS.length ||
     Object.keys(raw).some(k => !FIELDS.includes(k))) throw new Error('MEMORY_EVENT_INVALID');
 const text = k => typeof raw[k] === 'string' && raw[k].trim().length > 0 &&
   raw[k].length <= 2048 && !/[\x00-\x1f\x7f]/.test(raw[k]);
 if (raw.schema_version !== 1 || raw.scope !== 'personal/current' ||
     !KINDS.has(raw.kind) || !SOURCES.has(raw.source_type) ||
     !['event_id','source_ref','source_revision','consent_receipt_id'].every(text))
   throw new Error('MEMORY_EVENT_INVALID');
 if (typeof raw.content !== 'string' || !raw.content.trim() ||
     Buffer.byteLength(raw.content,'utf8') > MAX_CONTENT_BYTES) throw new Error('MEMORY_CONTENT_INVALID');
 if (typeof raw.observed_at !== 'string' || !UTC.test(raw.observed_at) ||
     !Number.isFinite(Date.parse(raw.observed_at)) ||
     new Date(raw.observed_at).toISOString().slice(0,19) !== raw.observed_at.slice(0,19))
   throw new Error('MEMORY_DATE_INVALID');
 const expected = 'sha256:' + createHash('sha256').update(raw.content,'utf8').digest('hex');
 if (raw.content_sha256 !== expected) throw new Error('MEMORY_DIGEST_MISMATCH');
 return Object.freeze({...raw});
}
module.exports = { normalizeMemoryEvent, MAX_CONTENT_BYTES };
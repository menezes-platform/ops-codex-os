'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { normalizeMemoryEvent } = require('../modules/context-store/src/personal-event-schema');
const sha = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex');
function event(content = 'A synthetic private test note') {
 return { event_id:'evt-0001',scope:'personal/current',kind:'observation',
 source_type:'manual',source_ref:'manual:1',source_revision:'r1',
 observed_at:'2026-10-15T18:00:00Z',content_sha256:sha(content), content,
 consent_receipt_id:'consent-1',schema_version:1 };
}
test('task_12_contract accepts a valid content-addressed personal event', () => {
 const normalized = normalizeMemoryEvent(event());
 assert.equal(normalized.scope,'personal/current');
 assert(Object.isFrozen(normalized));
});
test('task_12_contract rejects untrusted shape, scope, digest, date and oversize', () => {
 assert.throws(()=>normalizeMemoryEvent({...event(), extra:'unsafe'}));
 assert.throws(()=>normalizeMemoryEvent({...event(), scope:'project/a/b'}));
 assert.throws(()=>normalizeMemoryEvent({...event(), observed_at:'2026-13-15T18:00:00Z'}));
 assert.throws(()=>normalizeMemoryEvent({...event(), observed_at:'2026-10-15T18:00:00-03:00'}));
 assert.throws(()=>normalizeMemoryEvent({...event(), content_sha256:sha('wrong')}));
 assert.throws(()=>normalizeMemoryEvent(event('z'.repeat(16385))));
});
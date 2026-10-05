const PROJECT_SCOPE = /^project\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MANIFEST_FIELDS = new Set([
  'scope',
  'revision',
  'generation',
  'role',
  'corpus_manifest_ref',
  'lexical_profile',
  'vector_profile',
  'embedding_profile',
  'chunking_profile',
  'created_at',
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function fail(code) {
  throw new Error(code);
}

function assertScope(scope) {
  if (typeof scope !== 'string' || !PROJECT_SCOPE.test(scope)) fail('INVALID_PROJECT_SCOPE');
  return scope;
}

function isDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_TIME.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function assertIndexManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('INDEX_MANIFEST_INVALID');
  }
  if (Object.keys(value).some((key) => !MANIFEST_FIELDS.has(key))) fail('INDEX_MANIFEST_FIELD_INVALID');
  if (Object.keys(value).length !== MANIFEST_FIELDS.size) fail('INDEX_MANIFEST_INVALID');

  assertScope(value.scope);
  if (typeof value.revision !== 'string' || !value.revision.trim()) fail('INDEX_MANIFEST_INVALID');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) fail('INDEX_MANIFEST_INVALID');
  if (value.role !== 'current' && value.role !== 'previous') fail('INDEX_MANIFEST_INVALID');
  if (typeof value.corpus_manifest_ref !== 'string' || !DIGEST.test(value.corpus_manifest_ref)) fail('INDEX_MANIFEST_INVALID');
  for (const field of ['lexical_profile', 'vector_profile', 'embedding_profile', 'chunking_profile']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) fail('INDEX_MANIFEST_INVALID');
  }
  if (!isDateTime(value.created_at)) fail('INDEX_MANIFEST_INVALID');

  return Object.freeze({ ...value });
}

function assertGenerationPair({ scope, current, previous }) {
  assertScope(scope);
  if (!current && previous) fail('PREVIOUS_WITHOUT_CURRENT');

  const checkedCurrent = current ? assertIndexManifest(current) : null;
  const checkedPrevious = previous ? assertIndexManifest(previous) : null;

  for (const [manifest, expectedRole] of [[checkedCurrent, 'current'], [checkedPrevious, 'previous']]) {
    if (!manifest) continue;
    if (manifest.scope !== scope) fail('INDEX_MANIFEST_SCOPE_MISMATCH');
    if (manifest.role !== expectedRole) fail('INDEX_MANIFEST_ROLE_MISMATCH');
  }
  if (checkedCurrent && checkedPrevious && checkedCurrent.generation === checkedPrevious.generation) {
    fail('INDEX_GENERATION_DUPLICATE');
  }
  return { current: checkedCurrent, previous: checkedPrevious };
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value !== value.trim()) {
    fail('IDEMPOTENCY_KEY_INVALID');
  }
  return value;
}

function assertExpectedCurrentGeneration(expected, current) {
  if (expected !== (current?.generation ?? null)) fail('CURRENT_GENERATION_CHANGED');
}

function withRole(manifest, role) {
  return Object.freeze({ ...manifest, role });
}

function planGenerationPublication({ scope, current, previous = null, candidate, expected_current_generation, idempotency_key }) {
  const pair = assertGenerationPair({ scope, current, previous });
  const checkedCandidate = assertIndexManifest(candidate);
  assertIdempotencyKey(idempotency_key);
  assertExpectedCurrentGeneration(expected_current_generation, pair.current);
  if (checkedCandidate.scope !== scope) fail('INDEX_MANIFEST_SCOPE_MISMATCH');

  const highestPublishedGeneration = Math.max(pair.current?.generation ?? 0, pair.previous?.generation ?? 0);
  if (checkedCandidate.generation <= highestPublishedGeneration) fail('INDEX_GENERATION_NOT_ADVANCED');

  return Object.freeze({
    operation: 'publish',
    scope,
    idempotency_key,
    expected_current_generation: pair.current?.generation ?? null,
    current: withRole(checkedCandidate, 'current'),
    previous: pair.current ? withRole(pair.current, 'previous') : null,
    superseded: pair.previous,
  });
}

function planGenerationRollback({ scope, current, previous, expected_current_generation, idempotency_key }) {
  const pair = assertGenerationPair({ scope, current, previous });
  assertIdempotencyKey(idempotency_key);
  if (!pair.current || !pair.previous) fail('PREVIOUS_GENERATION_REQUIRED');
  assertExpectedCurrentGeneration(expected_current_generation, pair.current);

  return Object.freeze({
    operation: 'rollback',
    scope,
    idempotency_key,
    expected_current_generation: pair.current.generation,
    current: withRole(pair.previous, 'current'),
    previous: withRole(pair.current, 'previous'),
  });
}

module.exports = {
  assertIndexManifest,
  planGenerationPublication,
  planGenerationRollback,
};

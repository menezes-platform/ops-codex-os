const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { validateSpecKit } = require('../scripts/validate-spec-kit');

const fixtureRoot = path.join(__dirname, 'fixtures', 'spec-kit');

function fixture(name) {
  if (name === 'valid') return path.join(fixtureRoot, 'valid');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-fixture-'));
  fs.cpSync(path.join(fixtureRoot, 'valid'), tmp, { recursive: true });
  const overlay = path.join(fixtureRoot, name);
  for (const entry of fs.readdirSync(overlay)) {
    fs.copyFileSync(path.join(overlay, entry), path.join(tmp, entry));
  }
  return tmp;
}

test('valid spec kit passes', () => {
  const result = validateSpecKit(fixture('valid'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('missing required file fails with SPEC_KIT_FILE_MISSING', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-'));
  fs.cpSync(fixture('valid'), tmp, { recursive: true });
  fs.rmSync(path.join(tmp, '05-dependency-graph.md'));
  const result = validateSpecKit(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'SPEC_KIT_FILE_MISSING'));
});

test('TODO or TBD fails with SPEC_KIT_PLACEHOLDER', () => {
  const result = validateSpecKit(fixture('missing-disposition'));
  assert.ok(result.errors.some((error) => error.code === 'SPEC_KIT_PLACEHOLDER'));
});

test('duplicate authority domain fails with AUTHORITY_DUPLICATE_WRITER', () => {
  const result = validateSpecKit(fixture('duplicate-authority'));
  assert.ok(result.errors.some((error) => error.code === 'AUTHORITY_DUPLICATE_WRITER'));
});

test('missing legacy disposition fails with DELETION_DISPOSITION_MISSING', () => {
  const result = validateSpecKit(fixture('missing-disposition'));
  assert.ok(result.errors.some((error) => error.code === 'DELETION_DISPOSITION_MISSING'));
});

test('unknown migration phase fails with PHASE_ID_UNKNOWN', () => {
  const result = validateSpecKit(fixture('unknown-phase'));
  assert.ok(result.errors.some((error) => error.code === 'PHASE_ID_UNKNOWN'));
});

test('executor contract missing frozen-spec clauses fails with EXECUTOR_CONTRACT_INCOMPLETE', () => {
  const result = validateSpecKit(fixture('mutable-executor'));
  assert.ok(result.errors.some((error) => error.code === 'EXECUTOR_CONTRACT_INCOMPLETE'));
});


test('current architecture evidence rows require status', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-current-'));
  fs.cpSync(fixture('valid'), tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, '01-current-architecture.md'), '| Thing | claim | repo/path |\n');
  const result = validateSpecKit(tmp);
  assert.ok(result.errors.some((error) => error.code === 'CURRENT_EVIDENCE_STATUS_MISSING'));
});

test('partial kit allows legacy inventory before deletion map exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-partial-'));
  fs.writeFileSync(path.join(tmp, '04-repository-map.md'), '<!-- legacy: old-repo -->\n');
  const result = validateSpecKit(tmp, { allowMissingFiles: true });
  assert.equal(result.ok, true);
});

test('every invariant is bound to an architecture gate', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-invariant-'));
  fs.cpSync(fixture('valid'), tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, '05-dependency-graph.md'), '<!-- invariant: INV-001 -->\n<!-- invariant: INV-002 -->\n');
  fs.writeFileSync(path.join(tmp, '08-architecture-gates.md'), 'Gate binds INV-001\n');
  const result = validateSpecKit(tmp);
  assert.ok(result.errors.some((error) => error.code === 'INVARIANT_GATE_UNBOUND'));
});

test('canonical phases must be covered by migration rollback and acceptance files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-phases-'));
  fs.cpSync(fixture('valid'), tmp, { recursive: true });
  const all = Array.from({ length: 13 }, (_, i) => `P${String(i).padStart(2, '0')}`).join('\n');
  fs.writeFileSync(path.join(tmp, '07-migration-phases.md'), all + '\n');
  fs.writeFileSync(path.join(tmp, '09-rollout-rollback.md'), all + '\n');
  fs.writeFileSync(path.join(tmp, '10-acceptance-criteria.md'), 'P00\n');
  const result = validateSpecKit(tmp);
  assert.ok(result.errors.some((error) => error.code === 'PHASE_COVERAGE_MISSING'));
});

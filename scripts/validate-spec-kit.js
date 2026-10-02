const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_FILES = [
  '00-constitution.md',
  '01-current-architecture.md',
  '02-target-architecture.md',
  '03-authority-matrix.md',
  '04-repository-map.md',
  '05-dependency-graph.md',
  '06-deletion-map.md',
  '07-migration-phases.md',
  '08-architecture-gates.md',
  '09-rollout-rollback.md',
  '10-acceptance-criteria.md',
  '11-definition-of-done.md',
  '12-executor-contract.md',
];

const CANONICAL_PHASES = new Set(Array.from({ length: 13 }, (_, i) => `P${String(i).padStart(2, '0')}`));
const EXECUTOR_CLAUSES = [
  'SPEC KIT IS AUTHORITATIVE',
  'DO NOT MODIFY THE SPEC KIT TO MAKE IMPLEMENTATION PASS',
  'DO NOT INTRODUCE NEW AUTHORITIES OR CONTROL PLANES',
  'DO NOT BYPASS FAILED GATES',
];

function error(code, detail, file) {
  return { code, ...(file ? { file } : {}), detail };
}

function readFiles(rootDir, requiredFiles, allowMissingFiles, errors) {
  const entries = new Map();
  for (const file of requiredFiles) {
    const full = path.join(rootDir, file);
    if (!fs.existsSync(full)) {
      if (!allowMissingFiles) errors.push(error('SPEC_KIT_FILE_MISSING', `Missing required file: ${file}`, file));
      continue;
    }
    entries.set(file, fs.readFileSync(full, 'utf8'));
  }
  return entries;
}

function validatePlaceholders(entries, errors) {
  const placeholder = /\b(?:TODO|TBD|PLACEHOLDER)\b/;
  for (const [file, content] of entries) {
    if (placeholder.test(content)) {
      errors.push(error('SPEC_KIT_PLACEHOLDER', 'Unresolved architectural placeholder', file));
    }
  }
}

function validateAuthorities(entries, errors) {
  const writers = new Map();
  const marker = /<!--\s*domain:\s*([^\s]+)\s+writer:\s*([^\s]+)\s*-->/g;
  for (const [file, content] of entries) {
    let match;
    while ((match = marker.exec(content))) {
      const [, domain, writer] = match;
      const existing = writers.get(domain);
      if (existing && existing.writer !== writer) {
        errors.push(error(
          'AUTHORITY_DUPLICATE_WRITER',
          `Domain ${domain} has writers ${existing.writer} and ${writer}`,
          file,
        ));
      } else if (!existing) {
        writers.set(domain, { writer, file });
      }
    }
  }
}

function collectLegacyInventory(entries) {
  const ids = new Set();
  const marker = /<!--\s*legacy:\s*([^\s]+)(?:\s+disposition:\s*(KEEP|MOVE|MERGE|DELETE|ARCHIVE))?\s*-->/g;
  const dispositions = new Map();
  for (const [file, content] of entries) {
    let match;
    while ((match = marker.exec(content))) {
      ids.add(match[1]);
      if (match[2]) dispositions.set(match[1], { disposition: match[2], file });
    }
  }
  return { ids, dispositions };
}

function validateLegacy(entries, errors) {
  const { ids, dispositions } = collectLegacyInventory(entries);
  for (const id of ids) {
    if (!dispositions.has(id)) {
      errors.push(error('DELETION_DISPOSITION_MISSING', `Legacy item ${id} has no disposition`));
    }
  }
}

function validatePhases(entries, errors) {
  const seenUnknown = new Set();
  for (const [file, content] of entries) {
    const matches = content.match(/\bP\d{2}\b/g) || [];
    for (const phase of matches) {
      if (!CANONICAL_PHASES.has(phase) && !seenUnknown.has(`${file}:${phase}`)) {
        seenUnknown.add(`${file}:${phase}`);
        errors.push(error('PHASE_ID_UNKNOWN', `Unknown migration phase: ${phase}`, file));
      }
    }
  }
}


function validateCurrentEvidence(entries, errors) {
  const file = '01-current-architecture.md';
  const content = entries.get(file);
  if (!content) return;
  const validStatus = /\b(?:OBSERVED|DOCUMENTED_ONLY|UNRESOLVED)\b/;
  const rows = content.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  for (const row of rows) {
    const trimmed = row.trim();
    if (/^\|\s*[-:]+/.test(trimmed)) continue;
    if (/\bStatus\b/i.test(trimmed)) continue;
    if (!validStatus.test(trimmed)) {
      errors.push(error('CURRENT_EVIDENCE_STATUS_MISSING', 'Current-architecture evidence row lacks OBSERVED, DOCUMENTED_ONLY, or UNRESOLVED status', file));
      break;
    }
  }
}

function validatePhaseCoverage(entries, errors) {
  const required = ['07-migration-phases.md', '09-rollout-rollback.md', '10-acceptance-criteria.md'];
  if (!required.every((file) => entries.has(file))) return;
  for (const file of required) {
    const content = entries.get(file);
    for (const phase of CANONICAL_PHASES) {
      if (!content.includes(phase)) {
        errors.push(error('PHASE_COVERAGE_MISSING', 'Missing canonical phase ' + phase, file));
      }
    }
  }
}

function validateInvariantCoverage(entries, errors) {
  const dependency = entries.get('05-dependency-graph.md');
  const gates = entries.get('08-architecture-gates.md');
  if (!dependency || !gates) return;
  const invariants = new Set(dependency.match(/\bINV-\d{3}\b/g) || []);
  for (const id of invariants) {
    if (!gates.includes(id)) {
      errors.push(error('INVARIANT_GATE_UNBOUND', 'Invariant ' + id + ' has no architecture gate', '08-architecture-gates.md'));
    }
  }
}

function validateExecutor(entries, errors) {
  const file = '12-executor-contract.md';
  const content = entries.get(file);
  if (!content) return;
  const missing = EXECUTOR_CLAUSES.filter((clause) => !content.includes(clause));
  if (missing.length) {
    errors.push(error('EXECUTOR_CONTRACT_INCOMPLETE', `Missing executor clauses: ${missing.join('; ')}`, file));
  }
}

function validateSpecKit(rootDir, options = {}) {
  const errors = [];
  const entries = readFiles(rootDir, REQUIRED_FILES, Boolean(options.allowMissingFiles), errors);
  validatePlaceholders(entries, errors);
  validateAuthorities(entries, errors);
  if (entries.has('06-deletion-map.md') || !options.allowMissingFiles) validateLegacy(entries, errors);
  validatePhases(entries, errors);
  validatePhaseCoverage(entries, errors);
  validateCurrentEvidence(entries, errors);
  validateInvariantCoverage(entries, errors);
  validateExecutor(entries, errors);
  return { ok: errors.length === 0, errors };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const allowMissingFiles = args.includes('--allow-missing-files');
  const rootDir = args.find((arg) => !arg.startsWith('--')) || 'docs/architecture/spec-kit';
  const result = validateSpecKit(rootDir, { allowMissingFiles });
  if (!result.ok) {
    for (const item of result.errors) {
      process.stderr.write(`${item.code}${item.file ? ` [${item.file}]` : ''}: ${item.detail}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(`Spec Kit valid: ${rootDir}\n`);
  }
}

module.exports = {
  CANONICAL_PHASES,
  REQUIRED_FILES,
  validateSpecKit,
};

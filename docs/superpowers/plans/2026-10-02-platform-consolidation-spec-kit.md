# Platform Consolidation Spec Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Materialize the approved platform-consolidation design into a complete, internally consistent, mechanically validated Spec Kit plus a frozen executor contract that a Luna-class implementation agent can follow without making new architectural decisions.

**Architecture:** The approved design remains the source for target intent. This plan creates a durable \`docs/architecture/spec-kit/\` package in the current \`ops-codex-os\` repository (future \`agent-platform\`), plus a small Node 22 validator that enforces required files, section identities, cross-file phase/authority IDs, and absence of unresolved placeholders. The Spec Kit is documentation/control-plane material only; this plan does not migrate production code, rename repositories, provision infrastructure, deploy RAGFlow, archive repositories, or alter live authorities.

**Tech Stack:** Markdown, Node.js 22 CommonJS, \`node:test\`, existing GitHub repository structure.

**Spec:** \`docs/superpowers/specs/2026-10-02-platform-consolidation-design.md\`

## Global Constraints

- Scope is the entire Gabriel agent/runtime/context platform.
- Final principal repositories/systems are \`agent-platform\`, \`execution-plane\`, \`ops-gabriel-ops\`, and private \`Memory\`.
- \`ops-codex-os\` evolves into \`agent-platform\`; \`resident-node\` evolves into \`execution-plane\`.
- \`ops-dev-orquestra\` and \`ops-persistflow-sandbox\` are migration sources and later archive targets, not target architecture.
- Exactly one authoritative writer exists per durable state domain.
- Frameworks are implementation details; platform-owned interfaces must not expose LangChain, FAISS, Redis/RedisVL, RAGFlow, Hindsight, Engram, provider-SDK, or MCP-specific types.
- Project recall requires deterministic \`project/<owner>/<repo>\` scope; normal recall may not cross project indexes.
- Context Store is Drive-backed; project Git remains project truth; Memory remains personal-context truth; PersistFlow remains run/generation/checkpoint/claim truth.
- Initial retrieval target is BM25 + FAISS + local embeddings with per-project physical index isolation; RAGFlow is deferred.
- Agent Platform is architecturally stateless; Execution Plane owns PersistFlow, Resident Runtime, indexing execution, secrets, and worker adapters.
- Initial execution topology is one authoritative primary node with SQLite/WAL, manual failover, authority epoch, lease fencing, and short-lived capabilities.
- Initial inter-plane transport is private HTTP/JSON over Tailscale; transport must remain separable from platform contracts.
- Compatibility shims must have finite removal gates.
- Destruction/archival of obsolete architecture is part of Definition of Done.
- No new paid cloud infrastructure, permanent cloud database, or provider/runtime is authorized by this plan.
- This plan may create documentation and validation tooling only; production migration begins only under later phase-specific implementation plans.
- Node version floor remains \`>=22 <25\`.

## Review Focus

1. **Stale documentation contradicts live runtime:** \`01-current-architecture.md\` must label every claim as observed, documented-only, or unresolved and must not promote stale docs to runtime truth; validator fixtures must reject a current-state record without evidence status.
2. **A domain accidentally gets two authorities:** \`03-authority-matrix.md\` plus validator must reject duplicate authoritative writer IDs for the same domain.
3. **A legacy capability has no final disposition:** \`06-deletion-map.md\` plus validator must reject any inventoried legacy repository/capability lacking KEEP/MOVE/MERGE/DELETE/ARCHIVE disposition and objective exit condition where applicable.
4. **Executor silently changes architecture:** \`12-executor-contract.md\` must explicitly prohibit spec mutation, new authorities/control planes, and bypassing failed gates; validator must require those clauses.
5. **Cross-file migration phases drift:** \`07-migration-phases.md\`, \`08-architecture-gates.md\`, \`09-rollout-rollback.md\`, \`10-acceptance-criteria.md\`, and \`11-definition-of-done.md\` must use the same canonical phase IDs; validator must reject unknown phase IDs.

---

## File Structure

### Documentation to create

- \`docs/architecture/README.md\` — entrypoint declaring global architecture authority and linking the Spec Kit.
- \`docs/architecture/spec-kit/00-constitution.md\` — immutable architectural principles and forbidden moves.
- \`docs/architecture/spec-kit/01-current-architecture.md\` — evidence-backed current-state inventory with confidence/status labels.
- \`docs/architecture/spec-kit/02-target-architecture.md\` — final repository/module topology and data/control flows.
- \`docs/architecture/spec-kit/03-authority-matrix.md\` — one-writer-per-domain registry and precedence rules.
- \`docs/architecture/spec-kit/04-repository-map.md\` — current repo -> target repo/module mapping.
- \`docs/architecture/spec-kit/05-dependency-graph.md\` — allowed/forbidden dependency edges and seam ownership.
- \`docs/architecture/spec-kit/06-deletion-map.md\` — KEEP/MOVE/MERGE/DELETE/ARCHIVE decisions and objective removal gates.
- \`docs/architecture/spec-kit/07-migration-phases.md\` — canonical phases P00-P12 with entry/exit conditions.
- \`docs/architecture/spec-kit/08-architecture-gates.md\` — machine/human gates and invariant catalog.
- \`docs/architecture/spec-kit/09-rollout-rollback.md\` — phase-local rollback, snapshots, failover/fencing.
- \`docs/architecture/spec-kit/10-acceptance-criteria.md\` — acceptance evidence required per phase.
- \`docs/architecture/spec-kit/11-definition-of-done.md\` — final platform DoD including deletion/archival.
- \`docs/architecture/spec-kit/12-executor-contract.md\` — frozen Luna takeover contract and stop conditions.

### Validation tooling to create

- \`scripts/validate-spec-kit.js\` — exports \`validateSpecKit(rootDir, options?)\` and CLI entrypoint.
- \`tests/spec-kit-validator.test.js\` — Node tests for structure, placeholder rejection, authority uniqueness, disposition completeness, executor clauses, and phase-ID consistency.
- \`tests/fixtures/spec-kit/\` — minimal valid/invalid fixture trees for validator tests.

### Existing files to modify

- \`package.json\` — add \`validate:spec-kit\` script.
- \`README.md\` — add a short pointer to the new global architecture authority only after the Spec Kit is complete.

---

### Task 1: Build the Spec Kit Validator First

**Files:**
- Create: \`scripts/validate-spec-kit.js\`
- Create: \`tests/spec-kit-validator.test.js\`
- Create: \`tests/fixtures/spec-kit/valid/\`
- Create: \`tests/fixtures/spec-kit/duplicate-authority/\`
- Create: \`tests/fixtures/spec-kit/missing-disposition/\`
- Create: \`tests/fixtures/spec-kit/unknown-phase/\`
- Create: \`tests/fixtures/spec-kit/mutable-executor/\`
- Modify: \`package.json\`

**Interfaces:**
- Consumes: filesystem path to a Spec Kit root.
- Produces: \`validateSpecKit(rootDir: string, options?: { allowMissingFiles?: boolean }): { ok: boolean, errors: Array<{ code: string, file?: string, detail: string }> }\`
- Produces CLI: \`node scripts/validate-spec-kit.js [root]\`, exit code 0 on valid kit and non-zero on validation failure.

- [ ] **Step 1: Write failing tests for required structure and placeholder rejection**

In \`tests/spec-kit-validator.test.js\`, add tests named:

- \`valid spec kit passes\`
- \`missing required file fails with SPEC_KIT_FILE_MISSING\`
- \`TODO or TBD fails with SPEC_KIT_PLACEHOLDER\`

Assertions must call \`validateSpecKit(fixtureRoot)\` and inspect stable error codes rather than prose-only messages.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

\`node --test tests/spec-kit-validator.test.js\`

Expected: FAIL because \`scripts/validate-spec-kit.js\` does not exist.

- [ ] **Step 3: Implement required-file and placeholder validation**

Implement CommonJS exports:

\`validateSpecKit(rootDir, options = {})\`

Required filenames are exactly \`00-constitution.md\` through \`12-executor-contract.md\`.

Reject the tokens \`TODO\`, \`TBD\`, and \`PLACEHOLDER\` as standalone architectural placeholders.

- [ ] **Step 4: Add failing authority/disposition/phase/executor tests**

Add tests named:

- \`duplicate authority domain fails with AUTHORITY_DUPLICATE_WRITER\`
- \`missing legacy disposition fails with DELETION_DISPOSITION_MISSING\`
- \`unknown migration phase fails with PHASE_ID_UNKNOWN\`
- \`executor contract missing frozen-spec clauses fails with EXECUTOR_CONTRACT_INCOMPLETE\`

Fixture syntax must be documented in comments in the test file and use stable machine-readable Markdown markers:

\`<!-- domain: <id> writer: <id> -->\`

\`<!-- legacy: <id> disposition: <KEEP|MOVE|MERGE|DELETE|ARCHIVE> -->\`

\`<!-- phase: P00 -->\`

- [ ] **Step 5: Run focused tests and verify RED for the new rules**

Run:

\`node --test tests/spec-kit-validator.test.js\`

Expected: existing structure tests PASS; new semantic validation tests FAIL.

- [ ] **Step 6: Implement semantic validation rules**

Implement:

- unique writer per \`domain\`;
- disposition marker required for every \`<!-- legacy: ... -->\` inventory record;
- canonical phase set exactly \`P00\` through \`P12\`;
- references to unknown \`Pxx\` fail;
- executor contract must contain explicit clauses equivalent to:
  - \`SPEC KIT IS AUTHORITATIVE\`;
  - \`DO NOT MODIFY THE SPEC KIT TO MAKE IMPLEMENTATION PASS\`;
  - \`DO NOT INTRODUCE NEW AUTHORITIES OR CONTROL PLANES\`;
  - \`DO NOT BYPASS FAILED GATES\`.

Do not parse general Markdown semantics beyond these deliberately small machine-readable markers.

- [ ] **Step 7: Add npm script and run complete tests**

In \`package.json\` add:

\`"validate:spec-kit": "node scripts/validate-spec-kit.js docs/architecture/spec-kit"\`

Run:

\`npm test\`

Expected: all existing repository tests plus \`spec-kit-validator.test.js\` PASS.

- [ ] **Step 8: Commit**

\`git add scripts/validate-spec-kit.js tests/spec-kit-validator.test.js tests/fixtures/spec-kit package.json\`

\`git commit -m "test: add platform spec kit validator"\`

---

### Task 2: Materialize the Constitution and Architecture Entrypoint

**Files:**
- Create: \`docs/architecture/README.md\`
- Create: \`docs/architecture/spec-kit/00-constitution.md\`

**Interfaces:**
- Consumes: approved design sections 1-2, 14, 18, 25-26.
- Produces: canonical global architecture entrypoint and constitutional rules used by every later Spec Kit file.

- [ ] **Step 1: Create \`00-constitution.md\` with machine-readable authority/deferred markers**

Include exact constitutional rules:

- exactly one authority per domain;
- frameworks are implementation details;
- interfaces live with producer modules;
- no valid scope, no project recall;
- compatibility shims are mortal;
- destruction is part of Done;
- no new paid infrastructure under this migration without explicit authorization.

Declare deferred items exactly:

- RAGFlow runtime;
- LangGraph;
- distributed multi-primary;
- automatic leader election;
- permanent cloud DB;
- hot standby;
- event-sourced rewrite.

- [ ] **Step 2: Create \`docs/architecture/README.md\`**

Declare \`docs/architecture/spec-kit/\` the global architecture authority for the consolidation work and state that runtime evidence remains authoritative for current operational facts until migrated.

Link the approved design and the 13 Spec Kit files.

- [ ] **Step 3: Validate partial kit**

Run:

\`node scripts/validate-spec-kit.js docs/architecture/spec-kit --allow-missing-files\`

If the CLI does not yet accept \`--allow-missing-files\`, add CLI parsing that maps it to \`allowMissingFiles: true\` and cover it with one test before continuing.

Expected: PASS for existing files with no placeholders.

- [ ] **Step 4: Commit**

\`git add docs/architecture/README.md docs/architecture/spec-kit/00-constitution.md scripts/validate-spec-kit.js tests/spec-kit-validator.test.js\`

\`git commit -m "docs: establish platform architecture constitution"\`

---

### Task 3: Record the Evidence-Backed Current Architecture

**Files:**
- Create: \`docs/architecture/spec-kit/01-current-architecture.md\`

**Interfaces:**
- Consumes: authenticated GitHub/runtime evidence gathered during implementation.
- Produces: evidence ledger that later migration plans use without treating stale prose as live truth.

- [ ] **Step 1: Inventory current repositories and live architectural roles**

At minimum inspect and record:

- \`menezes-platform/ops-codex-os\`;
- \`menezesx2k26-byte/resident-node\`;
- \`menezes-platform/ops-persistflow-sandbox\`;
- \`menezes-platform/ops-dev-orquestra\`;
- \`menezesx2k26-byte/ops-gabriel-ops\`;
- \`menezesx2k26-byte/Memory\`.

Record current default branch, relevant active branches, and observed responsibility.

- [ ] **Step 2: Record connected/non-repo dependencies separately**

Include Engram, Google Drive-backed corpus/object behavior, Tailscale, Railway/Hostinger/CloudShell worker roles, and any currently verified deployment state.

Do not infer deployment truth from README claims.

- [ ] **Step 3: Label every current-state claim**

Each inventory row must use one status:

- \`OBSERVED\` — verified from current source/runtime/tool evidence;
- \`DOCUMENTED_ONLY\` — claimed by docs but not independently verified;
- \`UNRESOLVED\` — conflicting or insufficient evidence.

Include evidence locator: repo/ref/path, connector/runtime observation, or issue/PR reference.

- [ ] **Step 4: Add authority markers only for observed current authorities**

Use the validator marker:

\`<!-- domain: <domain-id> writer: <writer-id> -->\`

Do not create markers for aspirational target architecture in this file.

- [ ] **Step 5: Add validator test for unlabeled current-state evidence**

Extend \`tests/spec-kit-validator.test.js\` so a current-architecture row with an evidence claim but no valid evidence status fails with \`CURRENT_EVIDENCE_STATUS_MISSING\`.

- [ ] **Step 6: Run tests and partial validation**

Run:

\`npm test\`

Run:

\`node scripts/validate-spec-kit.js docs/architecture/spec-kit --allow-missing-files\`

Expected: PASS.

- [ ] **Step 7: Commit**

\`git add docs/architecture/spec-kit/01-current-architecture.md scripts/validate-spec-kit.js tests/spec-kit-validator.test.js tests/fixtures/spec-kit\`

\`git commit -m "docs: inventory current platform architecture"\`

---

### Task 4: Freeze Target Topology, Authority Matrix, and Repository Map

**Files:**
- Create: \`docs/architecture/spec-kit/02-target-architecture.md\`
- Create: \`docs/architecture/spec-kit/03-authority-matrix.md\`
- Create: \`docs/architecture/spec-kit/04-repository-map.md\`

**Interfaces:**
- Consumes: approved design sections 3-15.
- Produces: canonical target ownership map used by dependency/deletion/migration files.

- [ ] **Step 1: Write \`02-target-architecture.md\`**

Freeze these principal targets:

- \`agent-platform\` from \`ops-codex-os\`;
- \`execution-plane\` from \`resident-node\`;
- retained simplified \`ops-gabriel-ops\`;
- retained private \`Memory\`.

Document module ownership and initial deployment topology.

Explicitly keep RAGFlow outside initial target runtime.

- [ ] **Step 2: Write \`03-authority-matrix.md\`**

Create stable domain IDs and exactly one writer marker for each:

- \`project-source\` -> Git;
- \`project-docs\` -> Git;
- \`personal-context\` -> Memory;
- \`episodic-conversation\` -> Engram;
- \`run-continuity\` -> PersistFlow;
- \`local-runtime-state\` -> Resident Runtime;
- \`retrieval-corpus\` -> Context Store projection authority;
- \`secret-custody\` -> Secrets Broker;
- \`model-routing-policy\` -> Provider Gateway.

For \`retrieval-indexes\`, explicitly state “no independent authority” and do not emit a writer marker.

- [ ] **Step 3: Write \`04-repository-map.md\`**

For each current repository record:

- target repository;
- target module(s);
- final repo disposition;
- rename/archive timing;
- authority removed/moved;
- live callers that must be inventoried during migration.

Include legacy markers for the validator for every repo subject to disposition.

- [ ] **Step 4: Run duplicate-authority validation**

Run:

\`node scripts/validate-spec-kit.js docs/architecture/spec-kit --allow-missing-files\`

Expected: PASS with no \`AUTHORITY_DUPLICATE_WRITER\`.

- [ ] **Step 5: Commit**

\`git add docs/architecture/spec-kit/02-target-architecture.md docs/architecture/spec-kit/03-authority-matrix.md docs/architecture/spec-kit/04-repository-map.md\`

\`git commit -m "docs: freeze target topology and authorities"\`

---

### Task 5: Define Dependency Rules and the Deletion Map

**Files:**
- Create: \`docs/architecture/spec-kit/05-dependency-graph.md\`
- Create: \`docs/architecture/spec-kit/06-deletion-map.md\`

**Interfaces:**
- Consumes: target modules and authority IDs from Task 4.
- Produces: allowed/forbidden edges and complete legacy disposition registry.

- [ ] **Step 1: Write the allowed dependency graph**

At minimum encode:

- Agent OS -> Context Gateway / Provider Gateway interfaces;
- Context Gateway -> Memory/Engram/retrieval adapters, not provider-specific types;
- Agent Platform -> Execution Plane client, never SQLite/WAL/filesystem internals;
- Gabriel Ops -> read projections + official command clients;
- workers -> Execution Plane task/capability interface;
- indexing runtime -> Context Store materialization and local embedding implementation.

- [ ] **Step 2: Write forbidden edges**

Include all 18 approved architecture invariants where they map to dependency or authority boundaries.

Name each forbidden edge with a stable invariant ID \`INV-001\` etc.

- [ ] **Step 3: Write \`06-deletion-map.md\`**

Every legacy repo/capability found in \`01-current-architecture.md\` must have exactly one disposition:

- KEEP;
- MOVE;
- MERGE;
- DELETE;
- ARCHIVE.

For shims/archive/delete entries include:

- owner;
- destination if applicable;
- precondition;
- objective removal/archive gate;
- latest phase.

Use \`<!-- legacy: <id> disposition: <...> -->\` markers.

- [ ] **Step 4: Add validator cross-check for inventory/disposition completeness**

Validator must compare legacy IDs inventoried in current architecture/repository map against deletion-map IDs and emit \`DELETION_DISPOSITION_MISSING\` for any gap.

- [ ] **Step 5: Run tests and validation**

Run:

\`npm test\`

Run:

\`node scripts/validate-spec-kit.js docs/architecture/spec-kit --allow-missing-files\`

Expected: PASS.

- [ ] **Step 6: Commit**

\`git add docs/architecture/spec-kit/05-dependency-graph.md docs/architecture/spec-kit/06-deletion-map.md scripts/validate-spec-kit.js tests/spec-kit-validator.test.js tests/fixtures/spec-kit\`

\`git commit -m "docs: define dependency and deletion maps"\`

---

### Task 6: Freeze Migration Phases and Architecture Gates

**Files:**
- Create: \`docs/architecture/spec-kit/07-migration-phases.md\`
- Create: \`docs/architecture/spec-kit/08-architecture-gates.md\`

**Interfaces:**
- Consumes: deletion map, dependency invariants, target topology.
- Produces: canonical execution phases \`P00\`-\`P12\` and gate IDs used by rollout/acceptance/DoD.

- [ ] **Step 1: Define canonical phase IDs**

Map approved phases exactly:

- \`P00\` Architecture Freeze
- \`P01\` Inventory and Dependency Graph
- \`P02\` Contracts and Architecture Tests
- \`P03\` Agent Platform Consolidation
- \`P04\` Execution Plane Consolidation
- \`P05\` Context Store and Retrieval
- \`P06\` Provider Gateway Migration
- \`P07\` Gabriel Ops Simplification
- \`P08\` Caller and Worker Migration
- \`P09\` Duplicate-Authority Deletion
- \`P10\` Legacy Repository Archive
- \`P11\` Branch/Docs/Deployment Cleanup
- \`P12\` Final Audit

Each phase must state purpose, entry conditions, allowed mutations, forbidden mutations, required evidence, rollback artifact, exit conditions, and next phase.

- [ ] **Step 2: Define gate catalog**

Create stable gate IDs grouped by:

- automatic functional gates;
- automatic architectural gates;
- data/state migration gates;
- security/fencing gates;
- human residual gates.

Explicitly state that ordinary failed automatic gates trigger diagnose/fix/retry, not human escalation.

- [ ] **Step 3: Bind invariants to phase gates**

Every \`INV-xxx\` from Task 5 must have at least one enforcing gate in \`08-architecture-gates.md\`.

- [ ] **Step 4: Extend validator for invariant/gate coverage**

Emit \`INVARIANT_GATE_UNBOUND\` if any invariant ID defined in dependency graph is absent from architecture gates.

- [ ] **Step 5: Run tests and validation**

Run:

\`npm test\`

Run:

\`node scripts/validate-spec-kit.js docs/architecture/spec-kit --allow-missing-files\`

Expected: PASS.

- [ ] **Step 6: Commit**

\`git add docs/architecture/spec-kit/07-migration-phases.md docs/architecture/spec-kit/08-architecture-gates.md scripts/validate-spec-kit.js tests/spec-kit-validator.test.js tests/fixtures/spec-kit\`

\`git commit -m "docs: freeze migration phases and gates"\`

---

### Task 7: Specify Rollout, Rollback, Acceptance, and Final DoD

**Files:**
- Create: \`docs/architecture/spec-kit/09-rollout-rollback.md\`
- Create: \`docs/architecture/spec-kit/10-acceptance-criteria.md\`
- Create: \`docs/architecture/spec-kit/11-definition-of-done.md\`

**Interfaces:**
- Consumes: canonical phase IDs and gate IDs.
- Produces: evidence requirements for safe progression and final completion.

- [ ] **Step 1: Write \`09-rollout-rollback.md\`**

Specify phase-local rollback, not full-platform rewind.

Cover:

- state backup before mutation;
- SQLite/WAL consistent snapshot;
- authority-epoch advancement on primary failover;
- worker lease fencing;
- current/previous retrieval-index generation;
- shim preservation only until removal gate;
- repo archive/tag preservation;
- deploy rollback receipt.

- [ ] **Step 2: Write \`10-acceptance-criteria.md\`**

For each \`P00\`-\`P12\`, define evidence required to exit the phase.

Evidence must be concrete: test command/result, repository ref, runtime health probe, caller count, migration receipt, archive status, branch-cleanup record, or equivalent verifiable artifact.

Do not accept prose such as “looks good” or “migration successful”.

- [ ] **Step 3: Write \`11-definition-of-done.md\`**

Copy the approved final DoD semantically without weakening it.

Include explicit zero conditions:

- duplicate authority paths = 0;
- forbidden dependency edges = 0;
- cross-project retrieval leakage = 0;
- eligible deprecated shims remaining = 0;
- live dependencies on archived legacy repos = 0.

- [ ] **Step 4: Extend validator for phase consistency across 07-11**

All \`Pxx\` references in files 07-11 must belong to the canonical \`P00\`-\`P12\` set.

Each canonical phase must appear in \`07\`, \`09\`, and \`10\`.

- [ ] **Step 5: Run tests and partial validation**

Run:

\`npm test\`

Run:

\`node scripts/validate-spec-kit.js docs/architecture/spec-kit --allow-missing-files\`

Expected: PASS.

- [ ] **Step 6: Commit**

\`git add docs/architecture/spec-kit/09-rollout-rollback.md docs/architecture/spec-kit/10-acceptance-criteria.md docs/architecture/spec-kit/11-definition-of-done.md scripts/validate-spec-kit.js tests/spec-kit-validator.test.js tests/fixtures/spec-kit\`

\`git commit -m "docs: define rollout acceptance and final done"\`

---

### Task 8: Freeze the Luna Executor Contract and Takeover Prompt

**Files:**
- Create: \`docs/architecture/spec-kit/12-executor-contract.md\`

**Interfaces:**
- Consumes: all Spec Kit files 00-11.
- Produces: the exact behavioral contract and copy-ready takeover prompt for the future migration executor.

- [ ] **Step 1: Write the immutable executor rules**

The contract must explicitly include:

- \`SPEC KIT IS AUTHORITATIVE\`;
- do not redesign architecture;
- do not modify Spec Kit to make implementation pass;
- do not add authorities/control planes/providers/databases outside approved scope;
- do not preserve legacy outside registered shim rules;
- do not bypass failed gates;
- do not claim test/deploy/migration success without evidence;
- failed automatic gate -> diagnose/fix/retry;
- residual human gate only for the approved limited categories.

- [ ] **Step 2: Define checkpoint format**

Require each execution checkpoint to record:

- phase ID;
- repo refs/commit SHAs;
- completed gate IDs;
- active shim IDs;
- pending gate IDs;
- migration receipts;
- rollback artifact;
- authority/drift audit;
- next safe action.

- [ ] **Step 3: Define takeover prompt block**

Include one fenced, copy-ready prompt whose opening semantics are:

\`CONTINUE THE PLATFORM CONSOLIDATION FROM THE APPROVED SPEC KIT. DO NOT REDESIGN.\`

The prompt must instruct the executor to read \`00-constitution.md\`, current phase, relevant maps/gates, and current repository/runtime evidence before mutation.

It must instruct execution to continue through phases automatically until DoD or a valid residual human gate.

- [ ] **Step 4: Add validator test for executor immutability clauses**

Run:

\`node --test tests/spec-kit-validator.test.js\`

Expected: PASS including \`EXECUTOR_CONTRACT_INCOMPLETE\` negative fixture.

- [ ] **Step 5: Run full Spec Kit validation**

Run:

\`npm run validate:spec-kit\`

Expected: exit 0 and report all 13 required files valid.

- [ ] **Step 6: Commit**

\`git add docs/architecture/spec-kit/12-executor-contract.md\`

\`git commit -m "docs: freeze platform migration executor contract"\`

---

### Task 9: Reconcile the Durable Repo Entrypoint and Final Review

**Files:**
- Modify: \`README.md\`
- Verify: \`docs/architecture/README.md\`
- Verify: all \`docs/architecture/spec-kit/*.md\`

**Interfaces:**
- Consumes: complete validated Spec Kit.
- Produces: discoverable architecture entrypoint and review-ready branch.

- [ ] **Step 1: Add minimal README architecture pointer**

Add a concise section pointing to:

- \`docs/architecture/README.md\`;
- \`docs/architecture/spec-kit/00-constitution.md\`;
- approved design spec.

Do not duplicate the architecture in README.

- [ ] **Step 2: Run complete repository tests**

Run:

\`npm test\`

Expected: PASS.

- [ ] **Step 3: Run complete Spec Kit validation**

Run:

\`npm run validate:spec-kit\`

Expected: PASS with zero errors.

- [ ] **Step 4: Run placeholder and ambiguity scan**

Run a repository-scoped scan over the Spec Kit for:

- \`TODO\`;
- \`TBD\`;
- \`PLACEHOLDER\`;
- \`maybe\`;
- \`probably\`;
- unresolved question marks used as requirements.

Any ambiguous architecture requirement must be resolved from the approved design or explicitly classified as an implementation parameter that does not alter architecture.

- [ ] **Step 5: Cross-check spec coverage**

Verify every section of \`docs/superpowers/specs/2026-10-02-platform-consolidation-design.md\` maps to at least one Spec Kit file.

Record the mapping in the final commit message/body or PR description; do not create a duplicate permanent mapping document unless review proves it necessary.

- [ ] **Step 6: Verify this plan did not mutate production architecture**

Confirm:

- no live deployment changed;
- no repo renamed;
- no legacy repo archived;
- no branch deleted;
- no state migrated;
- no paid infrastructure created;
- no RAGFlow runtime enabled.

- [ ] **Step 7: Commit**

\`git add README.md docs/architecture\`

\`git commit -m "docs: publish validated platform consolidation spec kit"\`

- [ ] **Step 8: Prepare review handoff**

Provide:

- branch name;
- commit range;
- \`npm test\` result;
- \`npm run validate:spec-kit\` result;
- Spec Kit path;
- direct path to \`12-executor-contract.md\`;
- explicit statement that migration implementation has not started.

---

## Self-Review Notes

- **Spec coverage:** All approved design areas map to Tasks 2-8: constitution, current evidence, target topology, authorities, repository/dependency/deletion maps, migration phases, gates, rollback, acceptance, DoD, and Luna executor contract.
- **Scope:** This plan intentionally does not implement the platform migration. The approved design spans several independent subsystems; each migration phase must receive its own implementation plan after the Spec Kit is frozen.
- **Type consistency:** Canonical phase IDs are \`P00\`-\`P12\`; invariant IDs are \`INV-xxx\`; validator error codes are stable uppercase identifiers; scope remains \`project/<owner>/<repo>\`.
- **Review focus coverage:** current-evidence labeling is Task 3; duplicate authority is Tasks 1/4; deletion completeness is Task 5; executor immutability is Task 8; phase-ID consistency is Tasks 1/6/7.
- **Proportion:** The plan decides file ownership, validation interfaces, stable identifiers, gates and checks. It deliberately does not transcribe the eventual Markdown bodies beyond the requirements the executor cannot safely invent.

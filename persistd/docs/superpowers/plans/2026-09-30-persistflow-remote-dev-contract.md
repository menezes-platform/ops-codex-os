# PersistFlow Remote Dev Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral remote-development contract to PersistFlow where each completed work unit is durably anchored by a clean Git commit plus a lineage-fenced PersistFlow checkpoint.

**Architecture:** Keep `persist_fleet_execute_ephemeral` as the bounded execution primitive and keep ephemeral worker disks disposable. Add a typed remote-dev checkpoint/status layer to the existing PersistFlow authority, reuse the existing durable secret-safety rules, and ship a reusable agent skill that enforces inspect -> mutate -> verify -> commit -> checkpoint. Base44 remote-dev skills are a pinned MIT workflow reference only; no Base44 runtime dependency is introduced.

**Tech Stack:** Node.js CommonJS, Node `node:test`, Zod 4, Model Context Protocol, existing PersistFlow authority stores/FleetRouter, Git.

**Spec:** `persistd/docs/superpowers/specs/2026-09-30-persistflow-remote-dev-contract-design.md`

## Global Constraints

- PersistFlow run state remains durable execution/control authority.
- A clean Git commit on an isolated project branch is the durable workspace restore point.
- Ephemeral worker filesystems remain disposable and non-authoritative.
- `persist_fleet_execute_ephemeral` keeps its existing stable `operationId` + command-digest idempotency contract.
- No command text, remote stdout/stderr, bearer, cookie, token, password, private key, Railway claim URL, or provider credential may enter durable remote-dev state.
- Remote-dev checkpoints are accepted only when `dirty === false`.
- Checkpoint lineage is single-writer: every checkpoint after the first must name the current latest checkpoint digest.
- No Base44 SDK/CLI/service/runtime dependency is added; upstream reference is `base44/skills@8548a482f606751c55dcdb1365398fbec2fcb64d` (MIT).
- No TikTok LIVE Dungeon runtime, provider, deployment, database, or LIVE state changes belong to this implementation.
- No paid infrastructure/AI is auto-enabled.
- Behavior changes use focused RED -> GREEN tests first, then one full `persistd` suite at final integration.
- Implementation starts in an isolated worktree/branch created through `superpowers:using-git-worktrees`; do not implement directly on `main`.

## Review Focus

- **Stale parallel writer:** a second agent submits a checkpoint with an old `parentCheckpointDigest`; owning task must prove `REMOTE_DEV_CHECKPOINT_CONFLICT` and leave durable state unchanged.
- **Dirty workspace claim:** a caller tries to checkpoint `dirty: true`; owning task must prove rejection and no new lineage head.
- **Secret-shaped durable metadata:** nested verification/artifact data contains token/cookie/private-key material; owning task must prove rejection/scrubbing and that it is never persisted.
- **Restart after accepted checkpoint:** reconstruct `PersistFlowService` with the same file-backed authority store; owning task must prove status returns the same checkpoint digest/head without replaying remote work.
- **Ambiguous remote operation state:** an operation is already running/completed when an agent reconnects; skill/MCP tests must make status inspection the next action and introduce no duplicate-execution surface.

---

### Task 1: Extract reusable durable-state safety primitives without changing existing semantics

**Files:**
- Create: `persistd/src/persistflow/durable-safety.js`
- Modify: `persistd/src/persistflow/service.js`
- Create test: `persistd/durable-safety.test.js`
- Regression coverage: `persistd/persistflow-fleet-integration.test.js` and `persistd/ephemeral-loop.test.js`

**Interfaces:**
- Produces: `scrubDurable(value: unknown): unknown`
- Produces: `assertDurableSafe(value: unknown, options?: { maxBytes?: number, maxDepth?: number, prefix?: string }): unknown`
- Preserves: existing ephemeral-resume error names by wrapping with `prefix: 'EPHEMERAL_RESUME'`

- [ ] **Step 1: Write the failing durable-safety tests**

Create assertions that bearer/cookie/token/private-key/Railway-claim-url material is scrubbed; secret-key names throw `TEST_SECRET_FORBIDDEN`; depth overflow throws `TEST_TOO_DEEP`; byte overflow throws `TEST_TOO_LARGE`.

- [ ] **Step 2: Run focused RED verification**

Run: `cd persistd && node --test durable-safety.test.js`
Expected: FAIL because the module/exports do not exist.

- [ ] **Step 3: Implement `durable-safety.js` by extracting the current logic from `service.js`**

Keep the current secret-key regex and string redactions unchanged. `assertDurableSafe` recursively enforces depth/size and derives exact error names from `prefix`.

- [ ] **Step 4: Rewire `service.js` without changing resume semantics**

`assertSafeResume(value)` delegates to `assertDurableSafe(value, { maxBytes: 64 * 1024, maxDepth: 8, prefix: 'EPHEMERAL_RESUME' })`.

- [ ] **Step 5: Run focused regression verification**

Run: `cd persistd && node --test durable-safety.test.js persistflow-fleet-integration.test.js ephemeral-loop.test.js`
Expected: PASS; current `EPHEMERAL_RESUME_*` behavior remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add persistd/src/persistflow/durable-safety.js persistd/src/persistflow/service.js persistd/durable-safety.test.js
git commit -m "refactor(persistflow): share durable safety primitives"
```

### Task 2: Implement the typed remote-dev checkpoint contract and lineage digest

**Files:**
- Create: `persistd/src/persistflow/remote-dev-checkpoint.js`
- Create test: `persistd/remote-dev-checkpoint.test.js`

**Interfaces:**
- Consumes: `assertDurableSafe()` from Task 1
- Produces: `buildRemoteDevCheckpoint(input: object, options?: { latestDigest?: string | null }): RemoteDevCheckpoint`
- Produces: `checkpointDigest(checkpointWithoutDigest: object): string`
- `RemoteDevCheckpoint` adds `checkpointDigest: string` to the spec payload

- [ ] **Step 1: Write RED tests for a valid first checkpoint and deterministic digest**

Assert schema version 1, unchanged full head SHA, null first parent, a 64-hex digest, and identical digest for semantically identical objects with different object-key insertion order.

- [ ] **Step 2: Add RED validation tests for repo identity and SHAs**

Assert explicit rejection for invalid `repo.fullName`, empty branch, non-40-hex `headSha`, and invalid non-null `baseSha`.

- [ ] **Step 3: Add Review Focus rejection tests**

Assert `dirty: true` -> `REMOTE_DEV_CHECKPOINT_DIRTY`; stale parent -> `REMOTE_DEV_CHECKPOINT_CONFLICT`; nested secret material -> `REMOTE_DEV_CHECKPOINT_SECRET_FORBIDDEN`; oversized payload -> `REMOTE_DEV_CHECKPOINT_TOO_LARGE`.

- [ ] **Step 4: Run focused RED verification**

Run: `cd persistd && node --test remote-dev-checkpoint.test.js`
Expected: FAIL because the checkpoint module is absent.

- [ ] **Step 5: Implement canonical validation and SHA-256 digesting**

Canonical JSON recursively sorts object keys and preserves array order. Allowed verification statuses are exactly `pass`, `fail`, `skipped`.

- [ ] **Step 6: Run focused GREEN verification**

Run: `cd persistd && node --test remote-dev-checkpoint.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add persistd/src/persistflow/remote-dev-checkpoint.js persistd/remote-dev-checkpoint.test.js
git commit -m "feat(persistflow): add remote dev checkpoint contract"
```

### Task 3: Persist remote-dev checkpoints atomically in PersistFlow service state

**Files:**
- Modify: `persistd/src/persistflow/service.js`
- Create test: `persistd/remote-dev-service.test.js`
- Reuse: `persistd/src/persistflow/authority-store.js`

**Interfaces:**
- Consumes: `buildRemoteDevCheckpoint()` from Task 2
- Produces: `PersistFlowService.checkpointRemoteDev(runId, input) -> { checkpoint, run }`
- Produces: `PersistFlowService.remoteDevStatus(runId) -> { generation, latestCheckpoint, operations }`
- Durable state field: `run.latestRemoteDevCheckpoint`
- Generic checkpoint evidence type: `remote_dev.checkpoint`

- [ ] **Step 1: Write a RED service test for the first accepted checkpoint**

Assert the head SHA is persisted, one normal run checkpoint has `evidence.type === 'remote_dev.checkpoint'`, and durable evidence contains repo/branch/head/digest but no command/stdout/stderr fields.

- [ ] **Step 2: Write RED service tests for stale lineage and stale generation**

Wrong parent digest must throw `REMOTE_DEV_CHECKPOINT_CONFLICT`; wrong generation must preserve existing `STALE_GENERATION`; neither may change state/checkpoint count.

- [ ] **Step 3: Write the restart-persistence test with `FileAuthorityStore`**

Accept one checkpoint, reconstruct the service against the same directory, call `remoteDevStatus`, and assert the exact digest/head survive without invoking any provider.

- [ ] **Step 4: Run focused RED verification**

Run: `cd persistd && node --test remote-dev-service.test.js`
Expected: FAIL because the service methods do not exist.

- [ ] **Step 5: Implement `checkpointRemoteDev` as one authority-store update**

Inside one `store.update`: assert generation; read current latest digest; build/validate the new checkpoint against it; set `latestRemoteDevCheckpoint`; append a standard checkpoint using the remote checkpoint next-safe-action and scrubbed metadata only.

- [ ] **Step 6: Implement read-only `remoteDevStatus`**

Return current generation, latest checkpoint or null, and bounded summaries of durable ephemeral operations: operationId, generation, status, provider, workerGeneration, correlationId, createdAt, updatedAt.

- [ ] **Step 7: Run focused service regression tests**

Run: `cd persistd && node --test remote-dev-service.test.js persistflow-fleet-integration.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add persistd/src/persistflow/service.js persistd/remote-dev-service.test.js
git commit -m "feat(persistflow): persist remote dev checkpoints"
```

### Task 4: Expose typed checkpoint and status operations through MCP

**Files:**
- Modify: `persistd/src/persistflow/mcp-handler.js`
- Modify test: `persistd/persistflow-fleet-integration.test.js`

**Interfaces:**
- Produces MCP tool: `persist_remote_dev_checkpoint`
- Produces MCP tool: `persist_remote_dev_status`
- Checkpoint tool delegates only to `service.checkpointRemoteDev`
- Status tool delegates only to `service.remoteDevStatus`

- [ ] **Step 1: Add RED MCP discovery assertions**

Authenticated `listTools()` must include both new tool names.

- [ ] **Step 2: Add a RED MCP checkpoint -> status round trip**

Submit one clean checkpoint at generation 1, read status, and assert the same `headSha` and `checkpointDigest` are returned.

- [ ] **Step 3: Add a RED MCP stale-lineage conflict test**

Checkpoint A succeeds; checkpoint B with the wrong parent fails; status still exposes A.

- [ ] **Step 4: Run focused RED verification**

Run: `cd persistd && node --test persistflow-fleet-integration.test.js`
Expected: FAIL on missing tools/methods.

- [ ] **Step 5: Register both MCP tools with explicit Zod schemas**

Checkpoint schema encodes the exact spec fields plus generation; do not use `z.unknown()` for the remote-dev payload. Status accepts `runId` and is read-only.

- [ ] **Step 6: Run focused GREEN verification**

Run: `cd persistd && node --test persistflow-fleet-integration.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add persistd/src/persistflow/mcp-handler.js persistd/persistflow-fleet-integration.test.js
git commit -m "feat(persistflow): expose remote dev checkpoint MCP"
```

### Task 5: Ship the reusable agent workflow and troubleshooting contract

**Files:**
- Create: `skills/persistflow-remote-dev/SKILL.md`
- Modify: `README.md`
- Modify: `persistd/docs/railway-ephemeral-workers.md`
- Create test: `persistd/remote-dev-skill-contract.test.js`

**Interfaces:**
- Consumes: `persist_fleet_execute_ephemeral`, `persist_remote_dev_checkpoint`, `persist_remote_dev_status`
- Produces: one accepted clean Git commit + one lineage-fenced PersistFlow checkpoint per completed mutating unit
- Pinned upstream reference: `base44/skills@8548a482f606751c55dcdb1365398fbec2fcb64d`

- [ ] **Step 1: Write a RED skill-contract test**

Read `../skills/persistflow-remote-dev/SKILL.md` and assert it contains: Git + PersistFlow authority; disposable ephemeral disk; read before write; stable operation IDs; inspect status before retry; verify -> commit -> clean -> checkpoint; one mutator/checkpoint lineage; no automatic deploy/publish; pinned Base44 reference and no-dependency wording.

- [ ] **Step 2: Run focused RED verification**

Run: `cd persistd && node --test remote-dev-skill-contract.test.js`
Expected: FAIL because the skill file does not exist.

- [ ] **Step 3: Author `persistflow-remote-dev/SKILL.md`**

Required procedure: inspect run/Git/checkpoint -> inspect files -> isolated worktree/branch -> one bounded operation -> diagnose ambiguity via status -> narrow verification -> commit -> confirm clean/full SHA -> checkpoint with parent digest -> proceed only after acceptance.

- [ ] **Step 4: Add a failure-state table to the skill**

Cover `PREPARING/ACQUIRING`, `RUNNING`, `HANDOFF_BLOCKED`, `FAILED`, and `COMPLETED`; reconnect/inspect must beat blind replay.

- [ ] **Step 5: Update existing docs instead of creating duplicate placeholder architecture files**

Extend `persistd/docs/railway-ephemeral-workers.md` with the provider-neutral remote-dev contract and add the skill to the root README skill list.

- [ ] **Step 6: Run skill/document verification**

Run: `cd persistd && node --test remote-dev-skill-contract.test.js`
Expected: PASS.

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add skills/persistflow-remote-dev/SKILL.md README.md persistd/docs/railway-ephemeral-workers.md persistd/remote-dev-skill-contract.test.js
git commit -m "docs(persistflow): add remote dev agent workflow"
```

### Task 6: Final integration verification and handoff

**Files:**
- No production behavior changes unless verification reveals a defect
- Update only if new verified facts require it: `persistd/docs/railway-ephemeral-workers.md`

**Interfaces:**
- Verifies validator -> service -> MCP -> skill as one contract
- Does not deploy or mutate any consumer project

- [ ] **Step 1: Run the focused remote-dev integration set**

```bash
cd persistd
node --test durable-safety.test.js remote-dev-checkpoint.test.js remote-dev-service.test.js remote-dev-skill-contract.test.js persistflow-fleet-integration.test.js ephemeral-loop.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the single final full PersistFlow suite**

Run: `cd persistd && npm test`
Expected: PASS with no new skips/failures introduced by this feature.

- [ ] **Step 3: Inspect durable-state leakage**

Search changed code/tests for accidental persistence of command/stdout/stderr or bearer/cookie/private-key/claim-url material in `latestRemoteDevCheckpoint` or `remote_dev.checkpoint` evidence.

- [ ] **Step 4: Inspect Git topology and diff**

Verify the implementation branch is based on intended current `main`, working tree is clean, each task has its own commit, no TTK repo file changed, and no Base44 dependency was added to package manifests.

- [ ] **Step 5: Run a read-only consumer review against TikTok LIVE Dungeon**

Read current TTK `AGENTS.md`/DoD authority rules and confirm this skill stays strictly in development execution and never enters the LIVE runtime path. Record review evidence; do not mutate or deploy Dungeon.

- [ ] **Step 6: Request a fresh whole-branch review**

Use `superpowers:requesting-code-review` with focus on lineage races, durable secret leakage, restart semantics, and MCP authorization boundaries.

- [ ] **Step 7: Commit only verification-driven documentation fixes, if any**

If no files changed, do not create an empty commit.

- [ ] **Step 8: Stop before merge/deploy**

Return final commit list, test receipts, review findings, and exact branch/head. Merge to `main`, production PersistFlow rollout, and any TTK adoption are separate explicit actions.
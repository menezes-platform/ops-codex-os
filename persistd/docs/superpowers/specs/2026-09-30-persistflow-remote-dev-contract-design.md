# PersistFlow Remote Dev Contract Design

**Status:** Proposed for implementation planning  
**Date:** 2026-09-30  
**Scope:** `persistd` + reusable agent skill in `ops-codex-os`

## Problem

PersistFlow already provides durable run generations, fenced takeover, fleet routing, idempotent ephemeral operations, command-digest fencing, bounded worker handoff, and durable checkpoints. What it does not yet provide is a single agent-facing remote-development contract that says exactly how an external coding agent should inspect a repository, mutate it on ephemeral capacity, verify one unit, create a restoreable checkpoint, and resume safely after worker/session loss.

Base44's remote-development skills provide a useful reference pattern: read before write, surgical mutation, explicit verification, explicit checkpointing, one mutator at a time, and troubleshooting from durable status rather than blind retries. We want those workflow properties without making Base44 a production dependency and without changing PersistFlow's authority model.

Reference only, pinned for this design: `base44/skills@8548a482f606751c55dcdb1365398fbec2fcb64d` (MIT), especially `base44-remote-dev`, `base44-sandbox`, and `base44-troubleshooter`.

## Goals

1. Add a first-party PersistFlow remote-development workflow for coding agents.
2. Make a Git commit plus a typed PersistFlow checkpoint the durable restore point for each completed work unit.
3. Fence stale or parallel checkpoint writers with explicit checkpoint lineage.
4. Preserve existing ephemeral-operation idempotency and restart semantics.
5. Expose checkpoint/status operations over MCP without persisting command text, remote stdout/stderr, secrets, or worker-private credentials.
6. Ship a reusable `persistflow-remote-dev` skill that maps agent behavior to the existing PersistFlow/Fleet primitives.
7. Keep the contract provider-neutral even though Railway anonymous workers are the first ephemeral provider.

## Non-goals

- Do not add Base44 as a runtime, SDK, service, CLI, or deployment dependency.
- Do not move TikTok LIVE Dungeon gameplay/runtime authority into PersistFlow or Base44.
- Do not create a second durable filesystem or treat ephemeral worker disk as authoritative.
- Do not add automatic deploy/publish behavior.
- Do not introduce a long-lived mutable worker session merely to imitate Base44's sandbox.
- Do not persist arbitrary shell command text, stdout/stderr, access tokens, cookies, claim URLs, private keys, or other secrets.
- Do not auto-enable paid infrastructure, paid AI, or generative-AI runtime behavior.
- Do not modify `menezes-platform/ttk-live-dungeon` as part of this feature.

## Existing authority model to preserve

```text
PersistFlow run state
  = durable execution/control authority

Git commit on an isolated project branch
  = durable code/workspace restore point

Ephemeral worker filesystem
  = disposable execution scratch space

Fleet provider
  = replaceable capacity provider

Project runtime (for example TikTok LIVE Dungeon)
  = remains authoritative for its own product/runtime state
```

A worker disappearing must never erase the last accepted development checkpoint. A chat/session disappearing must never make a later agent guess which code revision was accepted.

## Remote development checkpoint

A remote-development checkpoint is accepted only after the work unit has been committed to Git and the workspace is clean.

Logical shape:

```json
{
  "schemaVersion": 1,
  "repo": {
    "fullName": "owner/repo",
    "branch": "agent/example/20260930",
    "baseSha": "40-hex-or-null",
    "headSha": "40-hex"
  },
  "operationId": "stable-operation-id-or-null",
  "unit": "short work-unit identifier",
  "parentCheckpointDigest": "64-hex-or-null",
  "dirty": false,
  "verification": [
    {
      "name": "focused tests",
      "status": "pass",
      "receipt": "optional short durable receipt"
    }
  ],
  "artifactRefs": [],
  "nextSafeAction": "next bounded action or null"
}
```

### Validation rules

- `schemaVersion` is exactly `1`.
- `repo.fullName` is `owner/name` and bounded in length.
- `repo.branch` is non-empty and bounded.
- `repo.headSha` is a full 40-hex Git commit SHA.
- `repo.baseSha` is null or a full 40-hex Git commit SHA.
- `dirty` must be exactly `false`; dirty work cannot become a remote-dev restore point.
- `verification[].status` is one of `pass | fail | skipped`.
- `artifactRefs` contain durable references only, never inline secret material.
- Durable content is secret-scanned, depth-bounded, and capped at 64 KiB.
- The first checkpoint for a run has `parentCheckpointDigest = null`.
- Every later checkpoint must name the current latest checkpoint digest. A mismatch fails with `REMOTE_DEV_CHECKPOINT_CONFLICT`.
- The checkpoint digest is SHA-256 over a deterministic canonical JSON representation excluding the digest itself.

This lineage is the one-writer fence. Two agents may inspect, but only the agent holding the current checkpoint lineage can advance the durable remote-dev state.

## PersistFlow service surface

Add two service methods:

```text
checkpointRemoteDev(runId, input) -> { checkpoint, run }
remoteDevStatus(runId) -> { generation, latestCheckpoint, operations }
```

`checkpointRemoteDev`:

1. asserts the current run generation;
2. validates and canonicalizes the checkpoint;
3. compares `parentCheckpointDigest` to `latestRemoteDevCheckpoint.checkpointDigest`;
4. computes the new digest;
5. atomically stores `latestRemoteDevCheckpoint`;
6. appends a normal PersistFlow checkpoint with evidence type `remote_dev.checkpoint`;
7. stores only scrubbed metadata.

`remoteDevStatus` is read-only and returns the latest remote-dev checkpoint plus durable ephemeral-operation summaries. It does not expose command text or remote stdout/stderr.

## MCP surface

Add:

- `persist_remote_dev_checkpoint`
- `persist_remote_dev_status`

The MCP schema is typed with Zod. The checkpoint tool requires the current run generation. The status tool is read-only.

The existing `persist_fleet_execute_ephemeral` remains the execution primitive. Its stable `operationId` and command digest rules remain unchanged.

## Agent workflow

For every mutating remote-development unit:

1. inspect the current run, Git branch/head, and latest remote-dev checkpoint;
2. read/search the relevant project files before editing;
3. work on an isolated project branch/worktree;
4. execute one bounded mutation/verification unit using a caller-stable `operationId`;
5. if execution state is ambiguous, inspect durable operation state before any retry;
6. run the narrowest relevant verification;
7. commit the intended project changes;
8. confirm the project worktree is clean and read the full commit SHA;
9. call `persist_remote_dev_checkpoint` with the previous checkpoint digest;
10. only after checkpoint acceptance begin the next mutating unit.

The same `operationId` must never be reused with a different command. A stale checkpoint digest must never be bypassed by inventing a new lineage.

## Troubleshooting semantics

Agents diagnose from durable state:

- `PREPARING/ACQUIRING`: do not launch a duplicate operation.
- `RUNNING`: reconnect/inspect; do not replay.
- `HANDOFF_BLOCKED`: inspect predecessor/successor evidence and preserve both until reconciled.
- `FAILED`: distinguish provider acquisition failure from remote command failure before choosing a new route.
- `COMPLETED`: do not rerun to “make sure”; verify Git/head/checkpoint instead.
- missing or stale remote-dev checkpoint: inspect Git + run state; never infer success from chat memory.

A missing log line or disconnected caller is not evidence that the durable operation failed.

## Security and privacy

- Reuse the existing durable scrubbing rules for tokens, secrets, cookies, private keys, bearer values, and Railway claim URLs.
- Refactor those rules into a shared module only if behavior and existing error contracts remain unchanged.
- Remote-dev checkpoint payloads are metadata, not log storage.
- No browser/provider secrets may enter a checkpoint.
- MCP authentication and current-generation fencing remain mandatory.
- The new status surface is read-only.
- No new network listener or trust boundary is introduced.

## Documentation and skill

Create `skills/persistflow-remote-dev/SKILL.md` as the reusable agent contract.

The skill must explicitly state:

- Git + PersistFlow are authoritative; ephemeral disk is disposable.
- read before write;
- one mutator per branch/checkpoint lineage;
- stable operation IDs;
- verify -> commit -> clean worktree -> checkpoint;
- inspect durable status before retry after disconnect/failure;
- no automatic deploy/publish;
- Base44 is an upstream workflow reference only, not a dependency.

Update the existing PersistFlow ephemeral-worker documentation to describe this contract and its relationship to `persist_fleet_execute_ephemeral`.

## Acceptance

The feature is acceptable when:

1. existing PersistFlow ephemeral-operation tests remain green with unchanged semantics;
2. secret/depth/size error contracts for existing handoff payloads remain unchanged;
3. remote-dev checkpoint validation rejects dirty work, secret-like durable data, malformed SHAs, stale lineage, and stale run generation;
4. a valid checkpoint is atomically persisted and visible through read-only status;
5. the same accepted checkpoint remains visible after reconstructing the service from a file-backed authority store;
6. MCP checkpoint/status tools pass an authenticated round trip;
7. no command text, stdout/stderr, token, cookie, private key, or claim URL appears in durable remote-dev state;
8. the reusable skill encodes the required workflow and points to the pinned MIT Base44 reference;
9. full `persistd` tests pass;
10. no TTK LIVE Dungeon runtime, provider, deployment, or canonical game state is changed.

## Relationship to TikTok LIVE Dungeon

TikTok LIVE Dungeon is a consumer of this development workflow, not part of its runtime.

A future Dungeon implementation pass may use the skill to drive isolated branch/worktree execution and checkpoint each gate, but Dungeon's Git repository and persisted game runtime remain the product authorities. This feature must not add Base44, PersistFlow, or any agent to the production LIVE event path.

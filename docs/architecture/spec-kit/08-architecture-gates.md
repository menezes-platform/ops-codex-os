# 08 — Architecture Gates

A failed automatic gate triggers diagnose -> fix within approved architecture -> rerun. It does not automatically become a human gate.

## Automatic architecture gates

| Gate | Enforces | Pass condition |
| --- | --- | --- |
| `AG-001` | INV-001 | Agent Platform has zero imports/access paths to PersistFlow storage internals. |
| `AG-002` | INV-002 | Memory has zero dependency edges to execution packages. |
| `AG-003` | INV-003 | Gabriel Ops authoritative run-state writers = 0. |
| `AG-004` | INV-004 | generation advancement outside PersistFlow interface = 0. |
| `AG-005` | INV-005 | derived-to-Memory silent promotion path = 0. |
| `AG-006` | INV-006 | indexes/caches are marked derived and can be deleted without authority loss. |
| `AG-007` | INV-007 | Context Store write path cannot mutate authoritative Git source. |
| `AG-008` | INV-008 | freshness-required requests bypass semantic/exact derived cache. |
| `AG-009` | INV-009 | adversarial cross-project recall leakage = 0. |
| `AG-010` | INV-010 | project scope resolves only from deterministic repository/workspace identity or explicit allowlisted multi-project operation. |
| `AG-011` | INV-011 | stale authority epoch result commits are rejected. |
| `AG-012` | INV-012 | expired lease result commits are rejected. |
| `AG-013` | INV-013 | Agent Platform persistent provider-secret paths = 0. |
| `AG-014` | INV-014 | platform-owned model-call bypasses around Provider Gateway = 0. |
| `AG-015` | INV-015 | delete/rebuild index test reproduces valid index from allowed sources. |
| `AG-016` | INV-016 | authority registry has exactly one writer per durable domain. |
| `AG-017` | INV-017 | every active shim has finite objective removal gate and latest phase. |
| `AG-018` | INV-018 | public platform interfaces expose zero framework/vendor-specific types. |

## Automatic functional gates

- `FG-001` — repository unit/integration suites green for touched scope.
- `FG-002` — generated/maintained clients remain contract-compatible.
- `FG-003` — mutating commands enforce idempotency.
- `FG-004` — primary-node health/restart behavior preserves authoritative state.
- `FG-005` — current/previous retrieval snapshot rollback succeeds.
- `FG-006` — local embedding/index manifest records required version fields.
- `FG-007` — Gabriel Ops renders unavailable providers as unavailable, not synthetic success.

## Data/state migration gates

- `DG-001` — pre-mutation backup exists and is readable.
- `DG-002` — migration receipt records source revision, target revision and verification.
- `DG-003` — post-migration authoritative record counts/checksums satisfy migration-specific expectations.
- `DG-004` — rollback path was exercised or mechanically verified before legacy writer deletion.

## Security/fencing gates

- `SG-001` — secrets absent from repository, logs, corpus, indexes and ordinary snapshots.
- `SG-002` — worker capability is scoped to task/resource.
- `SG-003` — stale epoch rejected.
- `SG-004` — expired/revoked lease rejected.
- `SG-005` — failover advances authority epoch before accepting new authoritative worker commits.

## Residual human gates

Only these categories may stop autonomous execution:

- `HG-001` — required credential/account consent unavailable and no authorized alternative exists;
- `HG-002` — irreversible/destructive action outside the deletion policy already approved by the Spec Kit;
- `HG-003` — materially new fact proves a constitutional assumption impossible or unsafe;
- `HG-004` — explicit cost-producing infrastructure not already authorized;
- `HG-005` — external account action whose provider requires direct human consent.

Implementation ambiguity, failing tests, merge conflicts inside the working branch, or ordinary debugging are not human gates.

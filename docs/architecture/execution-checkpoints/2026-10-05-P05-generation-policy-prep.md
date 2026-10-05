# P05 — generation publication policy preparation

- `phase_id`: `P05`
- `checkpoint_id`: `P05-GENERATION-POLICY-2026-10-05T02:24:42Z`
- `recorded_at`: `2026-10-05T02:24:42Z`
- `status`: `OFFLINE_GENERATION_POLICY_ONLY`
- `P05_formal_entry`: `NOT_SATISFIED`
- `P05_exit`: `NOT_PASSED`
- `frozen_spec`: `unchanged`

## Change

The P03 migration branch has a Context Store manifest contract with `current` and `previous` roles. This preparation closes the schema at its root and adds a pure, side-effect-free policy for validating manifests and planning initial publication, promotion, and rollback. Publication plans require the caller's expected current generation and an idempotency key; they retain the former current as `previous`, identify the superseded prior generation without deleting it, and advance beyond all retained generations. Each plan records both observed slot generations so a durable driver can compare-and-swap the complete current/previous pair. Rollback swaps current/previous roles only when the caller's expected current generation still matches.

The Context Store exposes these plans only through an injected generation-driver contract (`readGenerationPair` and `applyGenerationPlan`). Calls fail closed when the driver is absent. The policy performs no Drive reads/writes, index builds, embedding calls, file deletion, or canonical state mutation. A future Drive driver and Resident Node indexing runtime must apply plans with durable atomic compare-and-swap on both observed slot generations and the idempotency key, then prove that property in integration tests; the current test double and pure plans do not provide transactional or production guarantees.

## Validation

Ten synthetic unit tests cover the closed root schema, strict manifest fields, project scope, digest/date validity, first publication, monotonic promotion, stale-current rejection, rollback swapping, missing/duplicate generations, idempotency-key validation, publication after rollback, and driver fail-closed behavior. All ten passed; adjacent Context Gateway/Store and Spec Kit validator tests also passed (28 tests total). The existing `platform-contracts` test could not load in this host because `ajv/dist/2020` is not installed; no dependencies were installed. These tests are source preparation only and do not satisfy the P04 indexing-runtime entry gate, Drive-backed corpus requirement, FAISS/retrieval execution, incremental/full rebuild, production rollback, or P05 exit.

No credentials, corpus content, Drive file, index, deployment, or Spec Kit file was read or changed by this implementation.

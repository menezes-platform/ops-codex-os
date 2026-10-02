# P02 Implementation Plan — Contracts and Architecture Tests

## Phase boundary

P02 adds producer-owned, versioned JSON contracts and tests. Existing production routes, stores, workers, credentials, and deployments remain untouched. P01's unresolved runtime/caller facts continue to block P03+ actions that depend on them; contract authoring depends only on the frozen Spec Kit and may proceed.

No central contracts repository is created. Each schema lives under the module that produces the interface. Contracts use platform-owned JSON fields and JSON Schema Draft 2020-12. HTTP/JSON stays transport detail; no framework, MCP, provider SDK, FAISS, SQLite, WAL, or cloud-vendor type appears in a public payload.

## Producer-owned v1 surfaces

1. `ops-codex-os` / Agent Platform:
   - `modules/context-gateway/contracts/v1/context.schema.json`: single-project `recall`, `ingest`, `explain`, and `request_reindex` request/result shapes; provenance-bearing evidence; deterministic `project/<owner>/<repo>` scope; explicit allowlisted operation for multi-project recall.
   - `modules/context-store/contracts/v1/manifest.schema.json`: project/revision provenance, immutable generation identity, current/previous role, lexical/vector/embedding/chunking profile versions, and source manifest reference. No durable index authority is declared.
   - `modules/provider-gateway/contracts/v1/inference.schema.json`: provider-neutral inference request/result, policy profile, budget and normalized usage. The caller cannot select a raw provider SDK type or receive conversation/run/project authority.
   - `clients/execution-plane/v1/client.js`: maintained HTTP/JSON client for versioned task/run/retrieve/index operations with required idempotency keys on mutations. Transport is injectable for offline compatibility tests.
2. `resident-node` / Execution Plane:
   - `modules/persistflow-core/contracts/v1/commands.schema.json`: submit, inspect, and cancel task/run command shapes; mutations require idempotency keys.
   - `modules/resident-runtime/contracts/v1/jobs.schema.json`: local job/capability and fenced-result fields.
   - `modules/indexing-runtime/contracts/v1/indexing.schema.json`: one-project retrieve/index commands and receipts, current/previous generations, versioned local profiles.
   - `modules/secrets-broker/contracts/v1/capabilities.schema.json`: scoped, expiring capability issue/revoke contract; never a persistent secret-store representation.
   - `modules/worker-adapters/contracts/v1/results.schema.json`: authoritative result envelope requiring `run_id`, `task_id`, `lease_id`, `authority_epoch`, and a valid scoped capability reference.
   - `tests/contracts.rs`: producer-type and JSON fixture compatibility, including rejection when any fencing field is absent or invalid.
3. `ops-gabriel-ops`:
   - `modules/ops-projections/contracts/v1/projections.schema.json`: read-only health/run/worker/index/provider projection shapes. Command execution remains through the official producer client and is not a Gabriel Ops authority contract.

## Compatibility strategy

Register incumbent PersistFlow/MCP, worker, provider/cache, and Gabriel Ops routes as legacy interfaces that remain unchanged throughout P02. P02 adds versioned v1 contracts beside them and does not switch callers. No compatibility shim is introduced. If a later phase must add one, its complete required registry record (`id`, owner, purpose, allowed callers, introduced phase, removal condition, latest removal phase) is committed before the shim code.

## Test-first implementation sequence

1. Add failing producer contract tests for schema parsing/shape, producer ownership, forbidden public framework/vendor names, mutation idempotency, project-scope isolation and explicit allowlisting, and required worker fencing.
2. Add the producer schemas and a shared consumer client with fake-transport compatibility cases; keep all live integrations disconnected.
3. Add executable architecture checks that read the frozen authority/dependency Spec Kit and constrain only the new target module surfaces. Record current legacy paths as migration debt; do not hide or exempt new code through broad allowlists.
4. Register compatibility status and precise rollback refs.
5. Run the suites and gates listed below. Diagnose and correct any failures within this plan and the approved architecture.

## Verification

- Agent Platform: `npm test`, `npm run validate:spec-kit`, schema/client compatibility tests, forbidden-edge and ownership checks, `git diff --check`.
- Execution Plane: `cargo fmt --all -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-features`, contract/fencing fixture tests, `git diff --check`.
- Gabriel Ops: `npm test`, `npm run typecheck`, projection schema tests, `git diff --check`.
- Architecture: AG-001 through AG-018 checks added in P02 are exercised where mechanically applicable to the new seams; AG-011/012 invalid lease/epoch cases are covered by contract tests. Existing legacy runtime violations stay visible as pending migration work and do not pass a later migration gate.
- Security/data: no production state or credentials are read or changed by these tests; no secret values or corpus content enter fixtures; no new database, paid infrastructure, provider, retrieval runtime, or deployment is added.

## Rollback

Revert the P02 contract/test commit in each producer branch while all incumbent callers and runtime paths remain untouched. P01 repository refs and the P02 start checkpoint are the pre-contract refs. The compatibility registry remains available in the Agent Platform history. No state snapshot is required because P02 does not mutate durable operational state.

## Exit gate

P02 exits only when producer schemas and compatibility registration are present in all three participating repositories; mutation/idempotency, project-scope, client compatibility, forbidden-edge and fencing contract tests pass; touched repository suites and diff checks pass; and the authority/dependency/deletion drift audit shows no P02 runtime mutation. P01 blockers remain attached to every dependent later phase.

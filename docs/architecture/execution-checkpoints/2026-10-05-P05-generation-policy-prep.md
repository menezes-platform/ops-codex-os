# P05 — generation publication policy preparation

- `phase_id`: `P05`
- `checkpoint_id`: `P05-GENERATION-POLICY-VALIDATION-2026-10-05T03:51:52Z`
- `recorded_at`: `2026-10-05T03:51:52Z`
- `status`: `OFFLINE_GENERATION_POLICY_ONLY`
- `P05_formal_entry`: `NOT_SATISFIED`
- `P05_exit`: `NOT_PASSED`
- `frozen_spec`: `unchanged`

## Change

The P03 migration branch has a Context Store manifest contract with `current` and `previous` roles. This preparation closes the schema at its root and adds a pure, side-effect-free policy for validating manifests and planning initial publication, promotion, and rollback. Publication plans require the caller's expected current generation and an idempotency key; they retain the former current as `previous`, identify the superseded prior generation without deleting it, and advance beyond all retained generations. Each plan records both observed slot generations so a durable driver can compare-and-swap the complete current/previous pair. Rollback swaps current/previous roles only when the caller's expected current generation still matches.

The Context Store exposes these plans only through an injected generation-driver contract (`readGenerationPair` and `applyGenerationPlan`). Calls fail closed when the driver is absent. The policy performs no Drive reads/writes, index builds, embedding calls, file deletion, or canonical state mutation. A future Drive driver and Resident Node indexing runtime must apply plans with durable atomic compare-and-swap on both observed slot generations and the idempotency key, then prove that property in integration tests; the current test double and pure plans do not provide transactional or production guarantees.

## Validation

At exact branch head `e65fed3b5f70f8727c81fdd3fcaab9823a1701dc`, the complete Node test suite passed **310/310**. Dependencies were installed from this branch's exact `package-lock.json` into scratch with lifecycle scripts disabled; the scratch `node_modules` was exposed through a temporary junction only while tests ran, and the junction was removed afterward. This includes the ten generation-policy tests and the adjacent Context Gateway/Store, MCP, and Spec Kit tests. `node scripts/validate-spec-kit.js docs/architecture/spec-kit` and `git diff --check` also passed.

The first full-suite attempt used `NODE_PATH` alone; ESM test imports and the isolated Hostinger-entry test could not resolve the scratch modules, producing 10 setup failures. Rerunning with the exact scratch modules exposed at the checkout's `node_modules` path passed all 310 tests. This was a test-harness resolution issue, not a source change. These tests remain source preparation only and do not satisfy the P04 indexing-runtime entry gate, Drive-backed corpus requirement, FAISS/retrieval execution, incremental/full rebuild, durable atomic CAS, production rollback, or P05 exit.

No credentials, corpus content, Drive file, index, deployment, or Spec Kit file was read or changed by this implementation.

## Deterministic corpus manifest and update planning — 2026-10-05

The P05 draft now also builds a project-scoped corpus manifest from stable document references, paths and per-document SHA-256 hashes. It does not return or persist source content. The canonical manifest digest is independent of input ordering, and validation rejects unknown fields, duplicate references/paths, malformed hashes and cross-project scopes. The pure update planner returns `rebuild` for initial publication or profile changes, `incremental` for document additions/edits/removals, `metadata_only` when only the source revision changes, and `noop` for unchanged content and profiles. Document references must remain stable across source revisions so the planner can recognize edits.

The JSON Schema is closed and covered by contract tests. Index manifests and update plans now require explicit immutable profile references ending in `-vN` or `@vN` (optionally with a numeric dotted version), so an algorithm change cannot silently reuse the previous profile identifier. The planner performs no embedding, Drive request, index write, or generation compare-and-swap; P05 still lacks Drive-backed corpus materialization, real embedding/FAISS execution, durable incremental/full rebuild, leak testing against real project corpora, and production rollback. The frozen Spec Kit is unchanged. No real corpus or credential was read or changed.

At the resulting source tree, the full Node test discovery (`node --test`) passed **319/319**, including the new corpus contract/planner cases; the focused package script passed **57/57**. Spec Kit validation and `git diff --check` passed. Dependencies came from the existing tree with a matching lockfile hash and a temporary junction removed after validation. This is source preparation only; P05 remains `NOT_PASSED`.

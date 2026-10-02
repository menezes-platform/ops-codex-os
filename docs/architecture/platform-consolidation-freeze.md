# Platform Consolidation Architecture Freeze

**Status:** ACTIVE for the consolidation executor.
**Effective:** 2026-10-02, P00.
**Authority:** `docs/architecture/spec-kit/`; this notice applies its P00 rules and does not change the architecture.

## Scope

This freeze covers the six target repositories recorded in the P00 checkpoint:

- `menezes-platform/ops-codex-os`;
- `menezesx2k26-byte/resident-node`;
- `menezes-platform/ops-persistflow-sandbox`;
- `menezes-platform/ops-dev-orquestra`;
- `menezesx2k26-byte/ops-gabriel-ops`;
- `menezesx2k26-byte/Memory`.

The freeze is enforced in migration planning, branch work, review, and rollout decisions. Existing open work remains identified in the P00 checkpoint; this record does not close PRs, delete branches, or change live deployments.

## Frozen changes

Until the relevant Spec Kit phase authorizes a migration step, do not introduce or activate:

- another control plane, scheduler, orchestration authority, or run-state writer;
- a permanent database or new durable state authority;
- another production retrieval or model provider;
- multi-primary execution or automatic leader election;
- a paid cloud, AI, or infrastructure service without explicit authorization;
- RAGFlow serving.

Existing PRs and branches cannot expand their scope into any frozen capability. A change needed for the consolidation must fit its current phase, use the approved authority/interface, and pass its registered gates. Bounded bug fixes, read-only inventory, tests, and compatibility preparation may proceed when they do not add a new authority, control plane, provider, or deployment.

## RAGFlow serving guard

The current code hard-sets `ragflowServingEnabled` and `servingAllowed` to `false`; the focused RAGFlow suite passed 7/7, including a case that sets `RAGFLOW_SERVING_ENABLED=true` and verifies serving stays false. No serving configuration or deployment was changed in P00. Live deployment state has not yet been probed and remains an explicit P01 evidence item; this notice does not claim a live health or serving observation.

## Enforcement and review

The executor applies this freeze to every consolidation change. Existing open work is reviewed against the repository map, authority matrix, dependency graph, and phase gates before any dependent migration or deletion. The P00 checkpoint is the dated inventory snapshot; subsequent status changes require fresh GitHub evidence in P01/P08/P11.

# Platform Architecture

This directory is the global architecture authority for the platform consolidation work.

The approved design is:

- `docs/superpowers/specs/2026-10-02-platform-consolidation-design.md`

The executable architecture package is:

- `docs/architecture/spec-kit/00-constitution.md`
- `docs/architecture/spec-kit/01-current-architecture.md`
- `docs/architecture/spec-kit/02-target-architecture.md`
- `docs/architecture/spec-kit/03-authority-matrix.md`
- `docs/architecture/spec-kit/04-repository-map.md`
- `docs/architecture/spec-kit/05-dependency-graph.md`
- `docs/architecture/spec-kit/06-deletion-map.md`
- `docs/architecture/spec-kit/07-migration-phases.md`
- `docs/architecture/spec-kit/08-architecture-gates.md`
- `docs/architecture/spec-kit/09-rollout-rollback.md`
- `docs/architecture/spec-kit/10-acceptance-criteria.md`
- `docs/architecture/spec-kit/11-definition-of-done.md`
- `docs/architecture/spec-kit/12-executor-contract.md`

Until a migration phase has completed and its exit gates have passed, current runtime and repository evidence remains authoritative for operational facts. The Spec Kit defines the approved destination and migration rules; it does not fabricate current deployment state.

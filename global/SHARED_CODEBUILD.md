# Shared CodeBuild Sandbox Policy

Status: proposed global execution rule (2026-10-04)

## Default

For ordinary CI, crawling, build, test, data-collection and repository-maintenance jobs, prefer one reusable low-privilege CodeBuild sandbox over creating one CodeBuild project per task.

The shared runner is compute only. It is not a scheduler, durable authority, deploy authority, secret broker or production role.

## Repository contract

Participating repositories expose reviewed job scripts at:

```text
.codebuild/jobs/<job>.sh
```

The dispatcher may select only repository, Git ref and job name.

Do not permit caller-controlled overrides for buildspec, service role, image, privileged mode, source authentication, compute type, artifact destination, or arbitrary environment-variable sets.

## Authority and continuity

- Git remains source truth.
- PersistFlow remains durable run/takeover authority for long-running work.
- The shared runner emits execution evidence and artifacts but does not become a second control plane.
- Fresh runtime evidence outranks stale job documentation.

## Security boundary

- default-deny;
- no Secrets Manager / Parameter Store permissions;
- no production deployment permissions;
- no privileged Docker by default;
- source limited to explicitly approved repositories/namespaces;
- job path must be traversal-safe and non-symlinked;
- outputs go only to the runner's own artifact bucket/log group;
- launcher permissions remain narrower than infrastructure-administration permissions.

A GitHub CodeConnections integration must be scoped to the repositories approved for the shared sandbox.

## Sensitive exception

Sensitive, regulated, production-writer or privileged workloads keep dedicated execution boundaries.

The shared sandbox must not absorb a dedicated runner merely to reduce project count when that would collapse trust boundaries. Payroll, production credential use, destructive infrastructure changes and similar workloads remain separate unless a new security review explicitly approves convergence.

## Canonical implementation

Current implementation work lives in:

`menezes-platform/ops-infra-workbench@feat/shared-codebuild-sandbox`

Project-specific adapters/jobs remain in their owning repositories.

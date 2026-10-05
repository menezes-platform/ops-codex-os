# P10 — second Hostinger sandbox deployment follow-up

- `phase_id`: `P10`
- `checkpoint_id`: `P10-HOSTINGER-SANDBOX-2026-10-05T06:27:00Z`
- `recorded_at`: `2026-10-05T06:27:09Z`
- `status`: `LIVE_LEGACY_RELEASE_OBSERVED / PERIODIC_CALLER_CONFIGURED / ARCHIVE_GATE_CLOSED`
- `P10_archive_gate`: `NOT_PASSED`
- `DoD`: `NOT_MET`
- `work_scope`: `PUBLIC_VERSION_GET_AND_READ_ONLY_SOURCE/REF_COMPARISON`
- `frozen_spec`: `unchanged`

## Live release evidence

At `2026-10-05T06:27:08Z–06:27:09Z`, a read-only `GET` to the second Hostinger site's documented public version endpoint returned HTTP `200` and `application/json`. The bounded projection recorded project `persistflow-sandbox`, source SHA `decb89a031fdbe4cca464c50676fed8ea1073e61`, and build time `2026-09-18T00:25:02.755Z`. The source documents [`/api/version.php`](https://github.com/menezes-platform/ops-persistflow-sandbox/blob/9c1767debdb6db958aff8bcdc5403d2f3035b56c/broker/public/api/version.php) as an unauthenticated version endpoint that returns the recorded deployment SHA. The authenticated dashboard endpoint was not queried.

The returned SHA exists in [`ops-persistflow-sandbox`](https://github.com/menezes-platform/ops-persistflow-sandbox/commit/decb89a031fdbe4cca464c50676fed8ea1073e61) with commit message `feat(dashboard): expose quota-independent compute state`. Current `main` is `bc3249f2793ebc0e1abeb0dea8e0a6428f0bab65` and contains only the README/spec baseline; open draft PR #1 is at `9c1767debdb6db958aff8bcdc5403d2f3035b56c`. GitHub's exact commit comparison reports that the deployed SHA is an ancestor of PR #1's head by eight commits, while comparison against `main` is diverged. Thus the public site is serving code represented on the open draft branch, not a commit on current `main`.

The deployment contract in [`docs/hostinger.md`](https://github.com/menezes-platform/ops-persistflow-sandbox/blob/9c1767debdb6db958aff8bcdc5403d2f3035b56c/docs/hostinger.md) assigns that second Hostinger site the PHP/MySQL broker, dashboard, workspace registry, job broker, provider gateway, and durable operational state. This is separate from the Node.js `darkslategrey-raccoon` Hostinger site inspected for P03.

## Public version recheck — 2026-10-05T08:42:52Z

A second unauthenticated `GET` to the documented public version endpoint returned HTTP **200** with project `persistflow-sandbox` and the same source SHA `decb89a031fdbe4cca464c50676fed8ea1073e61`. The selected `build_time` property was absent from this response. This confirms that the publicly served legacy release remains present at this time; it does not show whether any request came from the configured collector, identify the active dashboard/broker behavior, or provide a release/build timestamp. No authenticated dashboard or state was read, and no deployment or configuration was changed. P10 remains `NOT_PASSED`; the archive gate stays closed.

## Configured caller evidence

Gabriel Ops `main` at `8dfcca2d544655b7317671fbc0d007c8d961c674` contains [`fetch-sandbox-snapshot.py`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/scripts/fetch-sandbox-snapshot.py), which obtains a dashboard bearer token from the private runtime configuration over SSH and sends an authenticated HTTP `GET` to the sandbox dashboard API. [`sync-private-sources.mjs`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/scripts/sync-private-sources.mjs) also requests the sandbox version endpoint, labels the result as a `sandbox` source envelope, and publishes the projection to Gabriel Ops machine-ingest. The [`install-private-source-task.ps1` installer](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/scripts/install-private-source-task.ps1) configures `GabrielOps-PrivateSourceSync` on a five-minute repetition interval; [P03 Windows metadata evidence](2026-10-05-P03-desktop-authority-and-fleet-refresh.md) observed that task in `Ready` state on one host.

This establishes a deployed legacy sandbox service and a matching configured collector path. It does not establish the collector's last successful run or a current authenticated dashboard request: `Ready` is a scheduler state, not a run receipt, and the task's effective environment was not read. The task source describes a projection read; this does not prove a write to the sandbox or prove zero dependency on its dashboard/broker. No token, runtime config content, dashboard payload, or protected API response was read.

## P10 disposition

Do not archive `ops-persistflow-sandbox` or remove its Hostinger deployment on this evidence. P10 remains `NOT_PASSED`: the live site still reports a release from the open draft line, and Gabriel Ops has a five-minute collector configured to read it. Before archive, migrate or explicitly disposition the broker/dashboard/workspace/job/provider capabilities, identify the collector's owner and last successful run, prove caller zero after cutover, and verify state migration and rollback/preservation receipts. No deployment, endpoint configuration, state, workflow, or repository ref was changed.

## Draft-branch architecture note — 2026-10-05T07:25Z

The frozen target was compared with the Sandbox README on default `main` and existing draft PR #1. Main remains at `bc3249f2793ebc0e1abeb0dea8e0a6428f0bab65`; the README still uses the old canonical `Gabriel-Codex-OS` identity and says implementation has not started. Draft PR #1 head `c03c9bea2c7d36021d4aebd37ecf091e8d0d36a8` changes only README.md and docs/hostinger.md to align intended ownership with the frozen target and mark the Hostinger guide as the earlier deployment contract, while separately identifying the live Hostinger service and configured projection collector as unresolved dependencies. Its PR body retains the draft status and explicitly leaves P10 NOT PASSED. No CI result was checked, and no production deployment, endpoint, state, or runtime source changed. This is a proposed branch correction only; it does not certify the live service or pass P10/P11.

## Historical design and plan labeling — 2026-10-05T07:30Z

Draft PR #1 head `dba5f9cd54f2c70c9765b3f832876d2da9b7c195` also labels the prior v2 architecture design and v1 implementation plan as historical, while preserving their original contents. Those files previously described their design as approved and assigned the controller/run-state boundary to the old Gabriel-Codex-OS/Hostinger layout; the new note says the frozen consolidation Spec Kit governs current target ownership and does not prove deployed behavior. This changes documentation on the draft branch only. No CI, deployment, data, or runtime source was changed or checked. P10 remains NOT_PASSED; no live dependency is eligible for archive or deletion.

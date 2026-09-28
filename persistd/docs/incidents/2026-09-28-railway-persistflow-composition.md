# Incident: Railway ephemeral provider was not in an executable PersistFlow path

Date: 2026-09-28

Scope: composition audit and bounded implementation work in `menezes-platform/ops-codex-os`.

No Railway project, service, deployment, environment variable, or production feature gate was changed during this investigation.

## Symptom

`RailwayAnonymousProvider` and `EphemeralWorkerLoop` were present after PR #19, but PersistFlow's production entrypoint did not construct either. `PersistFlowService.routeTask` only called `FleetRouter.route` and durably wrote the routing decision; it did not acquire a provider or dispatch a command.

## Evidence and cause

- Audited `main` at `f3ff7e7f46fdb0bd5bbf4f24bcb541467d8b26ce`, including post-PR #19 commits, PR #19, and draft PR #20.
- `persistd/src/start-entrypoint.js` created only `FleetRouter` and `TypeSafeFleetRouter` behind `PERSISTFLOW_FLEET_ROUTER_ENABLED`.
- The existing `FleetRouter` only selected registered nodes requiring a fresh heartbeat. No anonymous provider candidate or execution path was composed.
- `persistd/src/fleet/node-agent.js` posts heartbeats and requests Drive access; it exposes no command dispatch endpoint. Therefore a route to a persistent node is not proof that this repository executed a command there.
- The Railway API currently lists `gabriel-ops` and `persistflow-sandbox-workers`. Its `gabriel-ops` service is linked to `menezesx2k26-byte/ops-gabriel-ops`, branch `main`; its configured variables do not include `PERSISTFLOW_URL`. The repository README describes a Cloudflare/Node dashboard with a PersistFlow adapter, not the PersistFlow authority process.
- `persistflow-sandbox-workers` currently lists four older services (`browser-provider-spike`, `browser-provider-spike-v2`, `hostinger-deployer`, and `aki-recovery-probe`) plus staged environment work. No PersistFlow service was present, and no persistent worker service was created.
- Railway's official anonymous offer documents `ssh railway.new`, 2 vCPU / 2 GB RAM, a 60 minute build window, a 24 hour claim window, and three boxes per IP per day. Anonymous boxes do not appear as account services; provider release can remove the local key, while the VM expires under Railway's offer lifecycle.

## Corrections made in this branch

- Reused `RailwayAnonymousProvider` and `EphemeralWorkerLoop`; added the default-off gate `PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED` and composed them only with the existing fleet-router gate.
- Added a hard-eligible virtual Railway candidate, existing TypeSafe scoring, a deterministic preference for explicitly requested `ephemeral-worker`, route evidence, and fixed resource/scratch limits.
- Added `persist_fleet_execute_ephemeral`, which stores operation identity and command digest before acquisition, suppresses duplicate execution after reconnect/restart, writes safe lifecycle checkpoints, and supports a bounded cooperative resume-marker handoff.
- Added regression tests for gate-off behavior, gate-on selection, quota serialization, secret scrubbing, MCP invocation, client disconnect, restart deduplication, fallback routing, G1→G2 ordering, successor acquisition failure, and finalization failure.
- Added this handoff record because the verified deployment target does not host PersistFlow; production rollout is blocked until the actual authority endpoint/runtime is identified and the branch is built/deployed there.

## Verification defect found and fixed

During focused tests, the operation status changed from `COMPLETED` back to `RUNNING` because the cleanup event used the generic status transition. The release event now preserves the terminal operation status. The regression is covered in `persistflow-fleet-integration.test.js`.

## Tooling access failure and recovery

An attempted local clone of private `ops-gabriel-ops` failed because this shell has no GitHub terminal credential (`could not read Username for 'https://github.com'`). The read-only investigation continued through the authorized GitHub connector; no credential was requested or copied into the shell.

## Runtime smoke blocked

- Ran the bounded `npm run fleet:railway:smoke` through `PersistFlowService` once. It stopped at `RAILWAY_ANON_MANIFEST_MISSING`; no command execution, durable completion event, or remote worker identity was produced.
- A non-provisioning DNS check from this execution runtime returned `EAI_AGAIN` for `railway.new`. The provider removes its generated key material after the manifest error; its local success-only quota ledger remained absent. The outcome of the attempted anonymous SSH request on Railway's side cannot be verified from this environment, so no further anonymous provisioning attempt was made.
- The live Cloudflare Worker settings for `gabriel-ops` expose binding names only in this audit; there is no PersistFlow endpoint/token binding. Railway project inventory also contains no deployed PersistFlow authority. Thus this branch has no identified production endpoint on which to enable the feature or prove a production restart/disconnect path.
- Final local verification after installing declared root dependencies: Railway/PersistFlow focused tests 36/36; PersistFlow suite 230/230; root suite 12/12; `git diff --check` clean. No lint/typecheck script is defined in either package manifest.
- Production rollout, real Railway completion proof, Desktop-offload proof, CI result, and rollback exercise remain blocked. Both required gates remain default-off; no Railway persistent service or deployment was changed.

## Prevention

- Keep executable composition tests at the production PersistFlow service boundary, not only provider/loop unit tests.
- Verify the actual deployed source repository and runtime before describing a branch as rolled out.
- Keep Railway feature gates off until the target PersistFlow authority is identified, durable storage is confirmed, and a bounded runtime smoke is recorded.
- Do not treat a FleetRouter node choice as execution proof until a real node dispatch contract exists.

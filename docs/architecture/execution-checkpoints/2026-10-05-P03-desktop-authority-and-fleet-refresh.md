# P03 — desktop authority metadata and production fleet refresh

- `phase_id`: `P03`
- `checkpoint_id`: `P03-DESKTOP-AUTHORITY-FLEET-2026-10-05T05:10:00Z`
- `recorded_at`: `2026-10-05T05:10:00Z`
- `status`: `BLOCKED / TWO_AUTHORITY_CANDIDATES / FLEET_EMPTY`
- `frozen_spec`: `unchanged`
- `work_scope`: read-only GitHub Actions metadata/log review and read-only production fleet/cache status

## Windows host evidence

The private self-hosted Windows runner in `ops-gabriel-ops` completed [P03 installed caller metadata run #37232828291](https://github.com/menezesx2k26-byte/ops-gabriel-ops/actions/runs/37232828291) on `2026-10-04T20:37:00.5736599Z` (job completed successfully at `20:38:03Z`). It ran workflow source at commit `af355080ae27df6c77613e792efd025ef958e000`, file `.github/workflows/fleet-ssh-diagnostics.yml`, blob `13025d808a758ca6d0ec3ce2bdf0c2b823017e6b`. The workflow explicitly limits itself to one Windows host, metadata only, and is not a global caller census. It declares that it does not execute launcher scripts or read secret files; its environment projection records selected variable names and safe URL origins, never the fleet ID or secret values.

Observed from that one host:

- Registry metadata in `User` scope lists both `PERSISTFLOW_FLEET_NODE_ID` and `PERSISTFLOW_FLEET_NODE_SECRET`. The workflow did not read either value or establish that either value is non-empty or accepted by the server. No fleet-node variables were listed in `Machine` scope. Process-scope variable names are intentionally not collected; it did observe `GABRIEL_OPS_URL` and `PERSISTFLOW_BASE_URL` origins there.
- Eight matching scheduled tasks were found. Their static action metadata was:

  | Task | State | Executable / script basename |
  | --- | --- | --- |
  | `Gabriel PersistFlow Authority` | `Running` | `powershell.exe` / `run-authority.ps1` |
  | `Gabriel Fleet Agent` | `Ready` | `node.exe` / `node-agent.js` |
  | `GabrielFleet-Relay` | `Ready` | `powershell.exe` / `start-relay.ps1` |
  | `GabrielFleet-AKIMCP` | `Ready` | `powershell.exe` / `start-akimcp.ps1` |
  | `GabrielOps-ActionsRunner` | `Running` | `cmd.exe` / no script path in the projection |
  | `GabrielOps-PrivateSourceSync` | `Ready` | `wscript.exe` / `run-private-source-sync-hidden.vbs` |
  | `persistd` | `Disabled` | `node.exe` / `daemon.js` |
  | `persistd-tiktok-live-dungeon` | `Disabled` | `node.exe` / `daemon.js` |

  These are scheduled-task states and static action basenames; `Ready` does not mean a task is currently executing. The workflow did not run these scripts. This is installed-host evidence, not proof of which component is writing authoritative state.
- `http://127.0.0.1:39091/healthz` returned a successful metadata projection with `authority=file` and `durable=true`.
- One candidate authority data directory existed; the launcher projection was `static_only_not_runtime_environment`, so its configured paths are not verified runtime resolution.
- The host reported 32 Tailscale peers, 26 online. Peer names were not copied into this checkpoint. This remains one-host topology only.
- A matching Windows service for the self-hosted Actions runner was observed `Stopped` with `Automatic` start mode, despite this completed workflow run. Current runner service state requires a fresh check.

## PersistFlow service state

At approximately `2026-10-05T04:40Z`, the authenticated read-only production fleet and cache status operations again returned `fleet.nodes=[]` and `cache.nodes=[]`. The empty projections do not show that the configured ID or secret is wrong. They also do not explain why a Windows host with the two variable names present and a running Fleet Agent task has not appeared in the server registry.

The separately observed Hostinger service also returned `authority=file` and `durable=true` on `/healthz` in the P03 smoke follow-up. The Windows loopback and Hostinger endpoints are therefore two healthy file-authority candidates. Their storage identity, write activity, replication relationship, and primary/failover roles remain unverified; this is not yet proof of duplicate writes, but it prevents a sole-primary claim.

## Disposition

`P03 / HG-001` remains `BLOCKED / NOT_PASSED`. Required evidence still includes mapping the local Windows and Hostinger endpoints to their state roots and writers, proving exactly one authoritative primary, establishing the deployed worker identity/enrollment/transport, completing the global production-caller census, and verifying a current rollback artifact. Do not infer a bad secret from empty fleet status; its value was never read. No secret was changed or copied by the agent, and no service, task, data, or deployment was modified.

Evidence boundaries: a successful metadata workflow does not prove global coverage or runtime invocation; environment-variable names do not validate values; a health endpoint does not prove uniqueness; online Tailscale peers do not prove PersistFlow enrollment.

## Fresh Windows host refresh

The same metadata-only workflow completed successfully again as [run #37266393300](https://github.com/menezesx2k26-byte/ops-gabriel-ops/actions/runs/37266393300) on commit `af355080ae27df6c77613e792efd025ef958e000`. Its host-reported `observedAt` is `2026-10-05T05:06:56.8747934Z`; GitHub reports the job started at `05:07:44Z`, about 47 seconds later. Treat the host clock as unsynchronized and use the GitHub run for the capture window.

The refreshed projection again lists `PERSISTFLOW_FLEET_NODE_ID` and `PERSISTFLOW_FLEET_NODE_SECRET` in the `User` registry scope, with no matching names in `Machine`; the workflow did not read their values. The persisted `Gabriel PersistFlow Authority` task is `Running`, while `Gabriel Fleet Agent`, `GabrielFleet-Relay`, `GabrielFleet-AKIMCP`, and `GabrielOps-PrivateSourceSync` are `Ready`; the `persistd` tasks are `Disabled`. The `GabrielOps-ActionsRunner` task is `Running`, but its separate Windows service is `Stopped` with `Auto` start mode. This is scheduler/service metadata only and does not establish the process environment or an active Fleet Agent.

Loopback `/healthz` again returned `200`, `authority=file`, `durable=true`. The launcher configuration remains `static_only_not_runtime_environment`; four directories were enumerated as candidates, not verified as the process's effective state root. Tailscale reported 32 peers/26 online; peer names are omitted. The refreshed authenticated fleet and cache calls at approximately `05:08Z` again returned `fleet.nodes=[]` and `cache.nodes=[]`. Public Hostinger `/healthz` and edge OAuth metadata returned `200`; unauthenticated edge `/mcp` returned `401`. These observations still leave two healthy file-authority candidates and do not validate the desktop secret, prove a duplicate writer, or establish global caller coverage.

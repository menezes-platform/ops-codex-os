# Incident: production PersistFlow deployment target was misidentified

Date: 2026-09-28

Scope: follow-up runtime audit after PR #24 merged as `d6eec994de5543e490f69ee098a59626d576ec11`.

## Symptom

The Railway anonymous provider composition is in `main`, but there is still no evidence that the production PersistFlow authority loaded it or completed a remote execution.

## Cause and evidence

- The Hostinger account's only Node.js website is `darkslategrey-raccoon-448222.hostingersite.com`, user `u775492464`. Its only build is completed from `menezesx2k26/api-reference`, branch `main`, commit `04b62659b714968ae49f2a79cf58b578768e5c3b`, not from PersistFlow. Build settings are `app_type=other`, Node 24, no entry file, and no environment variables.
- The Hostinger site returns HTTP 403 at `/` and HTTP 404 at `/healthz`; the Node runtime log endpoint has zero lines. It is not a valid PersistFlow production target and must not be repurposed.
- Live Railway inventory contains project `gabriel-ops`, whose service deploys `menezesx2k26-byte/ops-gabriel-ops`, and project `persistflow-sandbox-workers`, whose four services are unrelated legacy probes/deployers. Neither is a PersistFlow authority. No persistent ephemeral-worker service was created.
- The current `ops-gabriel-ops` operational snapshot documents a Tailscale machine named `persistflow` at `100.94.66.6` (SSH alias user `azureuser`). Prior SSH discovery dated 2026-09-21 recorded connectivity, but that is stale evidence and does not prove current liveness.
- Calls to the available PersistFlow `persist_run_start` and `persist_run_inspect` MCP tools returned MCP `-32603 Internal error`. The cause is unknown; this alone does not prove the production authority is down.
- The earlier bounded Railway attempt ended at `RAILWAY_ANON_MANIFEST_MISSING` after DNS returned `EAI_AGAIN` for `railway.new`. Whether that request consumed anonymous quota cannot be verified here, so no further provisioning attempt was made.

## Post-auth verification

After the user completed Tailscale authorization, the device record for `persistflow.tailacdd21.ts.net` (`100.94.66.6`) showed `connectedToControl=false`, last seen `2026-09-25T07:45:54Z`, and `sshEnabled=false`. The device remains authorized but is offline from Tailscale and Tailscale SSH is disabled. No remote shell, service restart, or workload execution was attempted. The separate `aws-vm` device was not accessed.

## Correction

Do not deploy to the Hostinger `api-reference` site or to the Gabriel Ops gateway. Restore an approved management path to the actual PersistFlow Tailscale node, then verify its current source, entrypoint, durable store, and health. Deploy the merged `ops-codex-os/main` code to that verified authority with both Railway gates off, then perform a bounded health/restart check. Enable the gates only after the authority and persistence checks pass. Do not retry anonymous provisioning until the prior attempt's quota impact is resolved.

## Regression guard

Before future rollout claims, capture the deployed repository/commit, entrypoint, health response, authority backend, and environment variable names (never values) from the exact runtime being changed. A Hostinger domain, Railway project name, dashboard snapshot, or stale SSH record is not sufficient proof by itself.

## Remaining blocker

The documented PersistFlow device is currently offline and Tailscale SSH is disabled; the mechanism to restore that host or access its deployment controls is not established in this session. Production deployment, Railway completion, Desktop-offload proof, handoff runtime proof, and rollback exercise remain unverified.

## Test of correction

Re-read the live Tailscale device record after authorization and confirmed the persisted offline/SSH-disabled state. Regression check: future rollout must fail closed until the correct PersistFlow authority is reachable and identified; do not substitute the retired AWS VM or the Desktop.

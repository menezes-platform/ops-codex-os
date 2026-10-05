# P03 — Hostinger post-apply refresh

- `phase_id`: `P03`
- `checkpoint_id`: `P03-HOSTINGER-POST-APPLY-REFRESH-2026-10-05T10:38Z`
- `recorded_at`: `2026-10-05T10:38:52Z`
- `status`: `CURRENT_DEPLOYMENT_COMPLETE_HEALTH_OK_STATE_ROOT_UNMAPPED`
- `P03_exit`: `NOT_PASSED`
- `HG-001`: `OPEN`
- `DoD`: `NOT_MET`
- `frozen_spec`: `unchanged`
- `evidence_scope`: read-only hPanel deployment details and public unauthenticated `GET /healthz`

## Observed

The hPanel deployment list and details page showed deployment `01a1094e-4561-7179-a9e5-e00378da3390` as current and completed. The UI displayed its time as `2026-10-04 23:44:46` without a timezone label, and archive `persistflow-rfc9207-20260929.zip`. The visible deployment log said `Source: previous deployment source`, restored source files from the last successful deployment, and then prepared Node.js 24 with npm, no build command, no output directory, entry `src/hostinger-entry.js`, and environment variables loaded from `.env`. The UI did not expose a repository commit for this deployment.

At approximately `2026-10-05T05:56Z`, a public `GET https://darkslategrey-raccoon-448222.hostingersite.com/healthz` returned HTTP `200` with `{"ok":true,"service":"persistflow","authority":"file","durable":true}`. At approximately `05:57Z`, authenticated read-only PersistFlow status returned `fleet.nodes=[]` and `cache.nodes=[]`. These verify public health and the current empty projections only. They do not verify the secret value, prove that the Node process consumed the corrected setting, map the file-backed authority path, or certify a current backup/rollback snapshot.

## Public endpoint refresh — 2026-10-05T08:53Z

Fresh unauthenticated `GET` requests returned HTTP `200` from `/healthz` (`service=persistflow`, `authority=file`, `durable=true`) and `/.well-known/oauth-authorization-server` (issuer matched the site origin; authorization, token, and registration endpoint fields were present). An unauthenticated `GET /mcp` returned `401`. These bounded results confirm public health, OAuth metadata, and rejection of an unauthenticated MCP request. They do not prove that the corrected fleet-secret JSON was consumed by the running process, establish a current authenticated fleet/cache projection, identify global callers/authority roots, or verify rollback. No credential was read or sent; no deployment or runtime configuration changed. P03 remains `NOT_PASSED`.

## Authenticated status projection refresh — 2026-10-05T08:55:31Z

Using the existing active read-only Composio MCP connection, `persist_fleet_status` and `persist_cache_status` both returned successfully. The bounded responses were `fleet.nodes=[]` and `cache.nodes=[]`. No run, heartbeat, route, enrollment, mutation, or ephemeral execution tool was called, and no credential value was read. This confirms the authenticated status-read path for that connection and that its current projections contain no registered/reporting nodes. It does not prove global hosts or callers are absent, map the running Node process or file-backed authority root, or prove the fleet-secret JSON was consumed. P03/HG-001 remains `NOT_PASSED`.

No environment values or secrets were opened. No deployment, restart, source change, or production write was performed.

## Gate impact

The latest Hostinger deployment remains healthy and current in hPanel, but it restored the previously successful source archive rather than identifying a new source revision. The running service still reports file authority, while the actual state root, writers, and local Windows authority candidate are unresolved. Keep HG-001 and P03 open; do not infer a single primary from health or a relative file-browser directory listing. The unreadable `.persistflow-data` listing is separately recorded in [P03 Hostinger File Browser follow-up](2026-10-05-P03-hostinger-filebrowser-followup.md).

## Public health spot check — 2026-10-05T09:19:32Z

A fresh unauthenticated direct `GET https://darkslategrey-raccoon-448222.hostingersite.com/healthz` returned HTTP `200` with `{"ok":true,"service":"persistflow","authority":"file","durable":true}`. The latest recorded authenticated read-only `persist_fleet_status`/`persist_cache_status` result remains the 08:55Z call, which returned empty node projections. This health check does not establish that the corrected fleet-secret JSON was consumed, map the process or file-backed root, prove global caller/host zero, or verify rollback. No secret value was read or runtime changed. P03/HG-001 remains `NOT_PASSED`.

## Authenticated status projection refresh — 2026-10-05T09:20Z

Through the existing active read-only Composio MCP connection, `persist_fleet_status` and `persist_cache_status` both succeeded. Their bounded responses were `fleet.nodes=[]` and `cache.nodes=[]`. No sandbox job/inspect, run, heartbeat, enrollment, mutation, or ephemeral execution tool was called; no credential value was read. This refresh confirms only the authenticated status-read path and empty projections at this time. It does not prove secret consumption, all hosts/callers are absent, map the process or file-backed authority root, or verify rollback. P03/HG-001 remains `NOT_PASSED`.

## Public endpoint recheck — 2026-10-05T09:31Z

Fresh unauthenticated direct GETs returned HTTP `200` from `/healthz` (`service=persistflow`, `authority=file`, `durable=true`) and `/.well-known/oauth-authorization-server` (issuer and authorization/token/registration endpoints matched the Hostinger origin). Unauthenticated `GET /mcp` returned `401`. These checks confirm public health, metadata discovery, and rejection of an unauthenticated MCP request; they do not prove the fleet-secret JSON was consumed, authenticate a fleet node, map state roots, or establish the sole primary. No credential or protected payload was read, and no runtime setting changed. P03/HG-001 remains `NOT_PASSED`.

## Post-apply public and authenticated status refresh — 2026-10-05T10:38Z

After the owner reported applying the Hostinger fleet-secret JSON correction, unauthenticated GETs returned HTTP `200` from `/healthz` (`service=persistflow`, `authority=file`, `durable=true`) and `/.well-known/oauth-authorization-server` (issuer matches the Hostinger origin), and HTTP `401` from `/mcp`. Through the existing active Composio connection, read-only `persist_fleet_status` and `persist_cache_status` calls both succeeded and again returned `fleet.nodes=[]` and `cache.nodes=[]`. No credential value was read; no run, heartbeat, enrollment, mutation, or ephemeral execution tool was called. The healthy public process and empty status projections do not prove that the process consumed the corrected JSON, that the desktop agent authenticated, that callers are globally absent, or that the Hostinger file authority is the sole primary. P03/HG-001 remains `NOT_PASSED`.

# P03 — Hostinger post-apply refresh

- `phase_id`: `P03`
- `checkpoint_id`: `P03-HOSTINGER-POST-APPLY-REFRESH-2026-10-05T05:57Z`
- `recorded_at`: `2026-10-05T05:57:32Z`
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

No environment values or secrets were opened. No deployment, restart, source change, or production write was performed.

## Gate impact

The latest Hostinger deployment remains healthy and current in hPanel, but it restored the previously successful source archive rather than identifying a new source revision. The running service still reports file authority, while the actual state root, writers, and local Windows authority candidate are unresolved. Keep HG-001 and P03 open; do not infer a single primary from health or a relative file-browser directory listing. The unreadable `.persistflow-data` listing is separately recorded in [P03 Hostinger File Browser follow-up](2026-10-05-P03-hostinger-filebrowser-followup.md).

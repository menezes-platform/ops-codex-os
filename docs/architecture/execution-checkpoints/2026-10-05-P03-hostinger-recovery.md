# P03 — post-application Hostinger recovery checkpoint

- `phase_id`: `P03`
- `checkpoint_id`: `P03-HOSTINGER-RECOVERY-2026-10-05T01:55:51Z`
- `recorded_at`: `2026-10-05T01:55:51Z`
- `status`: `HOSTINGER_STARTUP_HEALTHY_VM_CALLERS_AND_ROLLBACK_UNRESOLVED`
- `P03_exit`: `NOT_PASSED`
- `P04_formal_entry`: `NOT_SATISFIED`
- `P04_source_preparation`: `RESIDENT_NODE_DRAFT_PR_1_CI_PENDING`
- `DoD`: `NOT_MET`
- `authorization`: `Continue through the frozen DoD; when a P0n phase is blocked, advance independent preparation while leaving that phase's gates pending.`
- `frozen_spec`: `unchanged`

## Recovery reported by the owner and independently observed

The owner reported correcting and applying `PERSISTFLOW_FLEET_NODE_SECRETS_JSON` in hPanel while preserving existing fleet IDs and secret values. No secret value was read, copied, or recorded by the agent. The owner handled the environment change and application; this checkpoint records only read-only verification afterward. The deployment identifier and exact panel deployment timestamp were not recaptured here.

At `2026-10-05T01:55:33.0068342Z–01:55:33.6616810Z`, bounded GET probes returned:

| Origin / route | Result | Interpretation |
| --- | --- | --- |
| `https://darkslategrey-raccoon-448222.hostingersite.com/healthz` | HTTP `200`, `{"ok":true,"service":"persistflow","authority":"file","durable":true}` | Startup and the currently reported file authority are healthy at this moment. This is not a caller census or proof of unique global authority. |
| Hostinger `/.well-known/oauth-authorization-server` | HTTP `200`, JSON metadata | Public authorization-server metadata is being served. No token was requested or returned. |
| Hostinger `/mcp` without a bearer | HTTP `401`, `{"error":"unauthorized"}` | The endpoint requires authentication on this unauthenticated GET. This does not prove an authenticated caller path. |
| `https://gabriel-aws-mcp-edge.menezesx2k26.workers.dev/.well-known/oauth-authorization-server` | HTTP `200`, JSON metadata | The edge metadata route is responsive. No token was requested or returned. |
| Cloudflare edge `/mcp` without a bearer | HTTP `401`, `{"error":"unauthorized"}` | The unauthenticated edge request is rejected. This does not certify the deployed caller inventory. |

The existing active Composio connection `custom_gabriel_remote_mcp_atual_odal-wenny` executed only `persist_fleet_status` and `persist_cache_status` at `2026-10-05T01:55:49Z–01:55:51Z`. Both calls succeeded; responses were `fleet.nodes=[]` and `cache.nodes=[]`, log `log_83ha1-iezUE1`. These are empty projections for that MCP endpoint and instant, not proof that every external host, caller, writer, or worker is absent.

No dispatch, heartbeat, node enrollment, job/run operation, OAuth mutation, or production write was performed in this verification. No credential or response body containing credentials was exposed.

## Gates still open

- **P03 remains `NOT_PASSED`.** Current service health is restored, but the VM/collector's actual tasks, units, process environment, storage paths, origins, and heartbeat destination remain unresolved. The global caller/writer inventory is still unknown; no proof establishes a single primary or Agent Platform authority-store count of zero.
- **HG-001 rollback mapping remains open.** The 2026-10-03 fenced capture and restore remain mechanically valid for their recorded bytes. They predate subsequent owner configuration changes and do not certify the current host state or a current cutover rollback snapshot.
- **P04 formal entry remains unsatisfied.** [`resident-node` draft PR #1](https://github.com/menezesx2k26-byte/resident-node/pull/1) prepares source-level lease/epoch fencing only. Its cross-platform CI is not yet a P04 exit; authenticated worker binding/transport, production migration receipt, current rollback proof, and runtime integration are absent.
- **Frozen Definition of Done remains `NOT_MET`.** This recovery proves service startup and expected unauthenticated rejection only.

No source deployment, database migration, worker enrollment, service restart, state mutation, deletion, or archive was performed by the agent during this checkpoint. The frozen Spec Kit and prior authority/rollback evidence were not rewritten or reclassified.

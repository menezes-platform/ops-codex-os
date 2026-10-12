# P03 — public runtime smoke follow-up

- `phase_id`: `P03`
- `checkpoint_id`: `P03-PUBLIC-SMOKE-AND-STATUS-REVALIDATION-2026-10-05T04:26:00Z`
- `recorded_at`: `2026-10-05T04:26:00Z`
- `status`: `PUBLIC_SERVICE_SMOKE_REVALIDATED_CALLER_AND_ROLLBACK_MAPPING_OPEN`
- `P03_exit`: `NOT_PASSED`
- `P04_formal_entry`: `NOT_SATISFIED`
- `DoD`: `NOT_MET`
- `work_scope`: `UNAUTHENTICATED_PUBLIC_HTTPS_GET_PROBES_ONLY`
- `frozen_spec`: `unchanged`

## Probe results

Unauthenticated GET probes ran from `2026-10-05T03:46:29.956Z` through `2026-10-05T03:46:30.169Z` against the existing Hostinger origin:

| Route | Result | Safe fields retained |
| --- | --- | --- |
| `/healthz` | HTTP `200` | `service=persistflow`, `authority=file`, `durable=true` |
| `/.well-known/oauth-authorization-server` | HTTP `200` | issuer matches the origin; authorization, token, and registration endpoint fields are present |
| `/mcp` | HTTP `401` | unauthenticated request is rejected |

No bearer token or other credential was sent or received. Only the status codes and listed booleans/fields were retained; no token endpoint or mutating operation was called.

## Gate impact

This repeats bounded evidence that the public service starts, serves its OAuth metadata, and challenges unauthenticated MCP access. `authority=file` is the service's reported mode at the probe time; it does not prove that this is the sole global writer or identify the VM/collector's actual processes, installed origins, heartbeat destination, or callers.

P03 remains `NOT_PASSED`: the global caller/writer census, actual VM service/configuration map, unique-primary proof, and a fresh verified rollback snapshot remain open. P04 formal entry remains unsatisfied. The frozen DoD remains `NOT_MET`.

No hPanel change, deployment, restart, authenticated MCP dispatch, node enrollment, migration, state mutation, deletion, or archive was performed for this probe.

## Revalidation after the owner-applied configuration

Fresh unauthenticated GETs ran at `2026-10-05T04:19:59.7429087Z–04:20:00.0262123Z`:

| Route | Result | Safe fields retained |
| --- | --- | --- |
| `/healthz` | HTTP `200` | `service=persistflow`, `authority=file`, `durable=true` |
| `/.well-known/oauth-authorization-server` | HTTP `200` | issuer matches the origin; authorization, token, and registration endpoint fields are present |
| `/mcp` | HTTP `401` | unauthenticated request is rejected |

The authenticated hPanel deployment-detail page for deployment `01a1094e-4561-7179-a9e5-e00378da3390` reports `Concluído`, with Node `24.x`, entry file `src/hostinger-entry.js`, environment variables loaded from `.env`, and a successful application restart. Its log says the source was restored from the previous successful deployment; the displayed deployment time is `2026-10-04 23:44` with no timezone label. This confirms the observed app starts after the owner-applied configuration. The secret JSON value was not read, copied into evidence, or otherwise recorded.

This is still bounded public runtime evidence: `authority=file` does not establish a unique global writer, a complete caller census, the installed VM/collector configuration, or a current migration rollback point. P03 remains `NOT_PASSED`; P04 remains ineligible.

## Authenticated fleet/cache status recheck

The already-authorized read-only MCP calls `persist_fleet_status` and `persist_cache_status` both succeeded at `2026-10-05T04:25:51Z–04:25:54Z`. The responses were `fleet.nodes=[]` and `cache.nodes=[]` (Composio log `log_ees9J9cYXA5-`). No run, heartbeat, route, job, ephemeral operation, enrollment, or mutating MCP tool was called.

These empty projections establish that no nodes were listed by these status responses at that time. They do not establish `callers=0`, prove that every external machine is absent, validate a secret value, or replace the VM/service/caller inventory. P03 remains `NOT_PASSED` and P04 remains ineligible.

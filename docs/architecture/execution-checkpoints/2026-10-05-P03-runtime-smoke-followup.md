# P03 — public runtime smoke follow-up

- `phase_id`: `P03`
- `checkpoint_id`: `P03-PUBLIC-SMOKE-FOLLOWUP-2026-10-05T03:46:30Z`
- `recorded_at`: `2026-10-05T03:46:30Z`
- `status`: `PUBLIC_SERVICE_SMOKE_HEALTHY_CALLER_AND_ROLLBACK_MAPPING_OPEN`
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

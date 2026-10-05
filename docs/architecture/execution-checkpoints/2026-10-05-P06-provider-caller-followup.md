# P06 — provider caller follow-up

- `phase_id`: `P06`
- `checkpoint_id`: `P06-CALLERS-2026-10-05T06:10:00Z`
- `recorded_at`: `2026-10-05T06:10:00Z`
- `status`: `SOURCE_DIRECT_CALLER_CONFIRMED / LIVE_USE_UNRESOLVED / EXIT_NOT_PASSED`
- `P06_exit`: `NOT_PASSED`
- `DoD`: `NOT_MET`
- `work_scope`: `READ_ONLY_DEFAULT_BRANCH_SOURCE_AND_EXISTING_RUN_HISTORY`
- `frozen_spec`: `unchanged`

## Findings

| Candidate | Evidence | Classification |
| --- | --- | --- |
| Gabriel Ops Dashboard DoD swarm | At `ops-gabriel-ops@8dfcca2d544655b7317671fbc0d007c8d961c674`, [`run-dashboard-agent.ps1`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/scripts/run-dashboard-agent.ps1) builds OpenCode provider configuration for Groq, Mistral, OpenRouter and Gemini using provider-specific key *names* and endpoints, then passes those routes to `opencode run`. [`launch-dashboard-swarm.ps1`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/scripts/launch-dashboard-swarm.ps1) selects these direct API routes and also has OmniRoute fallback routes. [`dashboard-dod-swarm.yml`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/.github/workflows/dashboard-dod-swarm.yml) runs on a self-hosted Windows runner and injects provider credential references by secret name. | `DIRECT_PROVIDER_CALLER_IN_SOURCE / PLATFORM_OWNERSHIP_AND_CURRENT_USE_UNRESOLVED`. This is a P06 bypass candidate that prevents a zero-bypass claim until ownership and deployment are resolved or the path is migrated. No secret values were read. |
| Dashboard DoD swarm run history | The existing read-only workflow-history result contained two `push` runs on `main`: one failed at `2026-09-19T02:39:52Z` and one succeeded at `2026-09-19T02:43:17Z`. The returned history contained no later run. Run logs/provider requests were not inspected, so the successful workflow result does not prove which upstream was called or whether provider credentials were used. | `HISTORICAL_WORKFLOW_EXECUTION_OBSERVED / UPSTREAM_CALL_UNPROVEN`. It establishes that this workflow executed successfully in the past, not that its direct-provider path is active now. |
| Orquestra OmniRoute MCP | At `ops-dev-orquestra@26c8e80dd6bacd9abc938af8a7da51b3d1abede2`, [`client.py`](https://github.com/menezes-platform/ops-dev-orquestra/blob/26c8e80dd6bacd9abc938af8a7da51b3d1abede2/integrations/omniroute_mcp/client.py) reads `OMNIROUTE_API_KEY` and `OMNIROUTE_BASE_URL` and calls an OpenAI-compatible OmniRoute endpoint. The example config describes the endpoint as private Tailnet. [`server.py`](https://github.com/menezes-platform/ops-dev-orquestra/blob/26c8e80dd6bacd9abc938af8a7da51b3d1abede2/integrations/omniroute_mcp/server.py) exposes only health/models/chat and binds to loopback by default; public bind requires an explicit opt-in. The [`omniroute-mcp.yml` workflow](https://github.com/menezes-platform/ops-dev-orquestra/blob/26c8e80dd6bacd9abc938af8a7da51b3d1abede2/.github/workflows/omniroute-mcp.yml) uses `ubuntu-latest`, a synthetic test key and a local fake upstream for its inspector smoke. | `CENTRAL_GATEWAY_CLIENT_CANDIDATE / GATEWAY_EQUIVALENCE_AND_LIVE_USE_UNRESOLVED`. The source shows a client of a centralized route, not provider-specific credentials or endpoints. Available evidence does not establish that this OmniRoute endpoint is the approved Provider Gateway or that the MCP is deployed/invoked. Do not count it as a confirmed bypass or as proof that bypasses are zero. |

## Gate impact and next evidence

P06 remains `NOT_PASSED`. Frozen Agent Platform `main` still contains the direct TypeSafe fleet-scoring route; draft PR #30 removes that source path but is neither merged nor deployed. The Gabriel Ops swarm adds a separate direct-provider source candidate with historical workflow execution. The Orquestra OmniRoute MCP is a centralized-route client candidate whose ownership and runtime state remain unknown. Together, these findings rule out a zero-bypass conclusion from the current evidence while avoiding an unsupported claim that every candidate is an active production caller.

Next safe proof is an owner-approved inventory of which of these model paths are platform-owned and deployed, plus a route/configuration map that identifies the approved Gateway endpoint without exposing credentials. If Gabriel Ops belongs in the platform-owned caller set, migrate its direct routes to the approved Gateway and verify provider-routing/fallback tests before P06 exit. Resolve OmniRoute's endpoint ownership and deployment status before counting it either way. No workflow was dispatched and no configuration, code outside the evidence branch, provider or production setting was changed here.

## Evidence limits

- The Gabriel Ops run-history result is historical workflow metadata, not a verified upstream request trace.
- The Orquestra workflow source verifies a synthetic local test path only; it does not establish a production service or recent run state.
- A read of Orquestra workflow-run history was not available through the permitted GitHub read endpoint in this session. No negative claim about live invocation is made.
- Credential values, provider API responses, deployed host configuration and live invocation telemetry were not accessed.
- This is source and metadata evidence only. It does not change the frozen Spec Kit or authorize merge, deployment, migration, deletion or archival.

## Draft Provider Gateway accounting fix — 2026-10-05T06:54Z

The existing draft PR #30 was advanced from `114e781baed6ac30f9c63d6e923363e73213bc13` to `4f5077292ffcec0ef26ea6b943d741983e630fdb`. Review found that `Number.isInteger` accepted unsafe JavaScript token counts from a provider response. The gateway now requires safe integers for both input and output usage; the versioned inference schema also caps `max_output_tokens` and both usage fields at `Number.MAX_SAFE_INTEGER`. Regression tests cover the unsafe usage receipt and schema bounds.

The exact draft head passed the complete Agent Platform Node suite, **317/317**, and the focused Provider Gateway policy/contract tests, **23/23**. `git diff --check` and frozen Spec Kit validation passed. No provider was called, and no CI result was checked in this refresh. The PR remains open and draft, unmerged and undeployed. P06 remains `NOT_PASSED`: production Gateway composition, broker-backed adapter, Gabriel Ops direct-provider ownership/use, the global caller census and zero-bypass proof remain open.

## Cross-repository TypeSafe documentation candidate — 2026-10-05T07:23Z

A read-only search of private Memory `main` at `2f43e8d1b20f6325c44e7a3174e80e00e3a809b7` found [`memory/PROJECTS.md`](https://github.com/menezesx2k26-byte/Memory/blob/2f43e8d1b20f6325c44e7a3174e80e00e3a809b7/memory/PROJECTS.md) describing a TypeSafe API integration for agent orchestration and a locally configured API-key variable by name. No secret value was read. This is account-memory documentation, not runtime source, an endpoint trace, deployment metadata, or proof of current use. Classify it as `DOCUMENTED_PROVIDER_CANDIDATE / RUNTIME_AND_OWNERSHIP_UNRESOLVED`; include it in P06 caller disposition, but do not count it as a confirmed live bypass or evidence of zero bypass. The previously scoped Agent Platform source scan remains scoped to that repository and does not cover Memory documentation.

## Gabriel Ops TypeSafe and provider smoke paths — 2026-10-05T07:37Z

A focused default-branch source search and file read at Gabriel Ops `main` `8dfcca2d544655b7317671fbc0d007c8d961c674` found two additional P06 caller paths:

| Path | Source evidence | Classification |
| --- | --- | --- |
| [`scripts/typesafe-guardrail.mjs`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/scripts/typesafe-guardrail.mjs) | Implements a direct `fetch` to the TypeSafe System One endpoint, with the key read from process environment and a fixed guardrail policy/model. | `DIRECT_PROVIDER_CALLER_IN_SOURCE / OWNERSHIP_AND_CURRENT_USE_UNRESOLVED`. This is more than a documentation mention; no deployment or invocation was established. |
| [`.github/workflows/api-secret-smoke.yml`](https://github.com/menezesx2k26-byte/ops-gabriel-ops/blob/8dfcca2d544655b7317671fbc0d007c8d961c674/.github/workflows/api-secret-smoke.yml) | The workflow is `workflow_dispatch`-only. Its source probes four provider model-list/auth endpoints and sends a fixed harmless credential-smoke POST to TypeSafe System One. Credential references are by secret name; no values were read. | `MANUAL_DIRECT_API_SMOKE_IN_SOURCE / EXECUTION_HISTORY_UNCHECKED`. This is a source-configured request path, not evidence that it ran or that the TypeSafe request is an ordinary production model call. |

Focused default-branch searches for the provider-specific endpoint strings found them only in Gabriel Ops' dashboard agent and this credential-smoke workflow among the seven repositories queried. The `TYPESAFE_ENDPOINT` search found the Agent Platform main direct route/legacy plan and the Gabriel Ops guardrail script; Memory's TypeSafe result is documentation-only, and Resident Node returned no matching TypeSafe result. These indexed searches are bounded caller evidence, not a complete semantic call graph or proof of runtime zero. No workflow was dispatched, no provider was contacted, and run history for the credential-smoke workflow was not checked. P06 remains `NOT_PASSED`.

## Scoped Agent Platform caller scan and doc disposition — 2026-10-05T07:09Z

A narrow search on the PR #30 source tree for known provider endpoints and secret-variable names found no matches in runtime source outside tests/specification files. Remaining matches included test sentinels and the TypeSafe-era implementation plan. Commit `18e60fe843295a74297144a7dce005428b3bed83` adds `specs/001-drive-backed-fleet-storage-routing/consolidation-status.md` and small notices in the feature spec/plan that mark those direct-key instructions as historical while preserving the detailed records. This resolves the ambiguous branch-local wording; it does not establish production migration or update `main`. PR #30 remains draft and P11 adoption/overall cleanup remain gated. The scoped scan does not replace the cross-repository P06 caller census.

## Provider Gateway sparse-array validation hardening — 2026-10-05T08:07Z

A local mock-adapter probe reproduced a validation bypass: an input array with length one and no own index zero passed normalization and reached the adapter unchanged. Draft PR #30 head `b085ceabe3d549444f4d8d05ee4dd098464626ba` now rejects sparse arrays at each Gateway array boundary: request input and fallback routes fail before dispatch; provider output is rejected and is neither retried nor cached. The exact source tree passed the focused Gateway suite **18/18** and complete Agent Platform Node suite **320/320**. The first full-suite run without dependencies failed because the checkout had no `node_modules`; rerunning with a temporary junction to the existing dependency tree whose `package-lock.json` hash matched exactly passed. The junction was removed and the dependency tree remains intact. `git diff --check` and frozen Spec Kit validation passed; the Spec Kit is unchanged. No provider was called and no CI result was checked for this head. PR #30 remains draft and unmerged; P06 still lacks production Gateway composition, broker-backed secret access, the cross-repository zero-bypass proof, and exit evidence.

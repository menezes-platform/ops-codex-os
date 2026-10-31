# P09 — source-scoped compatibility shim candidate inventory

- `phase_id`: `P09`
- `checkpoint_id`: `P09-SHIM-CANDIDATES-2026-10-05T10:26Z`
- `status`: `PARTIAL_INVENTORY / NO_DELETIONS`
- `P09_exit`: `NOT_PASSED`
- `DoD`: `NOT_MET`
- `scope`: read-only source review of frozen-scope default branches; no callers, deployments, logs, tags, or branches were modified.

## Assessment

This is a bounded candidate scan, not the complete shim registry required for P09. It records explicit compatibility behavior found in source and distinguishes a required Windows command wrapper from a deprecated shim. A string search cannot prove that unlabelled adapters, dynamic routes, installed callers, or production requests are absent.

No candidate is currently eligible for deletion. P08 has not exited, caller inventories remain incomplete, and no production traffic evidence proves that either compatibility route has zero callers. No file, route, branch, deployment, tag, or repository was removed.

## Explicit compatibility candidates

### `SITE-CF-COMPOSIO-OAUTH-REDIRECT`

- **Source and owner:** `menezes-platform/ops-site-ops` main at `65e17e37915b283a3b3c8cb8de907f60b38331a5`, Cloudflare Worker `mcp-edge/aws-mcp-edge-worker.js` and convergence test `scripts/validate-edge-deploy-convergence.mjs`; owner classification is inferred from repository ownership.
- **Purpose and allowed callers:** the edge translates Composio OAuth DCR/authorize/token requests using `https://backend.composio.dev/api/v3/toolkits/auth/callback` to the upstream ChatGPT-compatible redirect, then rewrites the response callback. The expected caller is Composio's OAuth client flow.
- **Evidence:** the source function `maybeShimComposioRequest` changes the redirect field and response only for matching requests; the deployment convergence test requires successful Composio registration and authorization responses. The existing Composio connection was previously observed active, but current Worker telemetry does not show whether this branch was used.
- **Introduction phase:** unknown; the exact introducing commit/phase is not recorded in the inspected source.
- **Objective removal condition:** every connected Composio client uses the canonical callback without translation; production telemetry proves this compatibility branch has no callers; end-to-end OAuth registration/authorization succeeds on the replacement path; and rollback refs are preserved.
- **Latest removal phase:** P09, if the removal condition is proved.
- **Disposition:** retain. Caller-zero and branch-use evidence are absent, so it is not eligible for deletion.

### `GABRIEL-GCP-HEALTHZ-ALIAS`

- **Source and owner:** `menezesx2k26-byte/ops-gabriel-ops` main at `8dfcca2d544655b7317671fbc0d007c8d961c674`, `mcp/gcp-readonly/src/index.mjs`, `mcp/gcp-readonly/README.md`, and the 2026-09-22 Cloud Run health-path incident; owner classification is inferred from repository ownership.
- **Purpose and allowed callers:** local `GET /healthz` aliases `GET /health` for sidecar compatibility. The incident says Cloud Run's external frontend returned 404 for `/healthz`; the production proxy now targets `/health`. Sidecar callers are documented, not inventoried.
- **Introduction phase:** before the frozen consolidation phases; the incident dated 2026-09-22 is the earliest inspected evidence. The introducing commit is unknown.
- **Objective removal condition:** all sidecar clients use `/health`; an exhaustive caller/config scan and production request evidence show no `/healthz` dependency; health smoke tests validate the replacement route.
- **Latest removal phase:** P09, if the removal condition is proved.
- **Disposition:** retain pending caller and telemetry evidence. The source and smoke test explicitly keep `/healthz`; no zero-use proof exists.

## Observed wrapper not classified as a deprecated shim

### `AGENT-PLATFORM-EGO-WINDOWS-CMD`

Agent Platform main at `f4e31b4897f9fc4bf6c9bc8cf743c8cf712693b8` installs `ego-browser.cmd` from `scripts/install.ps1`; `persistd/src/browser/ego-browser.js` parses that wrapper and launches its Node entrypoint without a shell. Its known caller is the PersistD Windows browser host. This is an active platform invocation adapter in the inspected source, not evidence of a deprecated compatibility path. Its introduction phase and a removal condition are not specified, so this inventory does not count it as eligible for P09 deletion. It requires an owner decision if the execution-plane migration changes its responsibility.

## Search scope and limits

The read-only exact-token `shim` code search covered all seven frozen-scope repositories at these main refs: Agent Platform `f4e31b4`, Gabriel Ops `8dfcca2`, Site Ops `65e17e`, Orquestra `26c8e80`, Sandbox `bc3249f`, Resident Node `14b4cb2`, and private Memory `2f43e8d`. It returned source candidates in Agent Platform and Site Ops; no exact `shim` source match in Orquestra, Sandbox, Resident Node, or Memory. A separate `compatibility` search found the GCP health alias in Gabriel Ops and an Orquestra routing-policy reference to request/model compatibility; it did not establish another shim. Local source searches corroborated the Agent Platform and Gabriel Ops hits.

Searches were lexical and repository-source scoped. They do not enumerate all synonyms, generated/runtime code, private installed state, production callers, request telemetry, or non-Git configuration. Consequently, `eligible deprecated shims remaining` stays `UNRESOLVED`, and the P09 gate remains closed.

## Gate result

P09 requires P08 caller migration first. Until P08 exit, complete cross-repository callers/config/deployment inventories, the frozen shim contract, zero-use proof, and rollback evidence exist, this inventory is preparation only. The frozen Spec Kit is unchanged; P09 and the overall DoD remain `NOT_MET`.

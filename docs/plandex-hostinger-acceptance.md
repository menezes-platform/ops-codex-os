# Plandex native MCP — production acceptance / Hostinger deployment gates

**Status (04/11/2026): source implementation tested, production NOT DEPLOYED.**

- [PR #61 — backend draft](https://github.com/menezesx2k26-byte/ops-codex-os/pull/61)
- [CI success — native MCP, Linux/Windows and Hostinger candidate](https://github.com/menezesx2k26-byte/ops-codex-os/actions/runs/41820390610)
- [Private plugin v0.2.0 currently installed](https://chatgpt.com/plugins/plugins_6aeaae36ff64819198c02c7a540e56e6)
- [Planned native tools issue #8](https://github.com/menezesx2k26-byte/ops-infra-workbench/issues/8)
- [Plandex runtime recovery issue #7](https://github.com/menezesx2k26-byte/ops-infra-workbench/issues/7)

## Actual existing Node.js host (read-only API inspection)

- Existing domain: `darkslategrey-raccoon-448222.hostingersite.com`.
- Hostinger connected website: `website_type=nodejs`, enabled, user `u775492464`; **do not create another website, VPS or Worker**.
- `GET /api/hosting/v1/accounts/u775492464/websites/{domain}/nodejs/builds/settings`: Node.js 24, `app_type=other`, `entry_file=src/hostinger-entry.js`, npm. Source `persistd/src/hostinger-entry.js` exists in Git and matches the entrypoint.
- Last completed Hostinger builds have `source_type=archive`, not Git auto-deploy. This means pushing/merging GitHub code **does not prove runtime publication**. `POST nodejs/builds` overwrites website contents; it has intentionally NOT been used here.
- Existing Hostinger environment lists `PERSISTFLOW_DATA_DIR`, `PERSISTFLOW_MCP_TOKEN_SHA256`, fleet flags and node secret names; values remain masked and undisclosed. **No `PLANDEX_GITHUB_TOKEN` name** was returned. Github repo secret names only `HOSTINGER_API_TOKEN` and `OMNIROUTE_API_TOKEN`.
- Existing public MCP Cloudflare Worker proxies the Hostinger service. Do not modify its stable hostname or existing OAuth/DCR/PKCE flows.

## Tested implementation

- `plandex_status`, `plandex_start`, `plandex_stop` are registered in the backend MCP handler, retain existing bearer/OAuth authorization and do not expose shell access.
- Controller fixes one repo and one Codespace, requires server-side GitHub credential and verifies GitHub repository identity; sanitizes output, avoids arbitrary URLs and disallows destructive deletion.
- Starting requires an independent **fresh server-verified** `Usage blocked` proof for Codespaces USD 0. The current host has no configured `budgetVerifier`: start fails closed and this is intentional. `netAmount=0` from GitHub billing is NOT sufficient.
- The controller's in-process mutex prevents duplicate concurrent start/stop POSTs; regression confirmed RED (2 duplicate POSTs) then GREEN.
- Final 3-job CI **SUCCESS**, 04/11/2026: `https://github.com/menezesx2k26-byte/ops-codex-os/actions/runs/41820390610`; Linux native MCP, root and PersistFlow suites, Windows fleet installer suite, and artifact build.
- CI artifact `plandex-hostinger-candidate` id `13317420053`, SHA256 `5b733fd137e1b6db4c4c5612422bd6a7425fdaff245f4846c4ff14ed82e40f27`, one-day retention; deterministic rebuild through feature workflow. ZIP has `src/hostinger-entry.js`, Node package/lock, private project source, `config/fleet.json` and SVG; excludes `config/mcp-token.sha256`, node_modules and all private auth values. No deployment performed.

## Before actual production deployment — mandatory gates

1. Review permissions. Current OAuth's `persistflow` scope is **not** a GitHub token and must not be treated as one. Establish an authorized **minimal-scope GitHub user credential** with `Codespaces lifecycle admin` on the allowlisted repository, secret only on Hostinger, never in Git, plugin ZIP, browsers or tool responses.
2. Obtain **trusted, current, server-side proof** that the account has Codespaces `Usage blocked` with maximum USD 0 additional spending. If no supported trusted API exists for this personal account, keep `plandex_start` disabled and use existing GitHub/Composio with live approval instead. Never replace this proof with current net billing amount zero or user-supplied JSON.
3. Review the **exact current Hostinger archive and rollback source** plus persisted authority/Google OAuth state in the existing external `PERSISTFLOW_DATA_DIR`, and verify archived credential/infrastructure restoration paths. The new ZIP is only a candidate, NOT a reversible production operation by itself.
4. If and only if the owner-authorized deployment path is safely confirmed: deploy the verified archive to the existing Node site without overwriting persistent OAuth/authority; read Hostinger build logs, verify `GET /healthz` and old PersistFlow tools, then make a truly authenticated `tools/list`/read-only `plandex_status` call from the *public* MCP endpoint. Keep feature disabled if GH auth or budget verification is missing.
5. Update the **same** private plugin release after native live `tools/list` is confirmed. Do NOT declare `plandex_plan`, model inference, `plandex_backup` automated, `plandex_approve`, or deletion ready without their separate live acceptance.

## User data safety

The real age-encrypted Drive backup `https://drive.google.com/file/d/1quFXzCO5EvKTz2pG03jl5qlZjo192n7U/view` was hash-verified and decrypted on the user's Windows PC. This proves file recovery but **not** a PostgreSQL service restart from that specific archive in a fresh Linux runtime. Codespace `ideal-guacamole-p77r9rqq4r7xh7xrr` must remain retained and stopped until `delete-ready` gates pass.

**No claims of production deployment, live native MCP tools, automatic backup, or Plandex model auth until verified.**

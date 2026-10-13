# Integrated Fleet Executor verification

Tested source: ffda8add9f9e98f0ef6ee9ae176088782672d9fd, including the 30 GiB reserve integration. Checked 2026-10-11 UTC in a clean Linux checkout, Node v24.19.0, npm 11.9.0, dependencies from npm ci --ignore-scripts.

- Root npm test: 23 passed, zero failed/skipped.
- PersistFlow suite: 277 discovered, 276 passed, zero failed, one Windows-only skip.
- Executor security: 8 passed, zero failed/skipped.
- Spec Kit and git diff --check: passed.

## Integrated Windows gate — verified 2026-10-11 UTC

Isolated Windows checkout at `b06031f1556d6e181959711be5c864625c446438`; `git diff --name-only ffda8add9f9e98f0ef6ee9ae176088782672d9fd..HEAD` contained only this verification document. Executable source is exactly the Linux-tested source above. Node v24.19.0. Real copies of already installed dependencies were reused, without junctions, installing dependencies or changing the installed agent.

- `npm test`: 23 passed, zero failures/skips.
- `npm --prefix persistd test`: 277 passed, zero failures/skips.
- Actual Windows taskkill tree/descendant test passed (1713.44 ms); this closes the Windows-only gap left by Linux.
- `node scripts/verify-fleet-executor-security.cjs`: 8 passed, zero failures/skips.
- `npm run validate:spec-kit`, syntax of 20 changed JS/CJS files and `git diff --check origin/main...HEAD`: passed.
- Test logs, sanitized provider evidence and immutable candidate manifest are delivered as `outputs/dod-20261011/` in the Codex workspace. The Linux and Windows executable-source proofs can be reused for subsequent documentation-only commits.

## Current release checkpoint

Phase: `fleet-executor-release-gates`. Completed gates: exact-source Linux/Windows tests, timeout/recovery/security regressions, Spec Kit, syntax, whitespace, anonymous live HTTP and read-only provider metadata. No architecture change or new authority/shim was introduced.

Recovered existing canonical run through authenticated `persist_run_inspect`: `gabriel-fleet-executor-dod-20261011`, generation 1, created `2026-10-11T00:15:28.699Z`. Its existing goal/checkpoint match PR #33 and the reserve integration. No new run or takeover was created. ACTIVE is the stored run status, not proof of an active supervisor or durable survival across Hostinger replacement. Update and read back this same generation checkpoint after publishing the Git evidence.

Latest user mission authorizes publication with flag OFF and controlled desktop-primary activation **after** all required gates pass. No repeated operational approval is needed. Required account consent/MFA, spending, destructive actions and failed gates remain hard boundaries. Main remains `3183b9d7ab5d238b1070d8d610d634edbb667959`; PR #33 stays draft while blocked.

### Fresh production evidence

- Hostinger authenticated read-only REST used documented `/api/hosting/v1/accounts/u775492464/websites/<domain>/...`; all 15 build records fit one page. Latest completed build remains `01a1094e-4561-7179-a9e5-e00378da3390`, archive `persistflow-rfc9207-20260929.zip`, updated `2026-10-04T23:44:57Z`, no commit/digest. Node 24, entry `src/hostinger-entry.js`, package manager npm, no separately configured root/build script.
- Environment values remain masked. `PERSISTFLOW_DATA_DIR` is present; its effective path is still unknown. Executor-enabled key remains absent. No values were written back or inferred from masks.
- Auto-deploy remains enabled for `menezesx2k26/persistflow-gabriel-mcp-hostinger`, main. This PR's repository is not the deployment source. Do not change that connection or push to the other repo to bypass a gate.
- Anonymous HTTPS probe `2026-10-11T00:48:55.901Z`: health 200, heartbeat 401, poll/report/owner execute 404. No signed poll/enqueue was sent. The exact cause/version behind 404 remains unproven.
- Authenticated Fleet status: desktop-primary fresh, activeJobs=0, observedAt `2026-10-11T00:49:50.127Z`, freeDiskBytes=52659982336, totalDiskBytes=239349547008. This was above the integrated 30 GiB/10% threshold at observation; live eligibility/scratch must be rechecked before execution. Exactly one local installed node-agent process was observed, PID 4888; its code/startup/DPAPI/config were untouched. This does not prove one Hostinger writer.

### Blockers and exact next actions

1. **Analysis/CI BLOCKED:** CodeQL run `38098387439` and Linux/Windows workflow run `38098389493` did not start; all check annotations say account locked due to billing. Local tests do not replace CodeQL or turn CI green. The account owner must resolve the lock without unauthorized payment, then the exact reviewed commit must complete the required analyses/checks. No local CodeQL executable is available. No gate was removed or weakened.
2. **Hosted storage/rollback BLOCKED:** local SSH aliases contain no Hostinger target/key mapping. The existing Azure `persistflow` SSH alias timed out during a scoped continuation lookup; it is a different host and was not treated as Hostinger. The provider API exposes masked env and build labels, not effective private storage/processes or recoverable old bytes. Required next access is the already authorized administrative Hostinger session or existing SSH route, with any direct account consent/MFA completed by its owner; do not add keys or invent credentials. Through it, read only PERSISTFLOW_DATA_DIR's effective value, resolve it outside all replaced trees, enumerate actual Authority writer processes, obtain a consistent private backup and rehearse restoration outside live state, recover/hash the old deployed bytes and verify rollback preserves current additive records. Coordinate the separate auto-deploy trigger before publication. Browser cloud login was not retried; existing-profile consent was not bypassed.
3. **Rollback artifact BLOCKED:** the source label is not an immutable retrievable rollback artifact. Historic Git build SHAs are not substitutes for the currently deployed ZIP bytes. No old queue, receipt, guard, checkpoint or backup was deleted or overwritten.
4. **Deploy/activation pending:** only after the gates above pass, publish the exact tested/reviewed source with executor flag 0 through the existing verified archive flow. Verify source/build identity, durable readback, OAuth/MCP, HTTP routes and independent heartbeats. Only after absence of dispatch is independently proved, run signed-disabled probe. Then activate only desktop-primary/node-version, concurrency 1, and prove real smoke/retry/allowlist/report-loss/restart/generation receipts and checkpoints. None of these production mutations occurred.
5. **Engram ingestion BLOCKED:** no callable Engram tool or local Engram CLI/configured server was found in this session. Composio discovery returned unrelated Parallel tools, which were not invoked or substituted. Expose the existing Engram connection with its proper episodic ingestion/readback surface before claiming this gate complete. Personal account-memory decision: no new stable cross-project personal fact; project state remains in Git/PersistFlow and the scoped Drive handoff.

### Prepared immutable candidate — not uploaded

Source `ffda8add9f9e98f0ef6ee9ae176088782672d9fd`, subtree `persistd`, archive root contains `package.json` and `src/hostinger-entry.js`. `git archive --format=zip --mtime=<source commit time> <source>:persistd` produced 132 entries with SHA-256 `0631d894098ea7cdc7892a85f47729eeb6b924bcbd5be8564a04e4faf73e60d0`. Archive paths were checked to exclude dependency trees, Git metadata, live .env, execution guards and private-key extensions. Existing dependency lockfiles are included. This is a new candidate artifact, **not** evidence of the old rollback artifact or an uploaded build. Preserve the provider's existing configuration and inject flag 0 through a gate-verified mechanism; never replace all env with masked values.

**Verdict: BLOCKED — not DoD.** Platform testing is complete for this executable source; CodeQL/remote CI, private storage/backup/rollback, publication and real desktop smoke/recovery are incomplete. No merge, deployment/redeploy, production restart, worker activation/config change, port opening, new credential or paid AI was performed.

This is project verification evidence, not personal memory or controller takeover proof.

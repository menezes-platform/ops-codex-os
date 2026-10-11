# Gabriel Fleet Executor: Authority publication review

Updated 2026-10-10 after review 5480903361 on [PR #33](https://github.com/menezes-platform/ops-codex-os/pull/33). This is a review package, not deployment authorization. No production deployment, merge, desktop configuration change, worker restart, port opening or additional paid AI tool was performed.

## Exact source and verification

- Repository: `menezes-platform/ops-codex-os`.
- Functional implementation: `f725ffbe5218e3c724b339aab22d56d62e983e6c`.
- Parent / audited remote main: `3183b9d7ab5d238b1070d8d610d634edbb667959`.
- Initial local branch: `feat/fleet-authenticated-executor`; initial working tree clean.
- Functional diff: 11 files, 795 insertions, 4 deletions. Compare exactly with `git diff 3183b9d7ab5d238b1070d8d610d634edbb667959..f725ffbe5218e3c724b339aab22d56d62e983e6c`.
- Review branch: `review/gabriel-fleet-executor-20261010`; original reviewed HEAD `ef4f6f0dd1d00210608202e5d77bc130efc1bbeb`. Corrections are small follow-up commits for startup isolation, durable writes/shared guard, supervised termination and same-ID receipt-loss recovery. The original functional diff above remains the historical baseline; it is not the current full diff.
- Verified functional hardening SHA: `3305a5458faf1c4971f115fe9ca7f091bc1eef50`; the final publication-document commit follows this source without changing executable code.
- Final local verification: PersistFlow 270/270 (250 original plus 20 regressions), root 23/23, standalone security checks 8/8, focused regressions 20/20; no skips or failures on Windows. The complete final run follows the last receipt-loss corrective change. A previous full run passed 269/269 before that extra scenario reproduced terminal rejection of uncertain work; the regression and correction were not hidden or skipped. Syntax, Spec Kit and `git diff --check` passed before pushing the final docs commit.
- Existing remote CodeQL checks on main are failed because GitHub did not start the jobs: account locked due to a billing issue. This was confirmed from check annotations, not inferred from test failures. See [existing run](https://github.com/menezes-platform/ops-codex-os/actions/runs/37452662356). No billing setting/payment was changed; successful CodeQL analysis is not claimed.
- Full suites run in a clean source copy matched byte-for-byte to the candidate, with real copies of existing installed dependencies. This avoids the packaging-test failure when copying Windows dependency junctions. No dependency installation, test weakening, cloud inference or secret fixture from production is needed.

Reproduce:

```text
npm test
npm --prefix persistd test
node scripts/verify-fleet-executor-security.cjs
git diff --check origin/main...HEAD
```

## Security review

Code meets the bounded one-worker, one-Authority-process contract in local tests, with the operational limitations below. Requested release verdict: **BLOCKED**, because the live build identity, selected deployment source, durable directory/rollback proof and CodeQL gate have not been established. PR remains draft. A tested process-recovery contract is not proof of exactly-once execution under power loss.

| Review 5480903361 item | Engineering disposition | Reproducible evidence |
| --- | --- | --- |
| P1 startup failure interrupts heartbeat | Corrected: one caught initialization attempt, fixed sanitized code, disabled executor and continuous heartbeat. | `fleet-agent-isolation.test.js`: 5 scenarios, 3 heartbeats each; real malformed JSON/missing file/executable/corrupt receipt plus injected EACCES; no partially initialized polling or automatic retries. |
| P1 durable writes/idempotence | Corrected locally: file fsync before replacement, directory fsync where supported, shared exclusive guard, no automatic stale takeover, conservative receipt-loss state. Power-loss/Hostinger storage guarantees remain blocked. | `fleet-durability.test.js`: 9 cases including file/rename/directory faults, restart after terminal-write failure, no spawn after prelaunch failure, unsupported Windows directory sync, real competing worker processes and same-ID missing receipt reported as uncertainty twice without a launch. Existing integration tests cover lost reports and both restarts. |
| P2 timeout/termination | Corrected: taskkill result/start failure/helper deadline observed; five-second secondary supervision; unconfirmed process/pipe state persists RUNNING, no finishedAt, capacity retained and deduplicated local termination-code log. | `fleet-executor-timeout.test.js`: 6 cases, including actual Windows tree/descendant termination and injected nonzero/error/helper hang/no exit/open pipes. |
| P2 evidence export | Proposal delivered; intentionally no export implementation, capability or endpoint activation. | [Scoped export proposal](fleet-artifact-export-proposal.md): allowed paths/types/budgets, SHA-256/provenance, specific consent, node-bound authenticated receive, CAS/readback and secret review. |
| Hostinger/rollback and CodeQL release gates | Still BLOCKED. | Read-only API/probes and browser refusal detailed below; no deploy/merge/activation/payment performed. |

| Area | Evidence and result | Limit / required gate |
| --- | --- | --- |
| Owner authentication | HTTP enqueue checks existing owner bearer/digest before reading execution input; MCP uses existing authenticated ingress. Node secret and missing/wrong bearer rejected in local HTTP tests. | Node HMAC is not owner authority. Preserve existing OAuth/owner injection; never distribute the owner token to workers. |
| Node authentication | HMAC-SHA256 with timing-safe comparison binds node, timestamp, method, path and exact body. Config membership and URL/header identity must match. Signed responses bind body/path/status. Negative tests reject wrong identity, method, bytes, stale clock and changed status. | Per-node symmetric secret holders can impersonate their own node and report its results; a receipt is not independent proof against a compromised desktop. Existing TLS trust must remain enabled. |
| Replay | Both directions reject clock skew beyond 60 seconds. Stable request IDs, immutable operation fingerprints and exclusive durable worker receipts prevent relaunch; report repeats do not append duplicate checkpoints. Same signed poll deliberately remains valid within the window. | No single-use nonce ledger. This provides bounded freshness plus semantic idempotence, not rejection of every repeated HTTP message. Do not advertise strict nonce-based replay rejection. |
| Allowlist | Only commandId/requestId reach the worker. Fixed absolute executable/cwd, fixed args, `shell:false`; .cmd/.bat rejected. Unknown command and injected args/env/cwd/text tests reject input. | Trusted administrator controls configuration and scripts. Protect them and receipts with Windows ACLs. A fixed interpreter script can access the user's filesystem/network; there is no OS sandbox. |
| Authorization by node | Router requires `fleet-executor` and `command:<id>` capabilities. Job stores chosen node immutably. Different node poll cannot obtain it; different node report gets 409. New assignments recheck eligibility/current generation. | Only desktop-primary may gain capabilities in the first rollout. Already claimed work is redelivered for reconciliation even after drain/generation changes; those controls do not revoke an already launched process. |
| Idempotency/recovery | Authority and receipt files fsynced before replace; directories synced where supported. Exclusive shared guard and receipt precede spawn; terminal metadata replaced atomically. Lost-report/restart test observes one launch. RUNNING or same-ID guard without receipt reports uncertainty and blocks new execution. | Keep receipts/guard through rollback. No exactly-once power-loss claim: Windows directory fsync is unsupported through Node and provider/hardware durability is unverified. After a post-rename sync error, reconcile the current target rather than pretending nothing was written. AuthorityStore has no cross-process writer lock: one writer remains mandatory. No automatic guard deletion/takeover. |
| Limits | Shared guard fences different IDs across instances sharing the receipt directory. Reserve max(30 GiB,10%) for startup/eligibility (80 GiB/15% target during cache eviction), reviewed scratch, timeout 50..300000 ms, plus 5000 ms supervision; taskkill helper wait 1000 ms; combined output <=32768 bytes; HTTP response <=16384 bytes, timeout 15s; worker body <=4096 bytes. Actual Windows tree/descendant kill is tested. | A supervision deadline ends observation, not an unkillable process: RUNNING/guard/capacity remain. No CPU/RAM sandbox quota. Configure one worker process; distinct receipt directories are not mutually fenced. Detached/escaped processes are outside the contract. Poll scans run files synchronously: large queues need separate scale assessment. |
| Secrets/logs | Child env excludes PATH, HMAC and cloud credentials; only Windows system/temp values inherited. Known HMAC redacted from captured output. No stdout/stderr retained in receipts/Authority, and loop logs metadata/error codes. Additional tests reject report output and confirm synthetic credentials absent from store. | Unknown secrets in trusted script output cannot be generically detected. Never put secrets in IDs, args, summaries or scripts committed to Git. Preserve private DPAPI/env injection; no new credentials are provisioned. |

Refutation pass: missing nonce is not hidden by calling HMAC alone replay-safe; replay tests establish the actual idempotent semantics. A 404 is not explained by the executor flag, because local unsigned requests get 401 even with the flag off and valid signed requests get signed 503. The root entrypoint concern survives inspection: root `npm start` starts `server.js`, which constructs only the run store and does not wire production Fleet configuration/router/secrets. The tested Fleet entrypoint is `persistd/src/hostinger-entry.js` -> `startWeb()`.

PR-Agent/OpenReviewer external model execution was deliberately omitted under the user's no-additional-paid-AI constraint. The local review followed their second-pass refute-or-drop pattern. No repository linter is configured for this changed JavaScript; deterministic syntax, local security tests and exact diff review were used. No independent human approval is claimed.

## Endpoints and contracts

All routes belong to the existing Authority origin. The desktop exposes no network listener. Worker requests/responses must use authenticated HTTPS, except literal loopback used in tests. Redirects are rejected.

| Surface | Authentication | Input / result |
| --- | --- | --- |
| `POST /v1/runs/<runId>/fleet/execute` | Existing owner bearer or its configured digest | Existing run, current positive generation, operationId/commandId matching `[a-zA-Z0-9_-]{1,128}`, route intent. Returns `{operation,replayed}`; initial status QUEUED. |
| MCP `persist_fleet_execute` at existing `/mcp` | Existing authenticated MCP ingress | Same enqueue fields plus runId. Strict schema rejects extra fields. |
| `POST /v1/fleet/nodes/<nodeId>/executions/poll` | Registered node HMAC | Exactly `{}`. Returns `{job:null}` or `{job:{runId,operationId,generation,requestId,commandId}}`. Redelivery uses the same requestId. |
| `POST /v1/fleet/nodes/<nodeId>/executions/report` | Registered node HMAC matching stored operation.nodeId | Job fields plus status, exitCode (integer/null), optional boolean outputTruncated. Returns `{acknowledged:true,requestId,replayed}`. No output, args, paths or environment accepted. |

Owner enqueue example (no credentials):

```json
{"generation":1,"operationId":"desktop-node-version-001","commandId":"node-version","intent":{"taskId":"desktop-smoke","summary":"Verify desktop Node termination","pinnedNodeId":"desktop-primary"}}
```

Worker headers: `x-persistflow-node-id`, `x-persistflow-node-timestamp` (ISO timestamp), `x-persistflow-node-signature` (64 hex). HMAC input is the newline-separated nodeId, timestamp, uppercase method, path, raw JSON body. Responses include timestamp/signature, bind method `RESPONSE-<status>` and the request path, and use `cache-control:no-store`. Unsigned unauthorized/error responses must not be trusted by the worker.

Report statuses: COMPLETED requires exitCode=0; FAILED, TIMED_OUT, REJECTED are terminal; RUNNING maps to UNCERTAIN. Operation states also include QUEUED/RUNNING. Terminal result contradictions get 409. Duplicate matching reports are acknowledged without a new checkpoint. A final report for an already claimed old-generation job records that original generation.

HTTP errors: 401 invalid/missing authorization; 400 invalid JSON/request/oversized body; 409 stale generation or operation/node/request conflict; 404 missing run; 503 disabled executor, absent router or no eligible node; 500 scrubbed internal error. Basic body parsing/size validation can precede worker authentication. Normal unsigned `{}` probes of the new routes return 401 regardless of the feature flag. There is no command-cancel endpoint or automatic lease expiry/reassignment.

## Live Hostinger evidence and 404 diagnosis

Read-only Hostinger API confirmed one enabled website of type `nodejs`, domain `darkslategrey-raccoon-448222.hostingersite.com`, account `u775492464`, root `/home/u775492464/domains/darkslategrey-raccoon-448222.hostingersite.com/public_html`. This proves the hosted target, not its build identity.

Read-only live probes at 2026-10-10T21:22:22Z: `/healthz` 200 with file/durable health, existing `/v1/fleet/nodes/desktop-primary/heartbeat` 401, both new worker routes and new owner execute route 404. Reproduce anonymous probes:

```text
node scripts/check-fleet-executor-http.cjs https://darkslategrey-raccoon-448222.hostingersite.com legacy
```

The observed origin lacks the new route behavior. An older application build is consistent with these results and `f725ffb` was absent from GitHub at inspection. However, proxy routing or deployment from a different source could produce the same results. **The exact live SHA and cause of 404 remain unverified.** The health response exposes no build SHA; local desktop runtime SHA and remote main SHA are not substitutes. GitHub deployments and repository hooks returned empty lists. The sole tracked workflow is memory-cognition, scoped to memory skill changes/main; no Hostinger deploy workflow was found.

The connected Hostinger API was rechecked and still exposes website inventory, not Node build history, selected repository/branch, start settings or environment values. Read-only inspection of the existing Chrome profile through Cua was refused with `browser_consent_required` / `consumer_profile_endpoint_requires_grant`. No browser preparation, restart, consent bypass or credentials extraction was attempted. No Hostinger SSH target was established. Do not fabricate these values, change repository connection or redeploy to discover them.

Hostinger's supported publication flow is hPanel website Dashboard -> Deployments -> Redeploy, reviewing Node version, build/start commands and environment. GitHub redeploy uses the selected branch's latest source; ZIP redeploy can reuse/upload source. This describes platform behavior, not a verified choice for this particular app. See [official redeploy documentation](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/). The review branch is newly created and was absent remotely; it must not be connected to hPanel. No main ref or existing deployment configuration is changed by this PR.

## Deployment procedure (future explicit authorization required)

1. Finish human PR review. Record final approved full SHA; never deploy a moving branch implicitly. Inspect hPanel's current successful build: deployment ID, full SHA, repo, selected branch/source, app root, Node version, start command and timestamp. If metadata has no SHA, read/hash the deployed source against Git or obtain the provider build manifest. Save evidence without tokens. Do not proceed without a reproducible rollback artifact.
2. Establish the actual `PERSISTFLOW_DATA_DIR` from private runtime settings; record only its path. Default candidate is `/home/u775492464/.persistflow-data`, but this is **not verified**. Require a resolved path outside public_html/nodejs/hbuilds/current/hbuilds/versions and preserve Authority runs, OAuth store, Fleet heartbeats/drain data and any existing bridge state. One Authority writer only. Check a private, consistent backup/snapshot and restore rehearsal outside live state. Do not place backups, `.env` or tokens inside the deploy ZIP/repository.
3. Preserve prior successful source/build and private environment mapping. Pause controller writes for a consistent backup; if active work exists, wait for completion, verify receipts and drain desktop. A drain alone does not prevent redelivery of already claimed jobs. Keep the old process/build available until rollback evidence is established.
4. Keep executor flag `PERSISTFLOW_FLEET_EXECUTOR_ENABLED=0` during code publication. Preserve existing Fleet registry, node secrets, OAuth/owner settings, Drive/storage injection and router configuration. No node gains executor capabilities yet. Verify actual start command: app root `persistd` + startup `src/hostinger-entry.js` (for loaders using require), or `npm start` within persistd with Hostinger-supplied PORT. Repository-root alternative is `node persistd/src/hostinger-entry.js`. Root `node server.js`/root `npm start` is insufficient for configured Fleet and must not be used for this feature. Do not silently switch an existing entrypoint: review any needed hPanel change as part of deployment approval.
5. After explicit deployment approval, use the provider's verified existing publishing flow for the approved source. Do not connect the review branch, change repository or create a new service to work around a source mismatch. Changing source/start settings can deploy immediately. Validate file/durable health, prior run readback, OAuth/MCP owner ingress and existing Fleet heartbeats before enabling work.
6. Run the post-publication checks below while dispatch remains disabled. Confirm the provider build/full SHA is the approved source. Resolve any 404 at this stage before touching desktop configuration.
7. Obtain separate controlled activation approval. Only then update the desktop runtime to the reviewed worker code, preserve its DPAPI wrapper/startup mechanism, protect the private allowlist/receipt directory, and prove one worker process. Start with `node-version` only. Keep concurrencyLimit=1, verify fresh disk reserve/scratch, clock skew, signed heartbeat and existing FleetRouter eligibility.
8. Enable only desktop-primary's reviewed capabilities `fleet-executor` and `command:node-version` and Authority executor flag. Pin every initial smoke intent to desktop-primary; do not enable other nodes or Railway. A single eligible candidate bypasses TypeSafe inference. Preserve all existing capabilities/registry entries. If readiness fails, keep disabled/drained and stop rollout.
9. On an explicitly approved disposable smoke run, enqueue one stable operationId, wait for COMPLETED/exitCode=0 and its original generation checkpoint. Retry identical input and compare requestId/checkpoint count, confirm one local execution receipt, reject an unlisted command, and rehearse lost-report/process restart in a controlled test with no sensitive output. No repeated new operationId to evade uncertainty. Observe heartbeats independently during a bounded task before increasing command coverage.

## Post-publication HTTP checks

Anonymous (no side effects):

```text
node scripts/check-fleet-executor-http.cjs https://darkslategrey-raccoon-448222.hostingersite.com published
```

Expected: durable file health 200, heartbeat 401 without HMAC, new poll/report and owner execute 401. These prove route presence, not successful authenticated execution or deployed SHA.

Only after independently verifying the Authority flag is 0 and there is no live dispatch, load the **existing** node secret privately through the approved mechanism into this one probe process; do not alter the Windows agent config, dump environment or pass a secret in command arguments. Then:

```text
node scripts/check-fleet-executor-http.cjs https://darkslategrey-raccoon-448222.hostingersite.com published --signed-disabled
```

Expected stale signature 401; valid desktop signature signed 503/FLEET_EXECUTION_DISABLED; verify response HMAC. Do not run this mode against enabled dispatch: a valid poll can claim work before the script detects the incorrect stage. Further negative cases (cross-node, tampered body/status, owner vs node, duplicate reports, stale generation) are covered by the local security script and must be rehearsed on a controlled disposable run before activation approval.

## Rollback preserving durable storage

Rollback is prepared, not executed or verified on Hostinger. It is blocked until the previous successful full SHA/build/source and actual durable directory are captured.

1. Stop new enqueue operations; drain desktop and let any command finish/report before disabling dispatch. Record unresolved RUNNING/UNCERTAIN work and inspect it; do not assume drain or a code rollback stops the process. Disabling the Authority flag also rejects reports, so preserve local terminal receipts for later reconciliation.
2. Set Authority executor flag to 0 through the approved private deploy process. At a separately approved desktop restart, set worker executor flag to 0 to restore heartbeat-only operation. Preserve its wrapper, identity, DPAPI secret, allowlist, all receipt files and `.execution-active.json`. An older executor version must not run enabled while unresolved guard/receipt state exists. This session performs neither change.
3. Restore the captured previous successful application artifact through the provider's verified flow. Do not treat Redeploy of current main as rollback: it uses the selected branch's latest commit. If no retained version-restore control exists, redeploy a prepared immutable rollback ref/artifact matching the captured old SHA, under explicit approval; do not force-push main or rewrite review history. Preserve environment/store paths and single-writer operation throughout.
4. Keep the **current** durable directory mounted/in place. Do not reset the store to a predeploy backup, wipe fleetExecutions, delete receipts, recreate runs or rotate tokens as part of code rollback. Existing store updates spread current fields, so additive execution records survive compatible older writes, but verify this against the actual old SHA before approving rollback. Stop if that older code reconstructs run objects and would discard unknown fields.
5. Verify prior run/generation/checkpoints, OAuth ingress, existing Fleet heartbeats/drain state and durable readback after restart. New executor routes may return 404 under the old build; that is acceptable only with dispatch disabled and all execution records/receipts preserved. Reintroduce the reviewed code to reconcile the same request IDs later; never relaunch uncertain work automatically.
6. Restore from backup only for independently confirmed storage corruption, with writes stopped and a reviewed reconciliation of post-backup records. A normal code rollback must retain newly written durable state.

## Unresolved release gates and continuity

- Live successful full SHA/deployment ID and immutable rollback source.
- Actual hPanel selected repository/branch, app root/start command and auto-deploy behavior.
- Actual durable directory, provider persistence/restart readback and private consistent backup evidence.
- Signed HTTPS probe after publication; healthy existing OAuth/Drive/Fleet behavior.
- Separately approved desktop-only activation with one process, protected receipts and fresh capacity.
- GitHub Actions/CodeQL execution is blocked by the account's billing lock. Resolve through the account owner or an approved existing local analyzer before claiming that gate green; no payment is authorized here.

These are deployment gates; opening the draft review PR is safe and remains authorized. No stable cross-project personal fact was added in this review: source/build/rollout facts belong in this repository, so account-memory ingestion decision is no write.

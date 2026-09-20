# Incident: ChatGPT composer drift and Windows CONTROL.md replace contention

Date: 2026-09-20
Affected workflow: `tiktok-live-dungeon-dod-20260914`
Severity: continuity degraded; durable authority preserved

## Symptoms

Two independent rollover failures were observed:

- `ChatGPT composer not ready`, surfaced as `BROWSER_ERROR` / `ROLLOVER_INCOMPLETE`.
- `CONTROL_REPLACE_BLOCKED:EPERM` while atomically replacing the live `CONTROL.md` on Windows.

The controller remained fail-closed. Project state was not lost and no competing generation was authorized from browser text alone.

## Evidence

The ChatGPT successor transport depended primarily on `#prompt-textarea` plus a narrow semantic textbox-name fallback. The confirmation transport already accepted additional labels such as `mensagem|message`, demonstrating selector-contract drift between two persistd paths.

Windows Restart Manager identified the process holding the live CONTROL file during the EPERM incident as a Desktop Commander 0.2.51 Node worker under:

`C:\ProgramData\Persistd\rdc-runtime\node_modules\@wonderwhy-er\desktop-commander\dist\index.js`

Recycling that worker released the handle. The remote worker was automatically restored afterward.

The continuation directory contained 3,013 fail-closed `CONTROL.md.pending-*` files. Their generation distribution was:

- G7: 6
- G13: 14
- G17: 439
- G18: 2
- G24: 2,373
- G26: 178
- G27: 1

No pending file had a generation newer than the live G27 authority. The only G27 pending used the earlier nonce and heartbeat and predated the later durably confirmed/resumed G27 state.

The 3,013 files were preserved, not deleted, in:

`C:\ProgramData\Persistd\backups\pending-quarantine\tiktok-live-dungeon-dod-20260914\20260920T215130Z`

A manifest was written with the source path, count, file names, and CONTROL hash at quarantine start.

## Root causes

### Composer failure

The successor and confirmation transports did not share one resilient composer-resolution primitive. A transient SPA hydration state or ChatGPT DOM/accessibility-label change could therefore exhaust the narrow timeout and report `ChatGPT composer not ready`.

### CONTROL replace failure

Persistd intentionally uses atomic replacement for controller authority. On Windows, an overlapping filesystem reader can transiently prevent the destination replace and produce EPERM. Remote Desktop Commander was the identified handle owner during the captured incident.

A verified in-place overwrite is not an acceptable fallback for controller authority because it weakens atomic replacement/fencing guarantees. A full regression run on the deployed hardening correctly rejected that attempted workaround.

## Corrective actions

1. Added a shared composer resolver with bounded retry, multiple stable/semantic/contenteditable candidates, and metadata-only diagnostics.
2. Reused the resolver for successor creation, confirmation/message sending, and the deployed terminal/health paths.
3. Changed successor guidance so Windows workers must not use Remote Desktop Commander `read_file` / `read_multiple_files` against the live CONTROL file while persistd is running. They should use a short-lived read-only process such as `Get-Content -Raw` and let it exit before requesting a claim.
4. Preserved fail-closed atomic CONTROL semantics: persistent EPERM produces `CONTROL_REPLACE_BLOCKED` and a pending candidate instead of writing the authority file in place.
5. Added regression tests for composer selector drift and the live-CONTROL transport rule.
6. Quarantined historical pending candidates after proving none was newer than the current durable authority.

## Validation

Deployed runtime validation on the controller host:

- full deployed-runtime `npm test`: 144 tests passed, 0 failed;
- clean canonical worktree validation requires `npm ci` at both the repository root and `persistd/` because the root provides server packages while `persistd/` declares the MCP client dev dependency; running only one install produced expected module-not-found false negatives;
- after installing both declared dependency sets, canonical branch `npm test`: 140 tests passed, 0 failed;
- G27 remained `ACTIVE` with `LEASE_OWNER: G27`;
- `REMOTE_BROWSER_HEALTH: HEALTHY`;
- `REMOTE_DESKTOP_HEALTH: HEALTHY`;
- `ROLLOVER_LAST_ERROR: NONE`;
- heartbeat advanced across two samples while pending count remained 0;
- after controlled RDC/controller reactivation, the new daemon process loaded the patched `C:\ProgramData\Persistd\app\src\daemon.js` runtime and the health state remained green.

No TikTok LIVE Dungeon project code was changed during this infrastructure repair.

## Follow-up: nonce-bound claim proof and commanderless deadlock

After the initial composer/CONTROL repair, the live TikTok LIVE Dungeon controller reached the next real rollover and exposed a second continuity defect.

The browser transport treated the generic first line `CLAIM <RUN_ID> G<N+1>` as enough evidence that the successor had answered, then the orchestrator reopened the conversation and attempted to verify the exact nonce-bound `CLAIM_REQUEST`. This split verification created a hydration/navigation race and could surface `CLAIM_REQUEST_NOT_VERIFIED` even though successor creation itself had otherwise succeeded.

The deployed TikTok runtime also had an opt-in `ALLOW_COMMANDERLESS_SUCCESSOR: true` mode that was not present in the canonical main branch. Its baton still told the successor to read machine-local controller files before requesting the claim even though Commander was deliberately not attached. That was a protocol contradiction: the successor was instructed to satisfy a precondition it had no transport to satisfy. The installed runtime was corrected so a commanderless successor may request the nonce-bound claim from the self-contained baton only; persistd still independently validates durable predecessor generation, status, `NEXT_GENERATION`, and nonce before promotion, so browser text never becomes authority.

The canonical fix in this branch removes the split proof window universally: `createSuccessor` now waits for the exact nonce-bound `CLAIM_REQUEST` line in the current hydrated conversation and returns it as `outcome.requestLine`. The orchestrator's existing exact verification remains as a fallback, but a successful normal path no longer depends on reopening the conversation.

Live proof after the deployed repair:

- G27 was rearmed from the prior three-attempt `BLOCKED` state only after a full 147/147 deployed-runtime test pass.
- a fresh nonce `46999963-2a6b-41f0-827f-648364dd9379` was generated for G27 -> G28;
- the durable controller promoted to `GENERATION: 28`, `STATUS: ACTIVE`, `LEASE_OWNER: G28`;
- `CLAIM_CONFIRM_STATUS: SENT` and `CLAIM_RESUMED_AT` were recorded;
- the daemon log recorded `ROLLED_OVER` followed by `WATCHING`;
- heartbeat continued advancing and the live continuation directory remained at zero `CONTROL.md.pending-*` files.

This is the acceptance criterion for the continuity repair: a real post-fix generation handoff completed through nonce-bound request verification, durable local promotion, confirmation, and observed successor resume without manual claim injection.

# Authenticated outbound Fleet executor

The first deployment target is `desktop-primary`, Windows `DESKTOP-L6CITUI`, user `Pichau`. The worker opens no listener: it polls and reports to the existing Authority over authenticated HTTPS. Tailscale is available but is not required to expose an inbound worker endpoint. No public shell, port forwarding, proxy or new credential is provisioned.

## Contract and authority

PersistFlow owns generation, routing, the durable queue and checkpoints using its existing AuthorityStore. The worker owns local execution/deduplication receipts. There is no additional queue service, database or run-state authority.

An owner-authenticated MCP/HTTP call queues a **command ID** for an eligible node. The local worker allowlist fixes executable, arguments, working directory, timeout, combined output limit and estimated scratch bytes. Requests cannot supply shell text, arguments, environment or paths. PowerShell/Python scripts use an absolute interpreter path and fixed arguments; Windows `.cmd`/`.bat` launchers are rejected. This is an authenticated executor, not an OS sandbox: allowlisted scripts retain the service user's filesystem/network permissions.

The worker signs `POST /v1/fleet/nodes/<nodeId>/executions/poll` and `/report` with existing per-node HMAC credentials. Signatures bind node, timestamp, method, path and exact body. The Authority signs responses including HTTP status. Both sides reject signatures outside a 60-second clock window; response identity and size are validated. HTTPS is required except literal loopback addresses in local tests. Redirects and TLS-verification bypasses are prohibited.

The worker exclusively creates and flushes a RUNNING receipt before spawning. Repeated request IDs cannot launch again, including after restart. Terminal receipts contain metadata only. A RUNNING receipt after restart is uncertain; it blocks new jobs until a human inspects the process and reconciles the receipt. Never delete uncertain receipts or generate new IDs to bypass them. Keep receipts on durable storage and preserve them during rollback.

The Authority records QUEUED before delivery and fixes the node/request ID. Poll re-delivers that same request until its report arrives. No lease expiry automatically moves work to another node. An interrupted report is reconciled from the worker's saved receipt. New queued jobs must match the current generation and current node eligibility; completion of an already delivered job is recorded against its original generation. Changing generation does not revoke a process already launched.

Both router and worker enforce the existing `max(50 GiB, 10%)` disk reserve; worker scratch estimates come from its local reviewed configuration. One worker instance executes one command at a time. Heartbeats continue independently of long commands and report active/unresolved jobs. Register concurrencyLimit=1 for enabled workers. Register `fleet-executor` and `command:<id>` capabilities only after deployment/smoke verification. Existing anonymous ephemeral nodes lack these capabilities and cannot receive this work.

## Worker configuration

Create a private JSON file outside Git, writable only by the worker service user. Protect the command scripts and receipt directory with OS ACLs. Example smoke command:

```json
{
  "receiptDir": "C:\\Users\\Pichau\\AppData\\Local\\Gabriel\\Fleet\\executor-receipts",
  "commands": {
    "node-version": {
      "executable": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["--version"],
      "cwd": "C:\\Users\\Pichau\\runtime\\persistflow-authority-live",
      "timeoutMs": 10000,
      "maxOutputBytes": 4096,
      "estimatedScratchBytes": 0
    }
  }
}
```

The existing approved wrapper must continue loading the Fleet HMAC secret through DPAPI and inject these opt-in variables for the updated node-agent:

```text
PERSISTFLOW_FLEET_EXECUTOR_ENABLED=1
PERSISTFLOW_FLEET_EXECUTOR_CONFIG=<absolute private JSON path>
```

It already injects `PERSISTFLOW_BASE_URL`, `PERSISTFLOW_FLEET_NODE_ID` and `PERSISTFLOW_FLEET_NODE_SECRET`. Keep its existing heartbeat/startup mechanism. Do not overwrite the consolidated startup configuration with the generic installer.

No worker port or inbound HTTPS address is needed. The poll loop sleeps five seconds between calls, limits requests to 15 seconds and suppresses repeated identical errors. Its logs contain request/command IDs, status and exit code, never command output or credentials. Timeout attempts to kill the process tree via Windows taskkill or a Linux process group; commands that intentionally detach/escape process groups are outside the contract. A process that cannot close keeps the worker busy and requires inspection.

Child processes inherit no PATH, Fleet secret, cloud credential or caller-controlled environment; only Windows system/temp variables are forwarded. Scripts that need configuration must use reviewed fixed paths. Output capture is bounded to at most 32 KiB combined stdout/stderr, with the known HMAC secret redacted. Output is not sent to the Authority or persisted in receipts. Scripts must avoid printing other secrets; unknown secrets cannot be detected reliably. Allowlist behavior changes require a new command ID while old operations remain reconcilable.

## Authority configuration and use

Publish the updated Authority code first. After its normal router/Drive readiness gates, explicitly enable:

```text
PERSISTFLOW_FLEET_ROUTER_ENABLED=1
PERSISTFLOW_FLEET_EXECUTOR_ENABLED=1
```

Keep the existing `PERSISTFLOW_FLEET_NODE_SECRETS_JSON` injection. Add the desktop's verified command capabilities to the existing Fleet registry. No endpoint mapping, new token or worker owner credential is required.

Use authenticated MCP tool `persist_fleet_execute`, or owner-authenticated `POST /v1/runs/<runId>/fleet/execute` with an existing run/current generation:

```json
{
  "generation": 1,
  "operationId": "node-version-001",
  "commandId": "node-version",
  "intent": { "taskId": "version-probe", "summary": "Verify desktop Node version", "pinnedNodeId": "desktop-primary" }
}
```

This returns QUEUED, not success. Repeat the same operationId/unchanged input to inspect its latest status. COMPLETED with exitCode=0 proves the worker reported successful termination. RUNNING, UNCERTAIN, REJECTED, FAILED and TIMED_OUT are not successful execution. Receipt replay and report retries cannot create another process or duplicate a terminal checkpoint. Raw stdout/stderr is deliberately absent from the Authority API/state.

## Rollback and live gates

Drain the desktop before a controlled rollout/restart. Set the flag to `0` on the Authority to stop dispatch and on the worker to return to heartbeat-only mode on its next restart. Let active commands finish or inspect/terminate them explicitly. Keep worker receipts, Authority queue records and checkpoints; rollback does not delete artifacts or rotate credentials.

Before enablement, verify the new poll/report paths through the actual configured Authority and verify HMAC request/response behavior. Perform one live `node-version` job, inspect its generation checkpoint and exit code, retry the same operation ID, confirm no second process ran, and verify rejection of an unlisted command. Recheck disk reserve, heartbeat activeJobs and recovery after restart. Tests use synthetic secrets, capacity and heartbeats, so they do not prove live eligibility.

## Verified connectivity and activation blocker, 2026-10-10

- Fleet local configuration selects `desktop-primary` and the existing Authority origin `https://darkslategrey-raccoon-448222.hostingersite.com`.
- Windows identity was verified as `DESKTOP-L6CITUI` / `Pichau`.
- Tailscale status: Running, self online, IPv4 `100.98.47.109`; this establishes local daemon state, not remote peer reachability.
- Authority `GET /healthz`: HTTP 200.
- Unsigned `POST /v1/fleet/nodes/desktop-primary/executions/poll`: HTTP 404. The updated Authority should reject this probe with HTTP 401. Current remote queue availability is unproven/unavailable at this path.
- Free C: at the connectivity check was 54,280,323,072 bytes (about 50.55 GiB), only slightly above the 50 GiB minimum. This does not substitute for a fresh eligibility check at rollout/execution.

Activation remains pending publication of the queue endpoints on the actual Authority, verification of signed communication, desktop command capability enrollment and controlled worker rollout. No existing Fleet process or startup setting was changed, no port was opened, and no other service endpoint was treated as an inbound address for the desktop.

## Reuse and account-memory decision

Reused existing HMAC, FleetRouter eligibility, disk-reserve policy, AuthorityStore and checkpoints, plus Node's shell-free process API. Evaluated the locally available remote-agent-server: it targets ACP/LLM providers with provider authentication, SQLite and UI dependencies unnecessary for fixed commands. This narrow native integration adds no dependency or control plane.

The node choice and outbound delivery requirement are project-specific execution constraints, recorded here. No new stable cross-project personal fact was produced, so no account-memory write was required.

Focused checks from `persistd/`: `node --test fleet-executor.test.js fleet-executor-integration.test.js fleet-node-agent.test.js fleet-auth-store.test.js persistflow-fleet-integration.test.js`. Run the complete PersistFlow suite before integrating/releasing this code.

Validation on the final functional tree (2026-10-10): complete PersistFlow `npm test` passed 250/250, root `npm test` passed 23/23, Spec Kit validation passed, changed JavaScript syntax checks and `git diff --check` passed. The complete PersistFlow run used a clean copy of all versioned/candidate files and real copies of the already installed 21.61 MiB dependency tree. Earlier runs passed all product tests but failed the isolated Hostinger packaging test because dependency junctions could not be recopied; no product test was weakened or skipped to resolve that environment issue.

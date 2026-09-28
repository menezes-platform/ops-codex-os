# Railway anonymous ephemeral workers

PersistFlow can treat Railway's anonymous `ssh railway.new` boxes as disposable compute.

## PersistFlow composition and rollout gate

The production composition is in `start-entrypoint.js`: the existing `FleetRouter` includes one virtual `railway-anonymous` candidate only when both flags below are `1`. The candidate has fixed conservative limits (2 vCPU / 2 GB RAM, at most 512 MiB requested scratch, Linux CLI/build/test capability) and is hard-ineligible for GUI, GPU, browser-session, local-only, pinned-to-another-node, unsupported capabilities, and exhausted local quota. TypeSafe scores only hard-eligible candidates; its deterministic fallback honors an explicit `preferredCapabilities: ["ephemeral-worker"]` before resource ranking.

Both flags default off:

```text
PERSISTFLOW_FLEET_ROUTER_ENABLED=1
PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED=1
```

With either flag absent/off, the anonymous provider is not composed into production routing and the pre-existing route path remains unchanged. Rollback is to set `PERSISTFLOW_RAILWAY_EPHEMERAL_ENABLED=0` (and, if fleet routing itself should be disabled, `PERSISTFLOW_FLEET_ROUTER_ENABLED=0`), then restart the PersistFlow process. The durable run/checkpoint files are not removed by flag rollback.

The MCP tool `persist_fleet_execute_ephemeral` accepts a run/generation, caller-stable `operationId`, bounded shell command, and FleetRouter intent. It writes the operation ID, command digest, correlation ID, selected provider, and route evidence to the existing PersistFlow authority before acquiring a worker. It does not persist the command text, worker private key, claim URL, cookie, bearer, or remote stdout/stderr. Repeating a completed or in-progress operation ID inspects the same durable state and does not acquire or execute again. A restart with an already acquired operation records/returns its state without replaying a non-idempotent command.

For cooperative multi-box work, a command may emit a final line in this format:

```text
PERSISTFLOW_HANDOFF_BASE64=<base64-encoded JSON checkpoint object>
```

The command on the successor receives that JSON as `PERSISTFLOW_RESUME_BASE64`. The checkpoint must be a bounded JSON object (maximum 64 KiB) without credential-like fields or known secret patterns. PersistFlow acquires and probes G2 while G1 remains alive, persists the checkpoint/handoff evidence, and only then releases G1. If successor acquire/readiness/finalization fails, G1 remains alive and the operation is marked `HANDOFF_BLOCKED`; repeating the same operation ID does not silently replay it.

When Railway is ineligible or its local daily budget is empty, routing evidence records the reason and the existing FleetRouter candidate can still be selected. `persist_fleet_execute_ephemeral` reports that routing decision; this repository's FleetRouter currently records routing to persistent fleet nodes but does not itself provide a command-dispatch API for those nodes. The existing persistent node-agent only posts heartbeats and requests Drive access. Therefore a selected non-Railway fleet node is a recorded route/fallback, not proof that this tool executed the command on that node. Use the existing Sandbox job API for durable broker execution until that node dispatch seam exists.

## Railway's current anonymous offer

Railway's official Free Trial documentation currently says the unauthenticated `ssh railway.new` offer provides 2 vCPU / 2 GB RAM for up to 60 minutes, with a 24-hour claim window and a limit of 3 boxes per IP address per day. Railway says anonymous trials can be temporarily disabled during high demand; those attempts do not count against the daily limit. Unclaimed boxes are deleted with their files. Provider release removes the controller's SSH key material; it cannot issue an account-side Railway delete for an anonymous box. The VM is disposable and expires under Railway's offer lifecycle. See [Railway Free Trial: Try without an account](https://docs.railway.com/pricing/free-trial#try-without-an-account).

## Verified provider contract

Railway returns a machine-readable JSON manifest when an agent connects over SSH. The manifest includes:

- `preview_url`
- `build_expires_at`
- `human_claim_url`
- command hints such as `ssh railway.new COMMAND_HERE`

The anonymous offer currently provides 2 vCPU / 2 GB RAM, a 60 minute build window, and a documented limit of 3 boxes per IP address per day. Capacity can also be temporarily unavailable.

The provider in `src/fleet/railway-anonymous.js` therefore:

1. generates a fresh Ed25519 identity for each new worker so the controller can have an overlapping predecessor and successor;
2. creates the box from the controller with `ssh railway.new`;
3. parses the real `build_expires_at` from Railway instead of assuming 60 minutes;
4. runs remote commands through standard SSH and supports SCP under `/app`;
5. keeps a local daily budget ledger and never intentionally exceeds the documented 3-box limit;
6. strips Railway's repeated manifest from command logs;
7. removes the local worker key after a completed handoff or finished task.

The controller, not the anonymous worker, creates successors. This keeps quota accounting on the same origin and avoids turning recursive workers into a quota-bypass mechanism.

## Handoff protocol

`EphemeralWorkerLoop` is provider-agnostic. A worker executes until it can safely checkpoint, then returns:

```json
{
  "status": "handoff",
  "resume": {
    "commit": "abc123",
    "step": 7,
    "nextSafeAction": "continue integration tests"
  }
}
```

The loop then:

1. acquires the successor before releasing the predecessor;
2. records `ephemeral.worker.successor_ready`;
3. runs the caller's `finalizeHandoff` hook while both workers are still addressable;
4. records `ephemeral.worker.handoff`;
5. releases the predecessor;
6. resumes on the successor with the exact resume payload.

A completed worker returns:

```json
{
  "status": "completed",
  "result": {
    "commit": "def456"
  }
}
```

PersistFlow remains the authority for run generation, checkpoints, leases, and route evidence. Git remains the source of truth for code. Railway workers are disposable execution capacity.

## PersistFlow checkpoint sink

A caller can persist every loop event with the existing service API:

```js
const loop = new EphemeralWorkerLoop({
  provider,
  checkpoint: (event) => service.checkpoint(runId, {
    generation,
    nextSafeAction: event.resume?.nextSafeAction,
    evidence: event,
  }),
});
```

Do not persist `worker.keyPath` or the claim URL. `provider.describe(worker)` intentionally returns only bounded non-secret worker metadata.

## Smoke test

From the PersistFlow host:

```bash
npm run fleet:railway:smoke -- 'printf "REMOTE_OK\\n"; uname -s; node --version'
```

This consumes one anonymous box from the documented daily allowance.

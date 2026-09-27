# Railway anonymous ephemeral workers

PersistFlow can treat Railway's anonymous `ssh railway.new` boxes as disposable compute.

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

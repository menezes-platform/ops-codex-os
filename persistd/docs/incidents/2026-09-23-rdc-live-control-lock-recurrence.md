# Incident: recurring RDC live CONTROL lock on TikTok controller

Date: 2026-09-23  
Run: `tiktok-live-dungeon-dod-20260914`  
Host: `tiktok-live-aws`

## Symptom

The durable controller stopped advancing after G104. The Windows scheduled task remained enabled/running and the channel watchdog retried the daemon, but the daemon exited repeatedly with `CONTROL_REPLACE_BLOCKED:EPERM`.

## Evidence

- Durable G104 heartbeat stalled at `2026-09-23T16:50:42Z`.
- `persistd-dungeon.out.log` emitted `CONTROL_REPLACE_BLOCKED:EPERM` on repeated ticks.
- `persistd-dungeon-supervisor.log` showed repeated `EXIT code=-1` / restart cycles.
- Restart Manager identified the current holder of the live `CONTROL.md` as the Desktop Commander Node worker:
  `C:\ProgramData\Persistd\rdc-runtime\node_modules\@wonderwhy-er\desktop-commander\dist\index.js`.
- Commander tool history contained a direct `read_file` call against the live `CONTROL.md`, a transport pattern already forbidden by the persistent controller contract.

## Root cause

Persistd correctly preserves fail-closed atomic replacement on Windows. A Desktop Commander worker retained an open handle to the live controller file, so atomic replacement failed with EPERM. The host watchdog could detect stale heartbeat and recycle persistd, but it did not distinguish this lock condition; restarting only the daemon left the offending RDC handle alive and created an infinite restart loop.

## Recovery

The existing one-shot RDC lock repair was launched detached so it could terminate the Commander worker holding the handle, rearm persistd, then restore RDC. This time the repair log recorded:

- `PERSISTD_CONTROL_ADVANCED=YES`
- live CONTROL advanced from `2026-09-23T16:50:43Z` to `2026-09-23T17:53:09Z`
- durable authority promoted G104 -> G105
- `CLAIM_RESUMED_AT: 2026-09-23T17:53:07.888Z`
- no Restart Manager holder remained on `CONTROL.md`

## Runtime hardening

The host watchdog was patched so recovery is selective:

1. require a stale controller heartbeat;
2. require recent persistd output containing `CONTROL_REPLACE_BLOCKED`;
3. recycle Desktop Commander workers matching the known RDC runtime path;
4. then recycle/rearm the daemon through the existing scheduled-task path;
5. allow the normal RDC watchdog path to restore the remote Commander.

The atomic writer was not weakened and no in-place CONTROL overwrite fallback was reintroduced.

## Validation

- PowerShell parser: `SYNTAX_OK`.
- Manual watchdog execution with healthy heartbeat produced no false recovery.
- Channel health remained `daemon=True rdc=True` across successive watchdog samples after recovery.
- Supervisor log showed no further daemon exit after the repaired start at 14:53 local.
- Live CONTROL remained G105 / ACTIVE with advancing lease/heartbeat and no file holder.

## Prevention

The live-CONTROL rule remains mandatory: on Windows, never use Remote Desktop Commander `read_file` or `read_multiple_files` against live `CONTROL.md` while persistd runs. Use a short-lived process such as `Get-Content -Raw` and let it exit. Host recovery must nevertheless remain capable of self-healing this class of transport violation so one accidental read cannot indefinitely stall the controller.

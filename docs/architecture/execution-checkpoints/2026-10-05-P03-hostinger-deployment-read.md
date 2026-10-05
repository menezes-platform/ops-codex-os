# P03 — Hostinger deployment-list read

- `phase_id`: `P03`
- `checkpoint_id`: `P03-HOSTINGER-DEPLOYMENT-READ-2026-10-05T02:10:15Z`
- `recorded_at`: `2026-10-05T02:10:15Z` UTC
- `status`: `HOSTINGER_LATEST_DEPLOYMENT_CURRENT_AND_COMPLETE_VM_CALLERS_ROLLBACK_OPEN`
- `P03_exit`: `NOT_PASSED`
- `HG-001`: `OPEN`
- `frozen_spec`: `unchanged`
- `scope`: read-only hPanel deployment-list inspection

## Observed

On the hPanel deployment list for `darkslategrey-raccoon-448222.hostingersite.com`, the latest row was shown as archive `persistflow-rfc9207-20260929.zip`, time `2026-10-04 23:44:46`, status `Concluído`, and marked `Atual`. hPanel displayed 15 deployments total, with the first page showing ten. The displayed deployment time has no timezone label in the list; it is preserved as shown and not converted to UTC.

The deployment-details route currently in the panel had deployment identifier `01a1094e-4561-7179-a9e5-e00378da3390`, but its rendered content exposed only the page title/navigation in this inspection. This checkpoint does **not** bind that identifier to the list row or infer a source commit, deployment payload, configuration snapshot, or service process state from it.

No deployment logs, environment-variable values, secrets, or service configuration were opened. No deployment, restart, configuration change, or production write was performed.

## Gate impact

This adds panel evidence that Hostinger labels its latest listed deployment current and completed. Combined with the earlier timestamped `/healthz` 200 probe, it supports recovered application availability at observed times. It does not establish the Hostinger VM/collector's systemd services, processes, storage paths, origins, heartbeat destination, or worker status; enumerate all global callers/writers; prove one authoritative primary; or provide a current cutover rollback snapshot. P03 and HG-001 remain open, so P04 formal entry remains unsatisfied.

Continue with independent offline P05/P06/P07/P08 preparation. Before a cutover or state migration, obtain the VM service/caller map and a fresh, verified rollback artifact through an owner-controlled read-only inventory and backup procedure.

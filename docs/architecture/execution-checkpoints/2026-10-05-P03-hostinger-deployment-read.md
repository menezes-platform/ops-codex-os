# P03 — Hostinger deployment-list read

- `phase_id`: `P03`
- `checkpoint_id`: `P03-HOSTINGER-DEPLOYMENT-READ-2026-10-05T03:17:54Z`
- `recorded_at`: `2026-10-05T03:17:54Z` UTC
- `status`: `HOSTINGER_LATEST_DEPLOYMENT_CURRENT_AND_COMPLETE_VM_CALLERS_ROLLBACK_OPEN`
- `P03_exit`: `NOT_PASSED`
- `HG-001`: `OPEN`
- `frozen_spec`: `unchanged`
- `scope`: read-only hPanel deployment-list inspection

## Observed

On the hPanel deployment list for `darkslategrey-raccoon-448222.hostingersite.com`, the latest row was shown as archive `persistflow-rfc9207-20260929.zip`, time `2026-10-04 23:44:46`, status `Concluído`, and marked `Atual`. hPanel displayed 15 deployments total, with the first page showing ten. The displayed deployment time has no timezone label in the list; it is preserved as shown and not converted to UTC.

The opened deployment-details page for identifier `01a1094e-4561-7179-a9e5-e00378da3390` showed the same archive and displayed time, with `Estado: Concluído`, marked current. Its log says the source came from the previous successful deployment, restored those source files, used entry file `src/hostinger-entry.js`, loaded environment variables from `.env`, installed dependencies, published the version, and restarted the Node.js application. The page lists no source commit, so the deployment cannot be tied to a repository revision or prove that any local source change was deployed.

The deployment list and details were reopened read-only at `2026-10-05T03:17:54Z`; the visible latest deployment remained `Concluído` and `Atual`. The displayed deployment time is preserved as shown and is not converted to UTC.

No deployment logs, environment-variable values, secrets, or service configuration were opened. No deployment, restart, configuration change, or production write was performed.

## Gate impact

This adds panel evidence that Hostinger labels its latest listed deployment current and completed, and that the associated details restored the previous successful source before publishing. Combined with the bounded `/healthz` 200 probe at `2026-10-05T03:17:53Z–03:17:54Z`, it supports recovered application availability at observed times. It does not identify a source commit or establish the Hostinger VM/collector's systemd services, processes, storage paths, origins, heartbeat destination, or worker status; enumerate all global callers/writers; prove one authoritative primary; or provide a current cutover rollback snapshot. P03 and HG-001 remain open, so P04 formal entry remains unsatisfied.

Continue with independent offline P05/P06/P07/P08 preparation. Before a cutover or state migration, obtain the VM service/caller map and a fresh, verified rollback artifact through an owner-controlled read-only inventory and backup procedure.

# DESKTOP-OBSERVATION-001 — security review

2026-10-11 continuation supersedes the original review disposition below: [hardening findings and verification](desktop-observation-hardening.md). Additional generation, directory-race, node freshness, image validation and argument-type findings were reproduced and corrected. Final independent approval remains pending; the earlier statement of no known code blockers was a historical snapshot, not current release approval.

Scope: observation adapter in ops-codex-os on PR33 base and canonical Windows Host extensions in Dev-Orquestra on PR20 base. Root-agent source review and adversarial local tests; independent human PR review remains required. CodeQL was unavailable due to GitHub billing and is not claimed to have run. No extra AI reviewer or paid service was used.

| Boundary | Evidence / outcome |
|---|---|
| Owner authentication | Existing MCP bearer/digest/OAuth path retained; unauthenticated MCP requests rejected in existing tests |
| Node/operation authorization | Three independent opt-ins: Authority node/operation map, local Fleet operation list, host SID/hostname/session verification; node literal desktop-primary in MCP; disabled by default |
| Network | Existing outbound Fleet process only; HTTPS except explicit loopback test; no redirects; host remains loopback; public control ports and arbitrary shell are absent |
| Replay and generation | HMAC binds exact path/method/body/time and response status; one durable claim, fixed random requestId/deadline; mismatched node/job/operation/args or replayed reports rejected; current run generation required |
| Idempotence/restart | Reusing operationId returns only a fresh memory cache or typed expired result; no automatic recapture; local exclusive receipt is flushed before read/capture; Authority restart loses observations, not canonical metadata, and does not redeliver |
| Session safety | Windows current process SID must match configured owner AND WTS logged-in session SID; active interactive nonzero session and input desktop Default; recheck after read; fake locked/unavailable/user-mismatch/session-change cases fail closed |
| Images | Actual PNG image content through MCP verified; GDI decode/normalize in native host; resolution/size/source bounds/freshness/expiry checked; memory cache expiry; no screenshots on disk or durable run state |
| Files | OS Known Folder resolution; immediate children only; traversal/ADS/reparse root/ancestor/child denied; final open-handle path and hard-link count verified; read handle denies sharing for write/delete; protected names/formats/content rejected; only <=16 KiB UTF-8 .txt/.md preview |
| UI privacy | Visible labels/control types only; no ValuePattern/clipboard/DOM cookies; password/protected/offscreen controls excluded; max depth/nodes; timeout fences subsequent UI inspection until controlled host recovery |
| Budgets | Fixed wait/request/image/payload/rate/concurrency/operation/receipt limits; oversized and malformed payloads rejected; optional malformed observation config disables just observation |
| Durable failures | Regression proved a timeout store-write failure is caught, returns OBSERVATION_STORAGE_UNAVAILABLE, retains replay fencing and cannot crash the existing Authority from a timer callback |
| Logs/secrets | Safe fixed error codes and opaque IDs only; no raw responses, private names, screen bytes, bearer/HMAC values or token files committed; local real integration logs contain metadata only |

Findings corrected during review with failing regression then passing checks: malformed optional config affecting Authority startup; UIA native timeout accumulation; invalid image expiry/untyped response payloads; uncaught durable-storage failure during timeout. No known unresolved blocker in the reviewed changed code surface. This does not attest to independent review, production deployment or inaccessible provider state.

Residual operational constraints: existing single Authority writer and exactly one installed Fleet agent/shared private receipt directory; local file-store transactions are not a cross-process distributed lock and no power-loss exactly-once claim is made. On-disk receipts have a finite ceiling and require owner-controlled maintenance, never silent cleanup. Known-folder cloud/reparse placeholders fail closed; privileged symlink fixture creation was unavailable, junction tests exercise reparse containment. File-name/content secret detection is conservative defense, not universal classification. Owner-authorized screenshots can contain private visible material; no automatic screen-wide redaction promise. Native Windows session/monitor/screen state is checked at operation boundaries, not atomically frozen.

Production gate: preserve the durable store/old artifact and prove backup/isolated restore, one writer and rollback compatibility before publication. New feature is disabled by default and does not change executor allowlist, reserve policy, Tailscale, RDP Commander or recovery configuration. Detailed activation/rollback and typed contracts are in desktop-observation.md.

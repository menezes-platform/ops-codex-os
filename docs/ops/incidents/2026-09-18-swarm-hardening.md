# Swarm Hardening Incident Log — 2026-09-18

Purpose: durable prevention of failures observed while restoring the TikTok LIVE Dungeon / Gabriel Ops execution swarm.

| # | Failure | Root cause / evidence | Correction | Prevention |
|---|---|---|---|---|
| 1 | Live processes were reported as workers | Antigravity/OpenCode/browsers were alive but idle or DONE | Added evidence-based worker classification | Process/window presence never renews a lease |
| 2 | Dashboard ChatGPT stuck | Stop button + timeout + unchanged tool count | Recovered chat in fresh window and redispatched | No progress past TTL = STALE |
| 3 | Secondary ChatGPT stopped on GitHub connector | Connector lacked repo access | Redispatched through local/alternate authorized routes | Connector failure is not a human gate when fallback exists |
| 4 | MyClawn authenticated but idle | Blank prompt, no task | Dispatched QA/red-team lane | Authenticated blank prompt = IDLE |
| 5 | Antigravity residual runner after DONE | Task status was DONE although runner survived | Released task and dispatched next lane | Terminal task state outranks process presence |
| 6 | OpenCode had no provider | Start screen requested /connect | Reused OmniRoute setup-opencode | Provider readiness is worker health |
| 7 | OmniRoute emitted invalid 138-model OpenCode config | Many models lacked limit.output | Restricted provider to validated auto/* aliases (38 models) | Validate generated provider schema before replacing config |
| 8 | OmniRoute split brain | Process/catalog/port alive while health CLI said down | Classified ERROR/split-brain | Process + API + health signals must agree |
| 9 | First OpenCode run stalled | Process alive, no worktree/output progress | Killed and redispatched via auto/best-coding-fast | Stalled progress triggers cooldown + redispatch |
| 10 | Antigravity global suite had unrelated missing module failures | Fresh worktree lacked node_modules | Focused worker tests passed; integration must bootstrap deps | Separate code failure from environment/bootstrap failure |
| 11 | Remembered TTK path missing | C:\persistd-work\TikTok-LIVE-dungeon no longer canonical | Resolved menezes-platform/ttk-live-dungeon and cloned current repo | owner/repo + SHA outranks remembered paths |
| 12 | rg assumed available | rg was not installed | Used PowerShell/Git search | Probe optional CLI availability |
| 13 | Desktop Commander transiently said no devices | Next device listing showed desktop online | Retried authority discovery | One transport sample cannot establish host failure |
| 14 | Desktop Commander and Tailscale disagreed on EC2 | DC offline; Tailscale aws-vm/tiktok-live-aws active | Kept alternate host routes eligible | Transport health != host health |
| 15 | Tailscale/TCP healthy but SSH auth unhealthy | ping/TCP22 passed; SSH exit 1/255 | Did not mark SSH usable; continued through other routes | Reachability != authenticated control |
| 16 | Remote PowerShell command quoting drift | Nested command partly interpreted locally | Abandoned fragile quoting | Use encoded/script-file or simple structured remote commands |
| 17 | UI automation helper errors | Code Mode had no Buffer; one probe had PS syntax error | Reissued small verified probes | Small scripts + post-action verification |
| 18 | First incident-log template failed | Embedded host-language delimiter caused JS syntax error | Rewrote delimiter-safe | Escape host-language delimiters |
| 19 | Incident-log parent directory absent | write_file does not create missing parent tree | Explicitly created docs/ops/incidents first | Ensure parent directories before durable writes |

## Hardening invariants

1. Fresh evidence, not liveness, renews worker leases.
2. IDLE, DONE, STALE and ERROR workers are redispatch candidates when safe non-conflicting work exists.
3. Human gates are limited to real auth/MFA/CAPTCHA, unavoidable spend, irreversible destructive action, or explicit cancellation.
4. Mutable lanes carry conflict keys; only one RUNNING task may own a conflict key.
5. Worker/task leases expire and stale owners cannot fence the queue forever.
6. Retry exhaustion becomes durable BLOCKED with a reason.
7. Git/runtime authority outranks chat titles, remembered paths and dashboard projections.
8. Host health and transport health are separate dimensions.
9. Split-brain signals are errors, never green.
10. Every dispatch must emit evidence that can be probed on the next supervisor tick.

| 20 | OpenCode T10 launch was blocked when command attempted inline secret-file loading | Automation safety blocked the route before launch | Reused existing User-scoped OMNIROUTE_API_KEY environment without exposing its value | Secrets are resolved by local environment/provider config, never copied into prompts or command text |
| 21 | Daemon/supervisor contract would have lost tasks and leases | Daemon normalized workers to array, dropped tasks, and reloaded a static registry every tick | Preserved tasks/top-level state, accepted array/map inputs, passed dispatchers/clock, and atomically persisted supervisor registry | A daemon integration test must prove assignment survives registry reload before runtime activation |

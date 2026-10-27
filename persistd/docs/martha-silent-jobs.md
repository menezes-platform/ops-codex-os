# Martha: silent background jobs

This module is the **local execution layer**, not a Hostinger HTTP execution endpoint. It deliberately does **not** enable Fleet routing. As of the initial rollout, `conthabil-martha` remains `drained: true` in `persistd/config/fleet.json` until the separate dispatch/Drive smoke gates are satisfied (issue #50).

## Behavior

- Entry: `persistd/src/fleet/silent-job.js` (`runSilentJob`) and manifest CLI `silent-job-cli.js`.
- The Windows hidden launcher `silent-job-launcher.vbs` uses `wscript.exe //B //Nologo` and `WScript.Shell.Run(..., 0, True)`: no open console for the launcher.
- The child uses `spawn` with `windowsHide:true`, `shell:false`, `detached:false`, `stdio: [ignore, pipe, pipe]`. Only `node`, `git`, and a Python interpreter explicitly configured via `FLEET_PYTHON_EXE` (never the WindowsApps alias) are supported tools; CMD, PowerShell, arbitrary shell commands and executable paths are rejected.
- Any `requiresInteractiveUi`, `requiresBrowserSession` or `requiresGpu` request is rejected in silent mode. Commands that themselves open GUI subprocesses are out of scope; don't schedule them as silent jobs.
- The `cwd` must resolve inside a trusted `allowedRoot`. Job manifests are read only from a configured local jobs root (default `%LOCALAPPDATA%\ConthabilFleet\jobs`). An explicit `FLEET_SILENT_JOB_ROOT` may be set by a trusted local operator for CI/tests.
- Per-task logs and `receipt.json` go under `jobs\logs\<taskId>\`. IDs cannot be replayed: the directory creation fails on duplicates. Default cap 1 MiB of combined stdout/stderr; default timeout 60 s; absolute maximum 15 min / 8 MiB.
- The child **does not inherit** the node HMAC secret. Git prompts are disabled (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`), and CI/TERM/NO_COLOR are noninteractive.
- No network-exposed remote command handler is created. To submit jobs remotely, a separate authenticated, replay-safe dispatch service and receipts are required; this layer must not bypass the existing drained/router gate.

## Local smoke (on Martha)

Put a manifest like this in `%LOCALAPPDATA%\ConthabilFleet\jobs\probe.json` (set `cwd` to that local jobs directory):

```json
{"taskId":"probe-unique","tool":"node","args":["-e","process.stdout.write('silent-ok')"],"cwd":"C:\\Users\\ODETE\\AppData\\Local\\ConthabilFleet\\jobs"}
```

From an existing authenticated SSH session invoke: `wscript.exe //B //Nologo "%LOCALAPPDATA%\ConthabilFleet\agent\silent-job-launcher.vbs" "%LOCALAPPDATA%\ConthabilFleet\jobs\probe.json"`. Inspect `jobs\logs\probe-unique\receipt.json`; don't keep a visible terminal on the workstation. The launcher returns a process exit status, and the JSON receipt contains the outcome. Never submit secrets through the manifest.

## Next gate

Integration with authenticated Fleet dispatch and end-to-end smoke testing of Git/Node/Python workspaces and Drive cache remains outstanding. Until then the installed silent runner handles only **explicit local** manifests. The Fleet heartbeat agent remains separate and its status unchanged.

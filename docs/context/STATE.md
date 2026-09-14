# YouCine Bridge — Verified State

## Objective
Provide a one-click Windows launcher for YouCine using a persistent isolated Android runtime, with fullscreen, free PiP, single-instance behavior, hotkeys, watchdog recovery, and no normal dependency on the Moto.

## Current branch
`feature/youcine-bridge`

## Verified implementation
- .NET 10 WinForms bridge with deterministic adb/scrcpy discovery.
- Trusted `RuntimeEndpoint` preference and persistent settings.
- One managed scrcpy session with 1920x1080/240 virtual display and `--flex-display`.
- Playback audio request, 12 Mbps video, 60 fps, initial fullscreen.
- Free/resizable topmost PiP with persisted bounds.
- Single-instance activation, reconnect, retry/backoff, watchdog, tray lifecycle, and rotating logs.
- `Ctrl+Alt+P` PiP/fullscreen, `Ctrl+Alt+Y` focus, `Ctrl+Alt+R` reconnect.
- F11 is handled natively by scrcpy 4.1 to avoid double fullscreen handling.

## Persistent Android runtime
- ReDroid Android 12 runs natively on the existing ARM64 AWS host.
- Binder is configured to load at boot.
- Docker container uses persistent `/data` and `restart=unless-stopped`.
- ADB listens only on the Tailscale interface.
- YouCine 1.17.5 is installed as `arm64-v8a` and survives container restart.

## Final evidence
- Release build: 0 warnings / 0 errors.
- VSTest/xUnit: 47 passed, 0 failed, 0 skipped.
- Live virtual display created at 1920x1080/240 and 60 Hz.
- YouCine reached `com.mobile.brasiltv.activity.MainAty` with no `UnsatisfiedLinkError`, fatal signal, or fatal exception.
- Watchdog replaced a killed scrcpy process without duplication.
- Reconnect hotkey replaced the managed session and returned to `MainAty`.
- PiP toggle, focus hotkey, single-instance activation, and native F11 windowed/fullscreen round trip passed.

## DoD
COMPLETE.

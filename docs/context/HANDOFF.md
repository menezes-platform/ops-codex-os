# YouCine Bridge — Handoff

## Status
DONE — one-click Windows bridge verified against the persistent ARM64 Android runtime.

## Runtime
- Primary runtime: persistent ReDroid Android 12 on the existing ARM64 AWS host.
- ADB is bound only to the host's Tailscale address; no public ADB listener is used.
- Persistent `/data`, Binder boot configuration, Docker autostart, and `restart=unless-stopped` are active.
- YouCine `com.world.youcinemobile` 1.17.5 is installed natively as `arm64-v8a`.
- Local Bridge settings select the persistent `RuntimeEndpoint`; the Moto is not required for normal use.

## Windows bridge
- Installed under `%LOCALAPPDATA%\Programs\YouCineBridge` with Start Menu shortcut `YouCine`.
- Canonical scrcpy 4.1 profile: 1920x1080/240 virtual display, `--flex-display`, playback audio, 12M bitrate, 60 fps, fullscreen.
- F11 fullscreen handling is intentionally delegated to scrcpy's native F11 shortcut; the bridge owns `Ctrl+Alt+P/Y/R` only.
- Single-instance, PiP, focus, reconnect, and watchdog recovery are active.

## Verification
- Release build: 0 warnings, 0 errors.
- Real xUnit execution through VSTest: 47/47 passed.
- Real smoke: one bridge + one scrcpy, virtual display created, YouCine reached `MainAty`, no native fatal crash.
- Killing managed scrcpy caused watchdog recovery with exactly one replacement session.
- `Ctrl+Alt+R`, `Ctrl+Alt+P`, `Ctrl+Alt+Y`, and native F11 were verified live.

## Remaining human-only action
None required for bridge operation. Do not fabricate or bypass YouCine entitlement or account state.

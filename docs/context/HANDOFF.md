# YouCine Bridge — Handoff

## Current phase
Windows launcher/package is verified; finish Android connectivity so clicking **YouCine** opens a usable session.

## Completed
- Core bridge architecture implemented through TDD.
- Free PiP, fullscreen/windowed mode, single-instance, watchdog, runtime endpoint preference, coordinator, tray lifecycle, and Start Menu packaging exist.
- `install.ps1` publishes Release/win-x64, installs under `%LOCALAPPDATA%\Programs\YouCineBridge`, and creates `YouCine.lnk` without modifying taskbar pins.
- Installed Start Menu shortcut was launched successfully and produced exactly one installed `YouCineBridge.exe` process.
- Global hotkey registration now degrades per shortcut instead of aborting startup when another app owns one binding.
- Runtime state and logs remain under `%LOCALAPPDATA%\YouCineBridge`.

## Validated
- 47/47 full-suite tests pass after the hotkey-conflict regression fix.
- Real installed smoke proves the Win32 1409 `Ctrl+Alt+P` conflict no longer aborts startup; the bridge reaches `DeviceResolver`.
- Moto G75 is reachable over Tailscale at `100.106.31.127`.
- Google Platform Tools 37.0.1 is present at the ToolLocator WinGet path.
- Wireless Debugging is enabled on the Moto, but this Windows ADB client is not currently paired/connected; mDNS discovery returns no services.

## Pending
- Complete ADB Wireless TLS pairing/connection to the Moto for the immediate usable smoke path.
- Verify YouCine package launch, scrcpy fullscreen/PiP/input/audio, reconnect, and watchdog recovery.
- Bring up a stable persistent Android/ReDroid host to remove normal phone dependency; `tsim-vm` is currently absent from the tailnet and `persistflow` lacks the installed binder module needed by ReDroid.
- Migrate authenticated app state only if supported; never fabricate server entitlement.

## Exact next action
Open Android **Wireless debugging → Pair device with pairing code**, pair this Windows ADB client using the shown port/code, connect to the advertised debugging port, then run the full real-session smoke and commit/push the verified checkpoint.

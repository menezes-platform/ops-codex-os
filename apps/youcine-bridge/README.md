# YouCine Bridge

Windows tray launcher for the authorized YouCine Android session managed through `adb` + `scrcpy`.

## Requirements

- Windows x64.
- .NET 10 Desktop Runtime.
- Google Platform Tools installed by WinGet, or an explicit `AdbPathOverride` in settings.
- scrcpy 4.1 installed by WinGet, or an explicit `ScrcpyPathOverride` in settings.
- An authorized Android endpoint reachable by ADB with `com.world.youcinemobile` already installed.

The bridge does not create or alter subscription entitlements. It only opens the authenticated app state available on the selected Android runtime.

## Install

From PowerShell in this directory:

```powershell
.\scripts\install.ps1
```

The script publishes `Release/win-x64`, installs under `%LOCALAPPDATA%\Programs\YouCineBridge`, and creates a Start Menu shortcut named **YouCine**. It does not pin anything to the taskbar.

If YouCine Bridge is already running, exit it from the tray before reinstalling.

## Use

- Start Menu → **YouCine** starts the bridge or activates the existing instance.
- Tray → **Open YouCine** starts/focuses the managed session.
- Tray → **PiP / Fullscreen** toggles presentation state.
- Tray → **Reconnect** resolves the Android endpoint and recreates the managed session.
- Tray → **Open logs** opens the bridge log directory.
- Tray → **Exit** stops the managed scrcpy window and exits the bridge.

Hotkeys:

- `Ctrl+Alt+P` — PiP/fullscreen.
- `Ctrl+Alt+F` — focus YouCine.
- `Ctrl+Alt+R` — reconnect.
- `F11` — fullscreen/windowed when the YouCine window is focused.

Runtime state lives under `%LOCALAPPDATA%\YouCineBridge`; logs are in its `logs` subdirectory. Installation files live separately under `%LOCALAPPDATA%\Programs\YouCineBridge`.

## Recovery

If the launcher reports missing tools, install Google Platform Tools and scrcpy through WinGet or set explicit paths in the bridge settings. If the Android endpoint changes, **Reconnect** retries deterministic discovery and persists the last successful endpoint.

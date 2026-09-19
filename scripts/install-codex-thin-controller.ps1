$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CodexDir = Join-Path $HOME ".codex"
$AgentsDir = Join-Path $HOME ".agents"
$PersistdSrc = Join-Path $AgentsDir "persistd\src"
$SkillsDir = Join-Path $AgentsDir "skills"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

New-Item -ItemType Directory -Force -Path $CodexDir, $PersistdSrc, $SkillsDir | Out-Null

$HooksPath = Join-Path $CodexDir "hooks.json"
$AgentsPath = Join-Path $CodexDir "AGENTS.md"
if (Test-Path $HooksPath) { Copy-Item $HooksPath "$HooksPath.$Stamp.bak" -Force }
if (Test-Path $AgentsPath) { Copy-Item $AgentsPath "$AgentsPath.$Stamp.bak" -Force }

$RuntimeFiles = @(
    "codex-thin-controller.js",
    "codex-thin-controller-hook.js",
    "codex-thin-controller-supervisor.js",
    "quota-guard.js",
    "handoff.js"
)
foreach ($Name in $RuntimeFiles) {
    Copy-Item (Join-Path $RepoRoot "persistd\src\$Name") (Join-Path $PersistdSrc $Name) -Force
}

Copy-Item (Join-Path $RepoRoot "global\AGENTS.md") $AgentsPath -Force
foreach ($SkillName in @("context-budget-manager", "persistent-conversation-controller")) {
    $Destination = Join-Path $SkillsDir $SkillName
    if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
    Copy-Item (Join-Path $RepoRoot "skills\$SkillName") $Destination -Recurse -Force
}

$NodeExe = (Get-Command node -ErrorAction Stop).Source
$PythonExe = $null
$KnownPython = "C:\Users\Pichau\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if (Test-Path $KnownPython) { $PythonExe = $KnownPython }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $PythonExe = (Get-Command python).Source }
if (-not $PythonExe) { throw "PYTHON_NOT_FOUND_FOR_TOKEN_OPTIMIZER" }

$env:THIN_CONTROLLER_PYTHON = $PythonExe
& $NodeExe (Join-Path $PSScriptRoot "configure-codex-thin-controller.js") | Out-Host
if ($LASTEXITCODE -ne 0) { throw "HOOK_CONFIGURATION_FAILED" }

$Supervisor = Join-Path $PersistdSrc "codex-thin-controller-supervisor.js"
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
$StartupCmd = Join-Path $StartupDir "gabriel-codex-thin-controller.cmd"
$NL = [Environment]::NewLine
$Cmd = "@echo off" + $NL + 'start "" /min "' + $NodeExe + '" "' + $Supervisor + '" --loop --interval-seconds 30' + $NL
[IO.File]::WriteAllText($StartupCmd, $Cmd, [Text.ASCIIEncoding]::new())

$Existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*codex-thin-controller-supervisor.js*--loop*" }
if (-not $Existing) {
    Start-Process -WindowStyle Hidden -FilePath $NodeExe -ArgumentList @($Supervisor, "--loop", "--interval-seconds", "30")
    Start-Sleep -Milliseconds 500
}

$Running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*codex-thin-controller-supervisor.js*--loop*" }

[pscustomobject]@{
    Hooks = $HooksPath
    Runtime = $PersistdSrc
    Startup = $StartupCmd
    SupervisorRunning = [bool]$Running
    SupervisorPid = if ($Running) { ($Running | Select-Object -First 1).ProcessId } else { $null }
} | ConvertTo-Json -Compress

param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedHost,

  [Parameter(Mandatory = $true)]
  [string]$UserProfilePath,

  [string]$AkiVersion = '2.0.4'
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Output ("[AKI-REPAIR] " + $Message)
}

if ($env:COMPUTERNAME -ne $ExpectedHost) {
  throw "Refusing to repair unexpected host: $env:COMPUTERNAME"
}

$env:USERPROFILE = $UserProfilePath
$env:HOME = $UserProfilePath
$env:HOMEDRIVE = [IO.Path]::GetPathRoot($UserProfilePath).TrimEnd('\')
$env:HOMEPATH = $UserProfilePath.Substring($env:HOMEDRIVE.Length)
$env:APPDATA = Join-Path $UserProfilePath 'AppData\Roaming'
$env:LOCALAPPDATA = Join-Path $UserProfilePath 'AppData\Local'
$env:PATH = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\usr\bin;$env:APPDATA\npm;$env:PATH"

$stateDir = Join-Path $UserProfilePath '.aki\mcpsv'
$stateExisted = Test-Path $stateDir
Write-Step ("state_before=" + $stateExisted)

$runtimeRoot = Join-Path $env:LOCALAPPDATA 'ChatGPT\AkiMCP'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$log = Join-Path $runtimeRoot 'akimcp.log'
$watchdog = Join-Path $runtimeRoot 'watchdog.ps1'

$nodeCandidates = @(
  'C:\Program Files\nodejs\node.exe',
  'C:\Program Files (x86)\nodejs\node.exe',
  (Join-Path $UserProfilePath 'AppData\Local\Programs\nodejs\node.exe')
)
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $node) {
  $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCmd) { $node = $nodeCmd.Source }
}
if (-not $node) { throw 'Node.js was not found.' }

$nodeVersion = (& $node --version).Trim()
$nodeMajor = [int](($nodeVersion -replace '^v','').Split('.')[0])
if ($nodeMajor -lt 22) {
  throw "AKIMCP requires Node >=22; found $nodeVersion"
}
Write-Step ("node=" + $nodeVersion)

$npmCandidates = @(
  'C:\Program Files\nodejs\npm.cmd',
  'C:\Program Files (x86)\nodejs\npm.cmd'
)
$npm = $npmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $npm) {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCmd) { $npm = $npmCmd.Source }
}
if (-not $npm) { throw 'npm.cmd was not found.' }

$npmPrefix = Join-Path $env:APPDATA 'npm'
New-Item -ItemType Directory -Force -Path $npmPrefix | Out-Null

Write-Step ("installing @akinet/akimcp@" + $AkiVersion)
& $npm install -g --prefix $npmPrefix ("@akinet/akimcp@" + $AkiVersion) --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed with exit code $LASTEXITCODE"
}

$aki = Join-Path $npmPrefix 'akimcp.cmd'
if (-not (Test-Path $aki)) {
  throw "AKIMCP launcher missing after install: $aki"
}

$old = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -ieq 'node.exe' -and
  $_.CommandLine -and
  $_.CommandLine -match '(?i)(@akinet[\\/]+akimcp|aki-mcp-sv|scripts[\\/]+start\.js)'
})
foreach ($process in $old) {
  Write-Step ("stopping_old_pid=" + $process.ProcessId)
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$watchdogTemplate = @'
$ErrorActionPreference = 'Continue'
$env:USERPROFILE = '__PROFILE__'
$env:HOME = '__PROFILE__'
$env:HOMEDRIVE = '__HOMEDRIVE__'
$env:HOMEPATH = '__HOMEPATH__'
$env:APPDATA = '__APPDATA__'
$env:LOCALAPPDATA = '__LOCALAPPDATA__'
$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\usr\bin;__NPM_PREFIX__;' + $env:PATH

$aki = '__AKI__'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root 'akimcp.log'

function Log([string]$Message) {
  try {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 10485760) {
      $old = Join-Path $root 'akimcp.1.log'
      Remove-Item $old -Force -ErrorAction SilentlyContinue
      Move-Item $log $old -Force
    }
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message) -Encoding UTF8
  } catch {}
}

while ($true) {
  try {
    $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -ieq 'node.exe' -and
      $_.CommandLine -and
      $_.CommandLine -match '(?i)(@akinet[\\/]+akimcp|aki-mcp-sv|scripts[\\/]+start\.js)'
    })

    if ($running) {
      Start-Sleep -Seconds 15
      continue
    }

    if (-not (Test-Path $aki)) {
      Log "launcher missing: $aki"
      Start-Sleep -Seconds 30
      continue
    }

    Log 'starting AKIMCP'
    & $aki --no-browser *>> $log
    Log ("AKIMCP exited code={0}; restarting in 10 seconds" -f $LASTEXITCODE)
  } catch {
    Log ("watchdog error: {0}" -f $_.Exception.Message)
  }

  Start-Sleep -Seconds 10
}
'@

$watchdogBody = $watchdogTemplate.
  Replace('__PROFILE__', $UserProfilePath).
  Replace('__HOMEDRIVE__', $env:HOMEDRIVE).
  Replace('__HOMEPATH__', $env:HOMEPATH).
  Replace('__APPDATA__', $env:APPDATA).
  Replace('__LOCALAPPDATA__', $env:LOCALAPPDATA).
  Replace('__NPM_PREFIX__', $npmPrefix).
  Replace('__AKI__', $aki)

Set-Content -Path $watchdog -Value $watchdogBody -Encoding UTF8
Write-Step ("watchdog=" + $watchdog)

$taskName = 'AKI MCP'
$taskMode = $null
$taskArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdog`""

try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
  $triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -AtLogOn -User (Split-Path $UserProfilePath -Leaf))
  )
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  $definition = New-ScheduledTask -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Keeps AKIMCP online after exit or reboot.'
  Register-ScheduledTask -TaskName $taskName -InputObject $definition -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  $taskMode = 'SYSTEM'
  Write-Step 'scheduled_task=SYSTEM'
} catch {
  Write-Step ("system_task_unavailable=" + $_.Exception.Message)
  $taskName = 'AKI MCP User'
  try {
    $username = Split-Path $UserProfilePath -Leaf
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $username
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$username" -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    $definition = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keeps AKIMCP online in the interactive user session.'
    Register-ScheduledTask -TaskName $taskName -InputObject $definition -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $taskMode = 'USER'
    Write-Step 'scheduled_task=USER'
  } catch {
    Write-Step ("user_task_unavailable=" + $_.Exception.Message)
    $taskMode = 'PROCESS_ONLY'
  }
}

Start-Sleep -Seconds 3
$watchdogRunning = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -ieq 'powershell.exe' -and
  $_.CommandLine -and
  $_.CommandLine -like "*$watchdog*"
})
if (-not $watchdogRunning) {
  Write-Step 'starting_watchdog_directly'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $taskArgs -WindowStyle Hidden
}

$ready = $false
for ($i = 0; $i -lt 24; $i++) {
  Start-Sleep -Seconds 3

  $port9998 = [bool](Get-NetTCPConnection -LocalPort 9998 -State Listen -ErrorAction SilentlyContinue)
  $port9999 = [bool](Get-NetTCPConnection -LocalPort 9999 -State Listen -ErrorAction SilentlyContinue)
  $process = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -ieq 'node.exe' -and
    $_.CommandLine -and
    $_.CommandLine -match '(?i)(@akinet[\\/]+akimcp|aki-mcp-sv|scripts[\\/]+start\.js)'
  } | Select-Object -First 1

  if ($port9998 -and $port9999 -and $process) {
    $ready = $true
    break
  }
}

if (-not $ready) {
  if (Test-Path $log) {
    Write-Output '--- AKIMCP LOG TAIL ---'
    Get-Content $log -Tail 80 -ErrorAction SilentlyContinue
  }
  throw 'AKIMCP did not become ready on ports 9998/9999.'
}

if (-not (Test-Path $stateDir)) {
  throw 'AKIMCP state directory is missing after repair.'
}

if ($taskMode -ne 'PROCESS_ONLY' -and -not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  throw 'Scheduled persistence task was not found after registration.'
}

Write-Output ("AKI_REPAIR_OK host={0} version={1} pid={2} port9998=true port9999=true persistence={3} state_preserved={4}" -f $env:COMPUTERNAME,$AkiVersion,$process.ProcessId,$taskMode,$stateExisted)

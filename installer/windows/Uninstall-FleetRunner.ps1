[CmdletBinding()]
param([string]$InstallDir = '',[switch]$SkipTask)
$ErrorActionPreference='Stop'
if (-not $InstallDir) { $InstallDir=Join-Path $env:LOCALAPPDATA 'GabrielFleetRunner' }
$cfg=Join-Path $InstallDir 'agent\worker-config.json'
if (-not (Test-Path -LiteralPath $cfg)) { throw 'RUNNER_NOT_FOUND' }
$data=Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json
if ($data.nodeId -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { throw 'NODE_ID_INVALID' }
$taskName='Gabriel Fleet - ' + $data.nodeId
if (-not $SkipTask) {
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}
Write-Output 'RUNNER_UNREGISTERED=TRUE'
Write-Output 'LOCAL_SECRET_AND_PENDING_JOBS_PRESERVED=TRUE'
Write-Output ('INSTALL_DIR=' + $InstallDir)
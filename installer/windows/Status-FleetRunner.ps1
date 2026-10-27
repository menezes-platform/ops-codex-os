[CmdletBinding()]
param([string]$InstallDir = '',[switch]$CheckOnline)
$ErrorActionPreference='Stop'
if (-not $InstallDir) { $InstallDir=Join-Path $env:LOCALAPPDATA 'GabrielFleetRunner' }
$cfg=Join-Path $InstallDir 'agent\worker-config.json'
if (-not (Test-Path -LiteralPath $cfg)) { throw 'RUNNER_NOT_FOUND' }
$data=Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json
$secret=Join-Path $InstallDir 'node-secret.txt'
Write-Output ('NODE_ID='+$data.nodeId)
Write-Output ('SECRET_PRESENT_AND_VALID='+[bool]((Test-Path $secret) -and ([IO.File]::ReadAllText($secret).Trim() -match '^[a-fA-F0-9]{64}$')))
$task=Get-ScheduledTask -TaskName ('Gabriel Fleet - ' + $data.nodeId) -ErrorAction SilentlyContinue
Write-Output ('SCHEDULED_TASK_STATE='+$(if($task){$task.State}else{'NOT_INSTALLED'}))
Write-Output ('DRIVE_STORE_CONFIG_LOCAL='+ (Test-Path (Join-Path $InstallDir 'agent\worker-config.json')))
if ($CheckOnline) {
  $nodePath=[IO.File]::ReadAllText((Join-Path $InstallDir 'agent\node-path.txt')).Trim()
  & $nodePath (Join-Path $InstallDir 'agent\verify-enrollment.js')
  if ($LASTEXITCODE -ne 0) { throw 'HEARTBEAT_VERIFICATION_FAILED' }
}
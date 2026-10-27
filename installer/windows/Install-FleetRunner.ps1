[CmdletBinding()]
param(
  [string]$NodeId = '',
  [string]$BaseUrl = 'https://darkslategrey-raccoon-448222.hostingersite.com',
  [string]$InstallDir = '',
  [switch]$SkipTask,
  [switch]$SkipPairing
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'GabrielFleetRunner' }
if (-not $NodeId) { $NodeId = 'node-' + ($env:COMPUTERNAME.ToLowerInvariant() -replace '[^a-z0-9-]','-') }
if ($NodeId -cnotmatch '^[a-z0-9][a-z0-9-]{0,63}$') { throw 'NODE_ID_INVALID' }
try { $u = [uri]$BaseUrl } catch { throw 'AUTHORITY_URL_INVALID' }
if ($u.Scheme -ne 'https' -or $u.AbsolutePath -ne '/' -or $u.Query -or $u.Fragment -or $u.UserInfo -or -not $u.Host) { throw 'AUTHORITY_URL_INVALID' }
$BaseUrl = $u.GetLeftPart([System.UriPartial]::Authority)
if (-not [System.IO.Path]::IsPathRooted($InstallDir)) { throw 'INSTALL_DIR_MUST_BE_ABSOLUTE' }
if ($InstallDir -eq [System.IO.Path]::GetPathRoot($InstallDir)) { throw 'INSTALL_DIR_ROOT_FORBIDDEN' }
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$NodeVersion = (& $NodeExe -v)
if ($LASTEXITCODE -ne 0 -or $NodeVersion -notmatch '^v(22|23|24)\.') { throw 'NODE_22_TO_24_REQUIRED' }
# Bundled release copies the dependency-free agent and storage source into payload/.
$srcAgent = Join-Path $PSScriptRoot 'agent'
$srcStorage = Join-Path $PSScriptRoot 'storage'
if (-not (Test-Path (Join-Path $srcAgent 'node-agent.js'))) {
  $repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $srcAgent = Join-Path $repo 'persistd\src\fleet'
  $srcStorage = Join-Path $repo 'persistd\src\storage'
}
$srcInstaller = $PSScriptRoot
$installFiles = @('node-agent.js','auth.js','contracts.js','silent-job.js','silent-job-cli.js','silent-job-launcher.vbs','drive-job-archive.js','worker-drive-access.js')
foreach ($n in $installFiles) { if (-not (Test-Path (Join-Path $srcAgent $n))) { throw ('INSTALL_PAYLOAD_MISSING_' + $n) } }
foreach ($n in @('drive-client.js','object-store.js')) { if (-not (Test-Path (Join-Path $srcStorage $n))) { throw ('INSTALL_PAYLOAD_MISSING_' + $n) } }
foreach ($n in @('agent-bootstrap.js','heartbeat-launcher.vbs','verify-enrollment.js','Uninstall-FleetRunner.ps1','Status-FleetRunner.ps1','Pair-FleetRunner.ps1')) {
  if (-not (Test-Path (Join-Path $srcInstaller $n))) { throw ('INSTALL_PAYLOAD_MISSING_' + $n) }
}
$cfgPath = Join-Path $InstallDir 'agent\worker-config.json'
$secretPath = Join-Path $InstallDir 'node-secret.txt'
if (Test-Path -LiteralPath $cfgPath) {
  $oldCfg = (Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json)
  if ($oldCfg.nodeId -cne $NodeId) { throw 'NODE_ID_CONFLICT' }
  if ($oldCfg.baseUrl -cne $BaseUrl) { throw 'AUTHORITY_URL_CONFLICT' }
}
if (Test-Path -LiteralPath $secretPath) {
  $existing = [System.IO.File]::ReadAllText($secretPath).Trim()
  if ($existing -cnotmatch '^[a-fA-F0-9]{64}$') { throw 'EXISTING_SECRET_INVALID' }
}
$destAgent = Join-Path $InstallDir 'agent'
$destStorage = Join-Path $InstallDir 'storage'
$maintenance = Join-Path $InstallDir 'maintenance'
foreach ($d in @($destAgent,$destStorage,$maintenance,(Join-Path $InstallDir 'jobs\requests'),(Join-Path $InstallDir 'jobs\workspaces'),(Join-Path $InstallDir 'jobs\logs'))) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
if (-not (Test-Path -LiteralPath $secretPath)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $hex = [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
  [System.IO.File]::WriteAllText($secretPath,$hex,[System.Text.Encoding]::ASCII)
}
# Fail closed if ACL cannot be restricted to the installing user and SYSTEM.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $secretPath /inheritance:r /grant:r ('*' + $sid + ':(F)') '*S-1-5-18:(F)' 1>$null
if ($LASTEXITCODE -ne 0) { throw 'SECRET_ACL_FAILED' }
foreach ($n in $installFiles) { Copy-Item -LiteralPath (Join-Path $srcAgent $n) -Destination (Join-Path $destAgent $n) -Force }
foreach ($n in @('drive-client.js','object-store.js')) { Copy-Item -LiteralPath (Join-Path $srcStorage $n) -Destination (Join-Path $destStorage $n) -Force }
foreach ($n in @('agent-bootstrap.js','heartbeat-launcher.vbs','verify-enrollment.js')) { Copy-Item -LiteralPath (Join-Path $srcInstaller $n) -Destination (Join-Path $destAgent $n) -Force }
foreach ($n in @('Uninstall-FleetRunner.ps1','Status-FleetRunner.ps1','Pair-FleetRunner.ps1')) { Copy-Item -LiteralPath (Join-Path $srcInstaller $n) -Destination (Join-Path $maintenance $n) -Force }
[System.IO.File]::WriteAllText((Join-Path $destAgent 'node-path.txt'),$NodeExe,[System.Text.Encoding]::UTF8)
$config = @{ nodeId=$NodeId; baseUrl=$BaseUrl } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($cfgPath,$config,(New-Object System.Text.UTF8Encoding($false)))
foreach ($script in @('node-agent.js','agent-bootstrap.js','silent-job-cli.js','verify-enrollment.js')) {
  & $NodeExe --check (Join-Path $destAgent $script) 1>$null
  if ($LASTEXITCODE -ne 0) { throw ('INSTALLED_JS_INVALID_' + $script) }
}
$taskName = 'Gabriel Fleet - ' + $NodeId
if (-not $SkipTask) {
  $vbs = Join-Path $destAgent 'heartbeat-launcher.vbs'
  $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('//B //Nologo "' + $vbs + '"')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output 'TASK_CREATED=TRUE'
} else {
  Write-Output 'TASK_CREATED=FALSE'
}
if (-not $SkipPairing -and -not $SkipTask) {
  Write-Output 'PAIRING=REQUEST_INVITATION_FROM_OWNER'
  try { & (Join-Path $maintenance 'Pair-FleetRunner.ps1') -InstallDir $InstallDir }
  catch { Write-Output ('PAIRING_STATUS=PENDING: ' + $_.Exception.Message) }
}
Write-Output ('NODE_ID=' + $NodeId)
Write-Output ('INSTALL_DIR=' + $InstallDir)
if($SkipTask -or $SkipPairing){Write-Output 'PAIRING_STATUS=PENDING_OWNER_INVITATION'}
Write-Output ('ENROLLMENT_SECRET_FILE=' + $secretPath)
Write-Output 'NEXT=Pair with an owner-issued one-time invitation. Registration persists on authority automatically as drained=true.'
Write-Output 'DRIVE_POLICY=FAIL_CLOSED_UNTIL_AUTHORITY_OBJECT_STORE_READY'
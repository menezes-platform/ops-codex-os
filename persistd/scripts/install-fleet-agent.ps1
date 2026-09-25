param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$NodeId,
  [Parameter(Mandatory = $true)][string]$PersistFlowBaseUrl
)

$ErrorActionPreference = 'Stop'
if (-not $env:PERSISTFLOW_FLEET_NODE_SECRET) {
  throw 'PERSISTFLOW_FLEET_NODE_SECRET must already exist in the task user environment.'
}

[Environment]::SetEnvironmentVariable('PERSISTFLOW_FLEET_NODE_ID', $NodeId, 'User')
[Environment]::SetEnvironmentVariable('PERSISTFLOW_BASE_URL', $PersistFlowBaseUrl, 'User')

$node = (Get-Command node -ErrorAction Stop).Source
$agent = Join-Path $RepoRoot 'persistd\src\fleet\node-agent.js'
if (-not (Test-Path $agent)) { throw "Fleet agent not found: $agent" }

$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $agent + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Gabriel Fleet Agent' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'Gabriel Fleet Agent'
Write-Output 'Gabriel Fleet Agent installed and started.'

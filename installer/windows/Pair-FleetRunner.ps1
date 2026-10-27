[CmdletBinding()]
param([string]$InstallDir = '', [SecureString]$PairingCode)
$ErrorActionPreference='Stop'
if(-not $InstallDir){$InstallDir=Join-Path $env:LOCALAPPDATA 'GabrielFleetRunner'}
$config=Join-Path $InstallDir 'agent\worker-config.json'
$secretPath=Join-Path $InstallDir 'node-secret.txt'
if(-not(Test-Path $config) -or -not(Test-Path $secretPath)){throw 'RUNNER_NOT_FOUND'}
$data=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
$base=[Uri]$data.baseUrl
if($base.Scheme -ne 'https' -or $base.AbsolutePath -ne '/' -or $base.UserInfo){throw 'PAIRING_HTTPS_REQUIRED'}
if(-not $PairingCode){$PairingCode=Read-Host 'Cole o convite de uso unico gerado pelo administrador (Enter para cancelar)' -AsSecureString}
if(-not $PairingCode -or $PairingCode.Length -eq 0){Write-Output 'PAIRING_STATUS=PENDING_INVITATION';exit 0}
$ptr=[IntPtr]::Zero
try{
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($PairingCode)
 $code=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if([string]::IsNullOrWhiteSpace($code)){Write-Output 'PAIRING_STATUS=PENDING_INVITATION';exit 0}
 $secret=[IO.File]::ReadAllText($secretPath).Trim()
 if($secret -notmatch '^[0-9a-fA-F]{64}$'){throw 'NODE_SECRET_INVALID'}
 $json=@{pairingCode=$code;nodeId=$data.nodeId;secret=$secret} | ConvertTo-Json -Compress
 $uri=$base.GetLeftPart([System.UriPartial]::Authority)+'/v1/fleet/enroll'
 $result=Invoke-RestMethod -UseBasicParsing -Method POST -Uri $uri -Body $json -ContentType 'application/json' -TimeoutSec 20
 if($result.registered -ne $true -or $result.drained -ne $true){throw 'PAIRING_RESPONSE_INVALID'}
 Write-Output 'PAIRING_STATUS=REGISTERED_DRAINED'
 Write-Output ('NODE_ID='+$data.nodeId)
 Write-Output 'NEXT=Use Status-FleetRunner.ps1 -CheckOnline to verify HMAC heartbeat.'
}finally{
 if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
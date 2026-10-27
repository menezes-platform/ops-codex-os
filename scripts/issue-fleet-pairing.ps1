[CmdletBinding()]
param([string]$BaseUrl='https://darkslategrey-raccoon-448222.hostingersite.com')
$ErrorActionPreference='Stop'
$u=[Uri]$BaseUrl
if($u.Scheme -ne 'https' -or $u.AbsolutePath -ne '/' -or $u.UserInfo){throw 'PAIRING_HTTPS_REQUIRED'}
$owner=Read-Host 'Informe o token administrativo do PersistFlow (nao e o segredo de um no)' -AsSecureString
$p=[IntPtr]::Zero
try{
 $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($owner)
 $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)
 $res=Invoke-RestMethod -UseBasicParsing -Method POST -Uri ($u.GetLeftPart([System.UriPartial]::Authority)+'/v1/fleet/pairing-invitations') -ContentType 'application/json' -Body '{}' -Headers @{Authorization=('Bearer '+$token)} -TimeoutSec 20
 Write-Output ('VALID_UNTIL='+$res.expiresAt)
 Write-Output ('ONE_TIME_PAIRING_CODE='+$res.pairingCode)
 Write-Output 'Use este codigo apenas no instalador da maquina pretendida. Nao salve o codigo em scripts, GitHub ou chat.'
}finally{if($p -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}}
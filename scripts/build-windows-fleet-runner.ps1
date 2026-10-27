[CmdletBinding()]
param([string]$OutputDir = '')
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDir) { $OutputDir=Join-Path $repo 'dist\fleet-runner-windows' }
$work=Join-Path $env:TEMP ('fleet-installer-build-'+[Guid]::NewGuid().ToString('N'))
$payload=Join-Path $work 'payload'
$agent=Join-Path $payload 'agent'
$storage=Join-Path $payload 'storage'
$installer=Join-Path $repo 'installer\windows'
New-Item -ItemType Directory -Force -Path $agent,$storage,$OutputDir | Out-Null
try {
 foreach($name in @('Install-FleetRunner.ps1','Uninstall-FleetRunner.ps1','Status-FleetRunner.ps1','Pair-FleetRunner.ps1','agent-bootstrap.js','heartbeat-launcher.vbs','verify-enrollment.js')) {
  Copy-Item -LiteralPath (Join-Path $installer $name) -Destination $payload -ErrorAction Stop
 }
 foreach($name in @('node-agent.js','auth.js','contracts.js','silent-job.js','silent-job-cli.js','silent-job-launcher.vbs','drive-job-archive.js','worker-drive-access.js')) {
  Copy-Item -LiteralPath (Join-Path $repo ('persistd\src\fleet\'+$name)) -Destination $agent -ErrorAction Stop
 }
 foreach($name in @('drive-client.js','object-store.js')) {
  Copy-Item -LiteralPath (Join-Path $repo ('persistd\src\storage\'+$name)) -Destination $storage -ErrorAction Stop
 }
 $bundle=Join-Path $work 'fleet-bundle.zip'
 Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $payload | ForEach-Object {$_.FullName}) -DestinationPath $bundle -CompressionLevel Optimal
 $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
 if(-not(Test-Path $compiler)){throw 'WINDOWS_CSHARP_COMPILER_MISSING'}
 $exe=Join-Path $OutputDir 'GabrielFleetRunnerSetup.exe'
 $argList=@('/nologo','/target:exe','/platform:anycpu',('/out:'+ $exe),('/resource:'+ $bundle+',fleet_bundle'),'/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',(Join-Path $installer 'Setup.cs'))
 & $compiler @argList
 if($LASTEXITCODE -ne 0){throw 'EXE_COMPILATION_FAILED'}
 $readme=Join-Path $repo 'installer\windows\README.md'
 Copy-Item -LiteralPath $readme -Destination (Join-Path $OutputDir 'README.md') -Force
 $checksum=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
 [IO.File]::WriteAllText((Join-Path $OutputDir 'SHA256.txt'),$checksum+'  GabrielFleetRunnerSetup.exe'+"`n",(New-Object System.Text.UTF8Encoding($false)))
 $release=Join-Path (Split-Path $OutputDir -Parent) 'GabrielFleetRunner-Windows.zip'
 if(Test-Path $release){Remove-Item -LiteralPath $release -Force}
 Compress-Archive -LiteralPath (Get-ChildItem $OutputDir -File | ForEach-Object {$_.FullName}) -DestinationPath $release -CompressionLevel Optimal
 Write-Output ('EXE='+$exe)
 Write-Output ('ZIP='+$release)
 Write-Output ('SHA256='+$checksum)
} finally {
 if(Test-Path $work){Remove-Item -LiteralPath $work -Recurse -Force}
}
param([Parameter(Mandatory=$true)][string]$DevOrquestraRoot)
$ErrorActionPreference='Stop'
$project=Join-Path $DevOrquestraRoot 'windows-desktop\tests\Orquestra.Desktop.Tests'
$assembly=Join-Path $project 'bin\Release\net10.0-windows10.0.19041.0\Orquestra.Desktop.Tests.dll'
if (-not (Test-Path -LiteralPath $assembly -PathType Leaf)) { throw 'Build the canonical Desktop tests in Release first.' }
$priorUrl=$env:ORQUESTRA_TEST_OBSERVATION_URL
$priorToken=$env:ORQUESTRA_TEST_OBSERVATION_TOKEN
$bytes=New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$testToken=[Convert]::ToHexString($bytes)
$start=[Diagnostics.ProcessStartInfo]::new((Get-Command dotnet).Source)
$start.UseShellExecute=$false
$start.CreateNoWindow=$true
$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.RedirectStandardOutput=$true
$start.RedirectStandardError=$true
$start.ArgumentList.Add($assembly)
$start.ArgumentList.Add('observation-live-host')
$start.Environment['ORQUESTRA_TEST_OBSERVATION_TOKEN']=$testToken
$process=[Diagnostics.Process]::Start($start)
try {
  $deadline=[DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    $line=$process.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult()
    if ($null -eq $line -or $line -eq 'DESKTOP_HOST_UNAVAILABLE') { throw 'DESKTOP_HOST_UNAVAILABLE: real interactive session was not verified.' }
    if ($line.StartsWith('OBSERVATION_TEST_URL=')) {
      $env:ORQUESTRA_TEST_OBSERVATION_URL=$line.Substring('OBSERVATION_TEST_URL='.Length)
      break
    }
  }
  if (-not $env:ORQUESTRA_TEST_OBSERVATION_URL) { throw 'Host readiness timeout.' }
  $env:ORQUESTRA_TEST_OBSERVATION_TOKEN=$testToken
  $testFile=Join-Path $PSScriptRoot '..\desktop-observation-http.test.js'
  & node --test $testFile
  if ($LASTEXITCODE -ne 0) { throw 'Live MCP observation integration failed.' }
}
finally {
  if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
  $process.Dispose()
  $env:ORQUESTRA_TEST_OBSERVATION_URL=$priorUrl
  $env:ORQUESTRA_TEST_OBSERVATION_TOKEN=$priorToken
  $testToken=$null
}

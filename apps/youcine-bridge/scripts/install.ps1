[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$RuntimeIdentifier = 'win-x64'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $projectRoot 'src\YouCineBridge\YouCineBridge.csproj'
$publishDir = Join-Path $projectRoot "publish\$RuntimeIdentifier"
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\YouCineBridge'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shortcutPath = Join-Path $startMenuDir 'YouCine.lnk'
$targetExe = Join-Path $installDir 'YouCineBridge.exe'

if (Get-Process -Name 'YouCineBridge' -ErrorAction SilentlyContinue) {
    throw 'YouCine Bridge is running. Exit it from the tray, then run the installer again.'
}

if (Test-Path $publishDir) {
    Remove-Item $publishDir -Recurse -Force
}

& dotnet publish $projectPath -c $Configuration -r $RuntimeIdentifier -p:SelfContained=false -o $publishDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$publishedExe = Join-Path $publishDir 'YouCineBridge.exe'
if (-not (Test-Path $publishedExe)) {
    throw "Published executable was not created at $publishedExe."
}

if (Test-Path $installDir) {
    Remove-Item $installDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item (Join-Path $publishDir '*') $installDir -Recurse -Force

New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = "$targetExe,0"
$shortcut.Description = 'Open YouCine through YouCine Bridge'
$shortcut.Save()

[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wsh)

Write-Host "Installed YouCine Bridge to: $installDir"
Write-Host "Created Start Menu shortcut: $shortcutPath"
Write-Host 'No taskbar pin was modified.'

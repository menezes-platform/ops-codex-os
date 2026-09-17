$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CodexDir = Join-Path $HOME ".codex"
$AgentsDir = Join-Path $HOME ".agents"
$SkillsDir = Join-Path $AgentsDir "skills"
$PersistdDir = Join-Path $AgentsDir "persistd"
$VendorDir = Join-Path $AgentsDir "vendor"

New-Item -ItemType Directory -Force -Path $CodexDir | Out-Null
New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null

Copy-Item (Join-Path $RepoRoot "global\AGENTS.md") (Join-Path $CodexDir "AGENTS.md") -Force

$SourceSkills = Join-Path $RepoRoot "skills\*"
Copy-Item $SourceSkills $SkillsDir -Recurse -Force

$PersistdSource = Join-Path $RepoRoot "persistd"
if (Test-Path (Join-Path $PersistdSource "package.json")) {
    New-Item -ItemType Directory -Force -Path $PersistdDir | Out-Null
    Copy-Item (Join-Path $PersistdSource "*") $PersistdDir -Recurse -Force
}

$VendorRepos = @(
    @{ Name = "awesome-harness-engineering"; Url = "https://github.com/ai-boost/awesome-harness-engineering.git" },
    @{ Name = "claude-skills"; Url = "https://github.com/alirezarezvani/claude-skills.git" },
    @{ Name = "agentmemory"; Url = "https://github.com/rohitg00/agentmemory.git" },
    @{ Name = "andrej-karpathy-skills"; Url = "https://github.com/multica-ai/andrej-karpathy-skills.git" },
    @{ Name = "ponytail"; Url = "https://github.com/DietrichGebert/ponytail.git" },
    @{ Name = "tencentdb-agent-memory"; Url = "https://github.com/TencentCloud/TencentDB-Agent-Memory.git" },
    @{ Name = "ego-lite"; Url = "https://github.com/citrolabs/ego-lite.git" },
    @{ Name = "design-agent-skills"; Url = "https://github.com/podo/design-agent-skills.git" },
    @{ Name = "motion-primitives"; Url = "https://github.com/ibelick/motion-primitives.git" },
    @{ Name = "watermelon-platform"; Url = "https://github.com/WatermelonCorp/watermelon-platform.git" },
    @{ Name = "fontsource"; Url = "https://github.com/fontsource/fontsource.git" },
    @{ Name = "OpenManus"; Url = "https://github.com/FoundationAgents/OpenManus.git" },
    @{ Name = "skill-manus"; Url = "https://github.com/reubenjohn/skill-manus.git" },
    @{ Name = "pr-agent"; Url = "https://github.com/The-PR-Agent/pr-agent.git" },
    @{ Name = "reviewdog"; Url = "https://github.com/reviewdog/reviewdog.git" },
    @{ Name = "OpenReviewer"; Url = "https://github.com/Ascent-AI-org/OpenReviewer.git" }
)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Warning "Git is not available; skipping vendor toolkit sync."
} else {
    foreach ($Repo in $VendorRepos) {
        $Destination = Join-Path $VendorDir $Repo.Name
        if (Test-Path (Join-Path $Destination ".git")) {
            Write-Host "Updating vendor reference: $($Repo.Name)"
            git -C $Destination fetch --depth 1 origin | Out-Host
            git -C $Destination reset --hard origin/HEAD | Out-Host
        } elseif (Test-Path $Destination) {
            Write-Warning "Skipping $($Repo.Name): destination exists but is not a Git repository: $Destination"
        } else {
            Write-Host "Installing vendor reference: $($Repo.Name)"
            git clone --depth 1 --filter=blob:none $Repo.Url $Destination | Out-Host
        }
    }
}

$EgoWindowsDir = Join-Path $VendorDir "ego-lite-windows-hardened"
$EgoWindowsUrl = "https://github.com/menezes-platform/tool-ego-lite.git"
$EgoWindowsBranch = "feat/windows-host-state-hardening"
$EgoWindowsCommit = "8ef136f5d263b374f4071ea664dd232b42e54929"
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    if (Test-Path (Join-Path $EgoWindowsDir ".git")) {
        Write-Host "Updating hardened Windows ego host"
        git -C $EgoWindowsDir fetch --depth 1 origin $EgoWindowsBranch | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "EGO_WINDOWS_FETCH_FAILED" }
        git -C $EgoWindowsDir reset --hard $EgoWindowsCommit | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "EGO_WINDOWS_RESET_FAILED" }
    } elseif (Test-Path $EgoWindowsDir) { throw "EGO_WINDOWS_DESTINATION_NOT_GIT: $EgoWindowsDir" }
    else {
        git clone --depth 1 --branch $EgoWindowsBranch --single-branch $EgoWindowsUrl $EgoWindowsDir | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "EGO_WINDOWS_CLONE_FAILED" }
        git -C $EgoWindowsDir reset --hard $EgoWindowsCommit | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "EGO_WINDOWS_PIN_FAILED" }
    }
    $EgoBrowserDir = Join-Path $EgoWindowsDir "package\ego-browser"
    $EgoHostDir = Join-Path $EgoWindowsDir "package\ego-windows-host"
    npm --prefix $EgoBrowserDir install --ignore-scripts | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "EGO_BROWSER_INSTALL_FAILED" }
    npm --prefix $EgoBrowserDir run build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "EGO_BROWSER_BUILD_FAILED" }
    npm --prefix $EgoHostDir install --ignore-scripts | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "EGO_WINDOWS_HOST_INSTALL_FAILED" }
    npm --prefix $EgoHostDir test | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "EGO_WINDOWS_HOST_TEST_FAILED" }
    $NodeExe = (Get-Command node -ErrorAction Stop).Source
    $NpmBinDir = Join-Path $env:APPDATA "npm"
    New-Item -ItemType Directory -Force -Path $NpmBinDir | Out-Null
    $EgoShim = Join-Path $NpmBinDir "ego-browser.cmd"
    $EgoEntry = Join-Path $EgoHostDir "bin\ego-windows-host.mjs"
    $ShimContent = "@echo off" + [Environment]::NewLine + "`"$NodeExe`" `"$EgoEntry`" %*" + [Environment]::NewLine
    [IO.File]::WriteAllText($EgoShim, $ShimContent, [Text.ASCIIEncoding]::new())
    Write-Host "Installed hardened ego-browser.cmd to $EgoShim"
} else { Write-Warning "Git or npm is unavailable; hardened Windows ego host was not installed." }

Write-Host "Installed global AGENTS.md to $CodexDir"
Write-Host "Installed skills to $SkillsDir"
Write-Host "Installed versioned persistd runtime to $PersistdDir"
Write-Host "Synced reuse-first vendor toolkit to $VendorDir"
Write-Host "Vendor repositories are references/candidate sources; they are not automatically loaded into every prompt."
Write-Host "Haikei remains a web/reference-only router option until a verified official Git repository exists."
Write-Host "Start a new Codex session to load updates."

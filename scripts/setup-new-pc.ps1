# First-time setup of ConsentLedger on a new Windows 10/11 PC.
# Double-click setup-new-pc.cmd. Safe to run again: it skips what is done.
#
#   1. checks disk space
#   2. installs WSL with Ubuntu 22.04 (needs a restart the first time)
#   3. installs Docker Desktop and Node.js with winget
#   4. installs the web app's packages
#   5. runs setup-wsl.sh inside Ubuntu: Go, Fabric, the network, the
#      chaincode and the database
# Afterwards, start everything with start-consentledger.cmd.
$ErrorActionPreference = 'Continue'

$Distro = 'Ubuntu-22.04'
$DockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$Repo = Split-Path -Parent $PSScriptRoot
$WebDir = Join-Path $Repo 'web'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Stop-Here($text) {
    Write-Host "`n   $text" -ForegroundColor Yellow
    Read-Host "`nPress Enter to close"
    exit 1
}
function Test-Docker {
    & docker info --format '{{.ServerVersion}}' *> $null
    return $LASTEXITCODE -eq 0
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [Environment]::GetEnvironmentVariable('Path', 'User')
}

Write-Host 'Setting up ConsentLedger on this PC...' -ForegroundColor White

# 1. Disk space ------------------------------------------------------------
Step 'Checking disk space'
$free = [math]::Round((Get-Volume -DriveLetter C).SizeRemaining / 1GB, 1)
if ($free -lt 30) {
    Stop-Here "Only $free GB free on C:. The setup needs about 30 GB (Docker, Ubuntu, Fabric images). Free some space and run this again."
}
Ok "$free GB free on C:"

# 2. WSL and Ubuntu --------------------------------------------------------
Step "Checking WSL and $Distro"
$distros = (& wsl.exe -l -q 2>$null) -replace "`0", '' | Where-Object { $_.Trim() }
if (-not ($distros -contains $Distro)) {
    Write-Host '   Installing WSL and Ubuntu 22.04. Windows will ask for administrator permission.'
    Start-Process wsl.exe -ArgumentList "--install -d $Distro" -Verb RunAs -Wait
    Stop-Here ("Restart the PC now. After the restart an Ubuntu window opens and asks you to create a " +
        "Linux username and password (any you like; remember the password). Then run setup-new-pc.cmd again.")
}
$probe = & wsl.exe -d $Distro -- echo ready 2>$null
if ("$probe".Trim() -ne 'ready') {
    Stop-Here "Ubuntu is installed but not set up yet. Open 'Ubuntu 22.04' from the Start menu, create your Linux username and password, close it, then run this again."
}
Ok "$Distro is ready"

# 3. Docker Desktop and Node.js --------------------------------------------
Step 'Checking Docker Desktop and Node.js'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Stop-Here 'winget is missing. Install "App Installer" from the Microsoft Store, then run this again.'
}
if (-not (Test-Path $DockerDesktop)) {
    Write-Host '   Installing Docker Desktop (large download)...'
    & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    Stop-Here ("Docker Desktop is installed. Restart the PC, open Docker Desktop and accept its terms, then in " +
        "Settings > Resources > WSL integration turn on Ubuntu-22.04 and click Apply & restart. Then run this again.")
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '   Installing Node.js LTS...'
    & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-Here 'Node.js was installed but this window cannot see it yet. Close this window and run setup-new-pc.cmd again.'
}
Ok "Node.js $(& node --version)"
if (-not (Test-Docker)) {
    Write-Host '   Starting Docker Desktop...'
    Start-Process $DockerDesktop
    for ($i = 0; $i -lt 60 -and -not (Test-Docker); $i++) { Start-Sleep -Seconds 5 }
    if (-not (Test-Docker)) { Stop-Here 'Docker did not start. Open Docker Desktop, finish any first-run steps, then run this again.' }
}
Ok 'Docker is running'

# 4. Web app packages ------------------------------------------------------
Step 'Installing the web app packages'
Push-Location $WebDir
& npm ci --no-audit --no-fund
$npmOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $npmOk) { Stop-Here 'npm could not install the web app packages; see the messages above.' }
Ok 'Web app packages installed'

# 5. Inside Ubuntu ---------------------------------------------------------
Step 'Setting up Fabric, the chaincode and the database inside Ubuntu (20-40 minutes)'
$RepoWsl = "$(& wsl.exe -d $Distro -- wslpath -a ($Repo -replace '\\', '/'))".Trim()
& wsl.exe -d $Distro -- bash "$RepoWsl/scripts/setup-wsl.sh"
if ($LASTEXITCODE -ne 0) { Stop-Here 'The Ubuntu part stopped with an error; see the messages above. Fix it and run this again.' }

Write-Host "`nSetup is complete. From now on, double-click scripts\start-consentledger.cmd to run ConsentLedger." -ForegroundColor Green
Read-Host "`nPress Enter to close"

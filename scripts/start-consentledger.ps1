# Starts the whole ConsentLedger stack after a PC restart, in the order that
# avoids the failures seen in practice:
#   1. checks free disk space (a full C: drive froze WSL before)
#   2. starts WSL Ubuntu, and stops with advice if WSL hangs
#   3. starts Docker Desktop and waits for its engine
#   4. starts PostgreSQL and the Fabric containers, peers last, retrying the
#      orderer if it started before Ubuntu's files were available
#   5. starts the REST API and the web app, each in its own window
#   6. opens the app in the browser
# Anything already running is left as it is, so it is safe to run twice.
# Double-click start-consentledger.cmd to run it.

# Errors are checked explicitly: in Windows PowerShell 5.1, 'Stop' would turn
# harmless stderr output from docker or wsl into a fatal error.
$ErrorActionPreference = 'Continue'

$Distro = 'Ubuntu-22.04'
$DockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$ApiUrl = 'http://localhost:18080/'
$WebUrl = 'http://127.0.0.1:5173'
$Repo = Split-Path -Parent $PSScriptRoot
$WebDir = Join-Path $Repo 'web'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   !!  $text" -ForegroundColor Yellow }
function Fail($text) {
    Write-Host "`n   FAILED  $text" -ForegroundColor Red
    Read-Host "`nPress Enter to close"
    exit 1
}

# Runs a command with a time limit, because a stuck WSL makes wsl.exe hang.
function Invoke-WithTimeout([scriptblock]$Block, [int]$Seconds, [object[]]$Arguments = @()) {
    $job = Start-Job -ScriptBlock $Block -ArgumentList $Arguments
    if (Wait-Job $job -Timeout $Seconds) {
        $out = Receive-Job $job
        Remove-Job $job -Force
        return @{ Done = $true; Output = $out }
    }
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    return @{ Done = $false; Output = $null }
}

function Test-Http($url) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10
        return $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Test-Docker {
    & docker info --format '{{.ServerVersion}}' *> $null
    return $LASTEXITCODE -eq 0
}

Write-Host 'Starting ConsentLedger...' -ForegroundColor White

# 1. Disk space ------------------------------------------------------------
Step 'Checking disk space'
$free = [math]::Round((Get-Volume -DriveLetter C).SizeRemaining / 1GB, 1)
if ($free -lt 3) {
    Fail "Only $free GB free on C:. Free at least 10 GB first; a full drive can freeze WSL and damage the ledger."
} elseif ($free -lt 10) {
    Warn "Only $free GB free on C:. Free some space soon (10 GB or more is safe)."
} else {
    Ok "$free GB free on C:"
}

# 2. WSL Ubuntu ------------------------------------------------------------
Step "Starting Ubuntu ($Distro)"
$wsl = Invoke-WithTimeout { param($d) & wsl.exe -d $d -- findmnt -n -o OPTIONS / } 60 @($Distro)
if (-not $wsl.Done) {
    Fail 'WSL is not responding. Restart Windows, then run this script again.'
}
$mount = "$($wsl.Output)"
if ($mount -match '(^|,)ro(,|$)') {
    Fail 'Ubuntu''s disk is read-only (usually after the C: drive filled up). Free disk space, run "wsl --shutdown" in PowerShell, then run this script again.'
}
Ok 'Ubuntu is running and its disk is writable'
$RepoWsl = "$(& wsl.exe -d $Distro -- wslpath -a ($Repo -replace '\\', '/'))".Trim()

# 3. Docker ----------------------------------------------------------------
Step 'Starting Docker Desktop'
if (Test-Docker) {
    Ok 'Docker is already running'
} else {
    if (-not (Test-Path $DockerDesktop)) { Fail "Docker Desktop not found at $DockerDesktop" }
    Start-Process $DockerDesktop
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 5
        if (Test-Docker) { $ready = $true; break }
        # Docker Desktop sometimes attaches to a stale backend after Windows
        # updates WSL; a full restart clears it.
        if ($i -eq 36) {
            Warn 'Docker is slow to start; restarting Docker Desktop'
            & docker desktop restart *> $null
        }
    }
    if (-not $ready) { Fail 'Docker did not start within 5 minutes. Open Docker Desktop to see what it reports.' }
    Ok 'Docker is running'
}

# 4. Containers ------------------------------------------------------------
Step 'Starting the database and Fabric network'
function Start-Containers([string[]]$names) {
    $null = & docker start @names 2>&1
}
function Test-Running($name) {
    $state = & docker inspect -f '{{.State.Running}}' $name 2>$null
    return "$state".Trim() -eq 'true'
}

Start-Containers @('consentledger-db', 'ca_org1', 'ca_org2', 'ca_orderer', 'couchdb0', 'couchdb1')
Start-Sleep -Seconds 5
$ordererUp = $false
for ($try = 1; $try -le 3; $try++) {
    Start-Containers @('orderer.example.com')
    Start-Sleep -Seconds 10
    if (Test-Running 'orderer.example.com') { $ordererUp = $true; break }
    Warn "Orderer stopped (attempt $try); retrying once Ubuntu's files are ready"
    Start-Sleep -Seconds 5
}
if (-not $ordererUp) { Fail 'The orderer will not start. Run "docker logs orderer.example.com" to see why.' }
Start-Containers @('peer0.org1.example.com', 'peer0.org2.example.com')
Start-Sleep -Seconds 12

$needed = 'consentledger-db', 'ca_org1', 'ca_org2', 'ca_orderer', 'couchdb0', 'couchdb1', 'orderer.example.com', 'peer0.org1.example.com', 'peer0.org2.example.com'
$down = @($needed | Where-Object { -not (Test-Running $_) })
if ($down.Count -gt 0) { Fail "These containers are not running: $($down -join ', ')" }
Ok "All $($needed.Count) containers are running"

# 5a. REST API ---------------------------------------------------------------
Step 'Starting the REST API (port 18080)'
if (Test-Http $ApiUrl) {
    Ok 'The API is already running'
} else {
    Start-Process wsl.exe -ArgumentList "-d $Distro -- bash `"$RepoWsl/scripts/run-api.sh`""
    Write-Host '   ... building and connecting (a window titled wsl shows its log; keep it open)'
    $apiUp = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 3
        if (Test-Http $ApiUrl) { $apiUp = $true; break }
    }
    if (-not $apiUp) { Fail 'The API did not start within 3 minutes. Check its window for the error.' }
    Ok 'The API is running'
}
try {
    $status = Invoke-RestMethod -Uri $ApiUrl -TimeoutSec 30
    if ($status.status -eq 'ok') {
        Ok "Ledger and database answer (channel $($status.fabric.channel))"
    } else {
        Warn "The API reports '$($status.status)'; the first request after a restart can be slow. Refresh the app in a minute."
    }
} catch {
    Warn 'Could not read the API status yet; refresh the app in a minute.'
}

# 5b. Web app ----------------------------------------------------------------
Step 'Starting the web app (port 5173)'
if (Test-Http $WebUrl) {
    Ok 'The web app is already running'
} else {
    $cmd = "Set-Location -LiteralPath '$WebDir'; " +
        "`$host.UI.RawUI.WindowTitle = 'ConsentLedger web app'; " +
        "if (-not (Test-Path node_modules)) { npm install }; " +
        "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
    Start-Process powershell.exe -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
    $webUp = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 3
        if (Test-Http $WebUrl) { $webUp = $true; break }
    }
    if (-not $webUp) { Fail 'The web app did not start within 3 minutes. Check its window for the error.' }
    Ok 'The web app is running'
}

# 6. Open the app ------------------------------------------------------------
Step 'Opening ConsentLedger'
Start-Process $WebUrl
Ok $WebUrl
Write-Host "`nConsentLedger is running. Keep the API and web app windows open while you use it;" -ForegroundColor White
Write-Host 'close them (or press Ctrl+C in each) when you are finished.' -ForegroundColor White
Read-Host "`nPress Enter to close this window"

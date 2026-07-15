<#
.SYNOPSIS
  Runtime watchdog: make sure Postgres, the web server, and the backend are up,
  and restart anything that isn't. Meant to run every few minutes as a Windows
  Scheduled Task, independent of GitHub Actions.

.WHY
  Auto-start covers a clean reboot; NSSM restarts the backend if the *process*
  crashes. This watchdog is the belt-and-suspenders layer: it catches a service
  that failed to come back after a reboot/update, a hung backend that is "running"
  but not answering, or the web server stopping on its own.

.EXAMPLE
  # IIS deployment (default):
  .\healthcheck.ps1

  # Nginx-wrapped-as-a-service deployment:
  .\healthcheck.ps1 -WebService RexNginx

.NOTES
  Register it (run once, elevated) to fire every 5 minutes:

    $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
      -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\projects\researcher-explorer\backend\scripts\healthcheck.ps1"'
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
      -RepetitionInterval (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName "RexHealthcheck" -Action $action -Trigger $trigger `
      -RunLevel Highest -User "SYSTEM"
#>
[CmdletBinding()]
param(
    [string]$HealthUrl      = "http://127.0.0.1:8001/api/health",
    [string]$BackendService = "RexBackend",
    [string]$DbService      = "postgresql-x64-16",
    [string]$WebService     = "W3SVC",   # IIS. For Nginx-as-NSSM, pass its service name.
    [string]$LogFile        = "C:\projects\logs\healthcheck.log",
    [int]   $HealthRetries  = 3
)

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force (Split-Path $LogFile) | Out-Null
function Log($m) { Add-Content $LogFile ("{0}  {1}" -f (Get-Date).ToString("s"), $m) }

# 1. Ensure the core services are running (starts them if stopped).
foreach ($svc in @($DbService, $WebService, $BackendService)) {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if (-not $s) { Log "WARN service '$svc' not found (check the name)"; continue }
    if ($s.Status -ne "Running") {
        Log "service '$svc' is $($s.Status) -> starting"
        try { Start-Service -Name $svc } catch { Log "ERROR starting '$svc': $_" }
    }
}

# 2. Liveness probe: the backend can be "running" yet not answering (hung / bad
#    deploy). If it fails every retry, restart it.
$healthy = $false
for ($i = 1; $i -le $HealthRetries; $i++) {
    try {
        $r = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
        if ($r.ok) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
}
if (-not $healthy) {
    Log "health check FAILED at $HealthUrl -> restarting '$BackendService'"
    try { Restart-Service -Name $BackendService -Force } catch { Log "ERROR restarting: $_" }
}

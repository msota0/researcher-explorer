<#
.SYNOPSIS
  One-shot database + data bootstrap for the UM Researcher Explorer backend on
  Windows (no Docker).

.DESCRIPTION
  Reads backend\.env as the single source of truth, then:
    1. creates the Python venv + installs requirements (if missing)
    2. creates the Postgres role + database (idempotent, via init_db.sql)
    3. runs Alembic migrations (schema + pg_trgm extension)
    4. imports the UM author dataset from OpenAlex
    5. pre-warms the collaborator cache so live traffic never calls OpenAlex

  Safe to re-run: every step is idempotent / resumable.

.PREREQUISITES
  - PostgreSQL 16 installed and its service running.
  - Python 3.12 on PATH.
  - backend\.env created (see DEPLOY_WINDOWS.md step 3), with DATABASE_URL set.

.EXAMPLE
  # From the backend directory, in an elevated PowerShell:
  .\scripts\bootstrap.ps1

.EXAMPLE
  # Just (re)create the DB and schema; skip the slow OpenAlex steps:
  .\scripts\bootstrap.ps1 -SkipImport -SkipPrewarm

.EXAMPLE
  # Rebuild the whole collaborator cache from scratch:
  .\scripts\bootstrap.ps1 -SkipImport -ForcePrewarm
#>
[CmdletBinding()]
param(
    [string]        $PgBin        = "C:\Program Files\PostgreSQL\16\bin",
    [string]        $SuperUser    = "postgres",
    [securestring]  $SuperPassword,
    [switch]        $SkipDeps,
    [switch]        $SkipImport,
    [switch]        $SkipPrewarm,
    [switch]        $ForcePrewarm
)

$ErrorActionPreference = "Stop"

# --- Locate things -----------------------------------------------------------
$BackendDir = Split-Path -Parent $PSScriptRoot       # ...\backend
$EnvFile    = Join-Path $BackendDir ".env"
$SqlFile    = Join-Path $PSScriptRoot "init_db.sql"
$Psql       = Join-Path $PgBin "psql.exe"
Set-Location $BackendDir

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

if (-not (Test-Path $EnvFile)) {
    Fail "No .env found at $EnvFile. Create it first (see DEPLOY_WINDOWS.md step 3)."
}
if (-not (Test-Path $Psql)) {
    Fail "psql.exe not found at $Psql. Pass -PgBin '<path to PostgreSQL\NN\bin>'."
}

# --- Parse DATABASE_URL from .env -------------------------------------------
$dbUrl = (Get-Content $EnvFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
          Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', ''
if (-not $dbUrl) { Fail "DATABASE_URL not set in .env" }

# postgresql+psycopg://USER:PASSWORD@HOST:PORT/DBNAME
if ($dbUrl -notmatch '://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?\s]+)') {
    Fail "Could not parse DATABASE_URL. Expected ...://user:pass@host:port/dbname (avoid '@' or ':' in the password)."
}
$AppUser = $matches[1]; $AppPass = $matches[2]
$DbHost  = $matches[3]; $DbPort = $matches[4]; $AppDb = $matches[5]

Write-Host "Target: database '$AppDb' as role '$AppUser' on ${DbHost}:${DbPort}"
if ($DbHost -notin @("localhost", "127.0.0.1")) {
    Write-Host "Note: DATABASE_URL host is '$DbHost'; this script creates the role/db via that host." -ForegroundColor Yellow
}

# --- Superuser password for the create-role/db step --------------------------
if (-not $SuperPassword) {
    $SuperPassword = Read-Host "Postgres superuser ('$SuperUser') password" -AsSecureString
}
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SuperPassword))

# --- 1. venv + deps ----------------------------------------------------------
$VenvPy = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not $SkipDeps) {
    if (-not (Test-Path $VenvPy)) {
        Step "Creating virtual environment (.venv)"
        python -m venv .venv
    }
    Step "Installing backend dependencies"
    & $VenvPy -m pip install --upgrade pip | Out-Null
    & $VenvPy -m pip install -r requirements.txt
}
if (-not (Test-Path $VenvPy)) { Fail ".venv missing and -SkipDeps was set." }

# --- 2. role + database ------------------------------------------------------
Step "Creating Postgres role '$AppUser' and database '$AppDb' (idempotent)"
& $Psql -v ON_ERROR_STOP=1 -U $SuperUser -h $DbHost -p $DbPort -d postgres `
        -v app_user=$AppUser -v app_password=$AppPass -v app_db=$AppDb -f $SqlFile
if ($LASTEXITCODE -ne 0) { Fail "psql failed creating role/database." }
$env:PGPASSWORD = $null   # superuser password no longer needed

# --- 3. migrations -----------------------------------------------------------
Step "Applying Alembic migrations (schema + pg_trgm)"
& (Join-Path $BackendDir ".venv\Scripts\alembic.exe") upgrade head
if ($LASTEXITCODE -ne 0) { Fail "alembic upgrade failed." }

# --- 4. import authors -------------------------------------------------------
if ($SkipImport) {
    Write-Host "`nSkipping author import (-SkipImport)." -ForegroundColor Yellow
} else {
    Step "Importing UM authors from OpenAlex (this can take a while)"
    & $VenvPy -m app.importer
    if ($LASTEXITCODE -ne 0) { Fail "app.importer failed." }
}

# --- 5. pre-warm collaborator cache -----------------------------------------
if ($SkipPrewarm) {
    Write-Host "`nSkipping cache pre-warm (-SkipPrewarm)." -ForegroundColor Yellow
} else {
    Step "Pre-warming the collaborator cache (rate-limited; can take a while)"
    if ($ForcePrewarm) { & $VenvPy -m app.prewarm --force }
    else               { & $VenvPy -m app.prewarm }
    if ($LASTEXITCODE -ne 0) { Fail "app.prewarm failed." }
}

Write-Host "`nDone. Database is set up and loaded." -ForegroundColor Green
Write-Host "Next: run the backend service (DEPLOY_WINDOWS.md step 6) and check:" -ForegroundColor Green
Write-Host "  Invoke-RestMethod http://127.0.0.1:8001/api/health"

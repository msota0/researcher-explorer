# Hosting on Windows Server (no Docker)

Native Windows deployment for ~10–100 users, public internet. Everything runs on
one box:

```
Internet ──► IIS  (:443, HTTPS)
               ├─ serves the built React frontend (static files)
               └─ reverse-proxies /api/*  ──► uvicorn (127.0.0.1:8001, 4 workers)
                                                 └─ PostgreSQL (127.0.0.1:5432, local only)
```

Because IIS serves the frontend **and** proxies `/api` on the same origin, there
is **no CORS to configure** and the frontend needs no API-URL changes (it calls
relative `/api/...`).

You need **admin rights** on the server. Commands are PowerShell (run as
Administrator).

---

## 1. PostgreSQL

1. Install **PostgreSQL 16** with the EnterpriseDB Windows installer. It
   registers a Windows service (`postgresql-x64-16`) that auto-starts on boot.
   Note the `postgres` superuser password you set.
2. Create the database and app user (adjust the password):

   ```powershell
   & 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -c "CREATE USER rex WITH PASSWORD 'CHANGE_ME_STRONG';"
   & 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -c "CREATE DATABASE researcher_explorer OWNER rex;"
   ```

   The `pg_trgm` extension is created automatically by the Alembic migration in
   step 4 — nothing to do here.
3. Keep Postgres bound to localhost only (default `listen_addresses = 'localhost'`
   in `postgresql.conf`). Do **not** open port 5432 in the firewall.
4. (Optional, when you grow) Postgres default `max_connections` is 100. With 4
   workers × (pool 10 + overflow 5) = 60 you're fine. If you raise worker count,
   keep `workers × 15` under `max_connections`.

## 2. Python + backend dependencies

1. Install **Python 3.12** (tick "Add to PATH").
2. Create a venv and install deps:

   ```powershell
   cd C:\projects\researcher-explorer\backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

## 3. Production `.env`

Create `C:\projects\researcher-explorer\backend\.env` (loaded automatically by
`config.py`):

```dotenv
DATABASE_URL=postgresql+psycopg://rex:CHANGE_ME_STRONG@localhost:5432/researcher_explorer
OPENALEX_MAILTO=your.real.email@olemiss.edu
UM_INSTITUTION_ID=I368840534

# Windows path for the importer snapshot (the default /data/... is Linux-only):
SNAPSHOT_PATH=C:\projects\researcher-explorer\data\um_authors.jsonl

# Pool sized for 4 workers; OpenAlex rate is per process.
DB_POOL_SIZE=10
DB_MAX_OVERFLOW=5
OPENALEX_MAX_RPS=8

# Only needed if the frontend is ever served from a different origin than the API.
# With the same-origin IIS setup below you can leave this unset.
# CORS_ALLOW_ORIGINS=https://researchers.olemiss.edu
```

Set a real `OPENALEX_MAILTO` — it keeps you in OpenAlex's polite pool.

## 4. Create tables and load data

**One-shot option (recommended).** `scripts\bootstrap.ps1` does steps 2, 4 and 5
in a single run — it creates the venv + installs deps, creates the Postgres role
and database, migrates, imports, and pre-warms the cache — reading `.env` as the
single source of truth. From the backend directory, in an elevated PowerShell:

```powershell
cd C:\projects\researcher-explorer\backend
New-Item -ItemType Directory -Force C:\projects\researcher-explorer\data | Out-Null
.\scripts\bootstrap.ps1        # prompts once for the Postgres superuser password
```

Useful switches: `-SkipImport -SkipPrewarm` (just create DB + schema),
`-ForcePrewarm` (rebuild the cache), `-PgBin '<path>'` if Postgres isn't at the
default location. It's safe to re-run.

**Manual option.** If you'd rather run each step yourself:

```powershell
cd C:\projects\researcher-explorer\backend
.\.venv\Scripts\Activate.ps1
New-Item -ItemType Directory -Force C:\projects\researcher-explorer\data | Out-Null

# create role + database (idempotent); prompts for the superuser password
$env:PGPASSWORD = Read-Host "postgres password"
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -d postgres `
    -v app_user=rex -v app_password=CHANGE_ME_STRONG -v app_db=researcher_explorer `
    -f scripts\init_db.sql

alembic upgrade head        # creates schema + pg_trgm extension
python -m app.importer      # fetches all UM authors from OpenAlex into Postgres
```

## 5. Pre-warm the collaborator cache  ⟵ the key step for load + rate limits

This fetches every author's co-authors once, at a controlled rate, into
Postgres. After it finishes, **live traffic is served entirely from the database
and never calls OpenAlex** — which is what removes both the "429 / max usage"
problem and the slow cold-cache requests that stall the server under concurrency.

```powershell
python -m app.prewarm       # resumable; re-run anytime, skips what's cached
```

It prints progress and a summary. Safe to stop and re-run (it skips already
cached ids). Re-run it periodically (e.g. monthly) to refresh, or `--force` to
rebuild from scratch. Run it **again after every `python -m app.importer`** so
new authors get cached.

## 6. Run the backend as a Windows service (uvicorn + NSSM)

`gunicorn` does not work on Windows, so use uvicorn's own multi-worker mode,
wrapped as a service by **NSSM** so it auto-starts and restarts on crash.

1. Download **NSSM** (nssm.cc), put `nssm.exe` somewhere on PATH.
2. Install the service (one line):

   ```powershell
   nssm install RexBackend "C:\projects\researcher-explorer\backend\.venv\Scripts\python.exe" "-m uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 4"
   nssm set RexBackend AppDirectory "C:\projects\researcher-explorer\backend"
   nssm set RexBackend AppStdout "C:\projects\logs\backend.out.log"
   nssm set RexBackend AppStderr "C:\projects\logs\backend.err.log"
   nssm set RexBackend Start SERVICE_AUTO_START
   New-Item -ItemType Directory -Force C:\projects\logs | Out-Null
   nssm start RexBackend
   ```

   `AppDirectory` ensures the venv, `app` package, and `.env` all resolve.
3. Verify: `Invoke-RestMethod http://127.0.0.1:8001/api/health` → `{ ok = True }`.

Bind to `127.0.0.1` (not `0.0.0.0`): only IIS should reach uvicorn, never the
public internet directly.

## 7. Build the frontend

On a machine with Node (can be the server):

```powershell
cd C:\projects\researcher-explorer\frontend
npm ci
npm run build          # outputs to .\dist
```

Copy `dist\` to where IIS will serve it, e.g. `C:\projects\www`.

## 8. IIS: static site + reverse proxy + HTTPS

1. Enable IIS (Server Manager → Add Roles → Web Server (IIS)).
2. Install the **URL Rewrite** and **Application Request Routing (ARR)** modules
   (Microsoft Web Platform Installer or standalone MSIs).
3. In IIS Manager → server node → **Application Request Routing Cache** →
   *Server Proxy Settings* → tick **Enable proxy**.
4. Create a site (or use Default Web Site) with physical path `C:\projects\www`.
5. Add a reverse-proxy rewrite rule so `/api/*` goes to uvicorn. Put this
   `web.config` in `C:\projects\www`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <configuration>
     <system.webServer>
       <rewrite>
         <rules>
           <!-- API -> uvicorn -->
           <rule name="ProxyApi" stopProcessing="true">
             <match url="^api/(.*)" />
             <action type="Rewrite" url="http://127.0.0.1:8001/api/{R:1}" />
           </rule>
           <!-- SPA fallback: everything else -> index.html -->
           <rule name="SpaFallback" stopProcessing="true">
             <match url=".*" />
             <conditions logicalGrouping="MatchAll">
               <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
               <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
             </conditions>
             <action type="Rewrite" url="/index.html" />
           </rule>
         </rules>
       </rewrite>
     </system.webServer>
   </configuration>
   ```

6. **HTTPS**: bind a certificate to the site on port 443. Easiest for a public
   domain is **win-acme** (`wacs.exe`) — it issues a free Let's Encrypt cert and
   auto-renews, or use a campus-issued cert. Add an HTTP→HTTPS redirect rule.

## 9. Firewall / network

- Allow inbound **443** only (and 80 if you keep an HTTP→HTTPS redirect).
- Do **not** expose 8001 (uvicorn) or 5432 (Postgres).
- Public inbound on a campus network usually needs IT to open the port / map the
  domain — start that request early.

## 10. Keeping it running (reboots, crashes, monitoring)

Three independent layers keep the site up without you watching it:

**a. Survive a reboot — set every service to auto-start.** All three run as
Windows services, so a clean reboot brings them all back:
- PostgreSQL — the installer sets it to *Automatic*.
- IIS (`W3SVC`) — *Automatic* by default.
- Backend (`RexBackend`) — set to auto-start in step 6 (`nssm set RexBackend Start
  SERVICE_AUTO_START`).

Verify with `Get-Service postgresql-x64-16, W3SVC, RexBackend` — `StartType`
should be `Automatic`.

> **Using Nginx instead of IIS?** On Windows, Nginx is a plain `.exe`, **not** a
> service, so it will **not** restart after a reboot or crash on its own. Wrap it
> with NSSM the same way as the backend:
> `nssm install RexNginx "C:\nginx\nginx.exe"` then
> `nssm set RexNginx AppDirectory "C:\nginx"`. This is a big reason IIS is the
> lower-maintenance choice on Windows.

**b. Survive a crash — service recovery.** NSSM already restarts the backend
*process* if it exits. Add Windows-level recovery for the others so a failed
service is auto-restarted:

```powershell
sc.exe failure postgresql-x64-16 reset= 86400 actions= restart/5000/restart/5000/restart/5000
sc.exe failure RexBackend        reset= 86400 actions= restart/5000/restart/5000/restart/5000
```

**c. Watchdog — catch what the above miss.** A hung-but-"running" backend, or a
service that failed to come back after an update, is caught by
`scripts\healthcheck.ps1`, which probes `/api/health` and restarts anything down.
Register it to run every 5 minutes (elevated PowerShell):

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\projects\researcher-explorer\backend\scripts\healthcheck.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "RexHealthcheck" -Action $action -Trigger $trigger `
  -RunLevel Highest -User "SYSTEM"
```

It logs to `C:\projects\logs\healthcheck.log`. Pass `-WebService RexNginx` if you use
the Nginx-as-a-service setup above. For outage *alerting* (email/Teams), point an
external uptime monitor at your public URL, or extend the script.

## 11. CI/CD (optional)

Automated build + deploy via GitHub Actions works even though the server is
on-prem — a **self-hosted runner** on this box pulls jobs over outbound HTTPS
(no inbound firewall change). See **`docs/SELF_HOSTED_RUNNER.md`**. Deploys are
manual (`Run workflow`) and end with the same `/api/health` gate. The manual
setup in *this* runbook is still the one-time baseline the pipeline builds on.

---

## Everyday operations

| Task | Command |
|------|---------|
| Restart backend | `nssm restart RexBackend` |
| Stop / start | `nssm stop RexBackend` / `nssm start RexBackend` |
| Backend logs | `Get-Content C:\projects\logs\backend.err.log -Tail 100 -Wait` |
| Refresh author data | `python -m app.importer` then `python -m app.prewarm` |
| Rebuild cache from scratch | `python -m app.prewarm --force` |
| Deploy frontend change | `npm run build` → copy `dist\*` to `C:\projects\www` |
| Deploy backend change | pull code → `nssm restart RexBackend` |

## When you outgrow this

At 10–100 users the above is comfortable. If it grows into a heavier public
tool:

- Raise `--workers` (and bump `max_connections` accordingly) or move Postgres to
  its own machine.
- Convert the graph endpoints to async SQLAlchemy so DB work never blocks a
  worker's event loop even on cache misses (the author routes are already
  offloaded to a threadpool).
- If you keep triggering live OpenAlex crawls, get an OpenAlex API key for a
  higher rate ceiling — but a fully pre-warmed cache means live traffic never
  calls OpenAlex at all.

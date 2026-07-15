# Self-hosted GitHub Actions runner (on-prem Windows)

The **CI** workflow runs on GitHub-hosted runners (no setup needed). The
**Deploy** and **Refresh data** workflows run on a **self-hosted runner** you
install on the Windows Server, because only something *inside* your network can
restart the service and write to the web root.

## Why self-hosted (and why it's firewall-friendly)

The runner **polls GitHub over outbound HTTPS** and pulls jobs to run locally.
There is **no inbound connection** from GitHub to your server — so you do **not**
open any firewall port for CI/CD. That's what makes on-prem deployment behind a
campus firewall both possible and safe.

## Install (once)

1. In GitHub: **repo → Settings → Actions → Runners → New self-hosted runner →
   Windows**. Follow the shown commands (they include a one-time token). Roughly:

   ```powershell
   mkdir C:\actions-runner; cd C:\actions-runner
   # download + extract the runner package shown on that page, then:
   .\config.cmd --url https://github.com/<you>/<repo> --token <TOKEN> --labels rex-prod
   ```

   The `rex-prod` label is what `runs-on: [self-hosted, windows, rex-prod]` in the
   workflows targets.

2. **Install it as a service** so it survives reboots and runs unattended:

   ```powershell
   .\svc.cmd install
   .\svc.cmd start
   ```

3. **Run the service under an account with deploy rights.** The runner account
   must be able to:
   - write to `C:\projects\www` and `C:\projects\researcher-explorer\backend`, and
   - restart the `RexBackend` service (`Restart-Service`).

   Either run the runner service as an admin account, or grant a dedicated
   service account those specific rights. Set the logon account via
   `services.msc` → the runner service → *Log On* tab, then restart it.

4. Make sure the runner host has **Git**, and that **PostgreSQL is reachable** and
   the `RexBackend` NSSM service exists (from `DEPLOY_WINDOWS.md`). `setup-node`
   in the workflows installs Node on demand.

## What runs where

| Workflow | Runner | Trigger |
| --- | --- | --- |
| `ci.yml` | GitHub-hosted (ubuntu) | every PR + push to `main` |
| `deploy.yml` | self-hosted `rex-prod` | manual (**Run workflow**) |
| `refresh-data.yml` | self-hosted `rex-prod` | manual (optionally scheduled) |

## First deploy

1. Merge these files to `main` (CI runs and must pass).
2. Do the manual server setup in `DEPLOY_WINDOWS.md` **once** (Postgres, `.env`,
   venv, NSSM service, IIS). `deploy.yml` handles code updates *after* that
   baseline exists — it does not create the service or the database.
3. Actions tab → **Deploy (production)** → **Run workflow**. Watch the health
   check step confirm the backend came back.

## Optional: approval gate

The deploy job uses `environment: production`. In **Settings → Environments →
production**, add **required reviewers** to force a manual approval click before
each deploy runs.

## Paths the workflows assume

Set in `deploy.yml` / `refresh-data.yml` `env:` — change them there if your
layout differs:

- `BACKEND_DIR = C:\projects\researcher-explorer\backend`
- `WWW_DIR     = C:\projects\www`
- `SERVICE     = RexBackend`

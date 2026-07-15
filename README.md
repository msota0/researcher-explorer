# UM Researcher Explorer

Interactive explorer for **University of Mississippi (Ole Miss)** authors,
powered by [OpenAlex](https://openalex.org/). The full set of ~6,900 UM authors
is **preloaded into Postgres**; search, browse, and the collaborator graph are
all scoped to UM. Pick a UM author, inspect rich metadata in the side panel, and
expand the graph to see their co-authors *who are also at UM*.

> Scoped to OpenAlex institution `I368840534` (University of Mississippi),
> authors whose last-known affiliation includes UM.

```
┌───────────────────────────────────────────────────────────────┐
│ Researcher·Explorer   [search box]                  status…    │
├──────────┬──────────────────────────────────────────┬────────┤
│ encoding │                                          │ author │
│ filters  │            Cytoscape graph               │ panel  │
│          │            (zoom, pan, drag)             │        │
│ legend   │                                          │        │
└──────────┴──────────────────────────────────────────┴────────┘
```

## Architecture

- **Backend** (`backend/`): FastAPI + SQLAlchemy + **PostgreSQL**. Serves the
  preloaded UM author dataset; only hits OpenAlex live for collaborator edges
  (which are then cached in Postgres). Runs in Docker for local dev, or **natively
  with no Docker** for hosting — see [Hosting in production](#hosting-in-production).
- **Database**: PostgreSQL 16. Structured, typed tables (not JSON blobs) so
  authors are queryable/sortable; full OpenAlex record kept in a `JSONB` column
  for the detail view. Schema is managed with **Alembic**.
- **Frontend** (`frontend/`): React + Vite + TypeScript + Tailwind + Cytoscape.js
  (fcose layout). Talks to the backend over `/api/*` — via the Vite proxy in dev,
  or same-origin behind a reverse proxy in production (no CORS needed).

### Data model (Postgres)

| Table                | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `authors`            | typed columns (name, works, citations, h-index, institution …) + `raw` JSONB + a `pg_trgm` index on the name for fast search |
| `author_concepts`    | research topics per author (filter/sort)                       |
| `author_affiliations`| structured affiliation history                                 |
| `collaborators`      | cached UM↔UM co-authorship edges (populated lazily on expand)  |

### Collection pipeline (`app/importer.py`)

1. Cursor-page OpenAlex `authors?filter=last_known_institutions.id:I368840534`.
2. Append every raw record to `data/um_authors.jsonl` — a **durable snapshot**
   (source of truth; reload the DB from it without re-hitting OpenAlex).
3. Single-writer batched upsert into Postgres (no lock contention).

```bash
docker compose run --rm backend python -m app.importer                 # fetch + load
docker compose run --rm backend python -m app.importer --from-snapshot # reload from snapshot
```

### Collaborator cache (`app/prewarm.py`)

Collaborator edges are fetched from OpenAlex live and cached in the
`collaborators` table. On a cold cache that fetch is slow and, under many
concurrent users, hits OpenAlex's rate limit. **Pre-warm the cache once** so live
traffic is served entirely from Postgres and never calls OpenAlex:

```bash
python -m app.prewarm            # resumable; fills what isn't cached yet
python -m app.prewarm --force    # re-fetch and overwrite everything
```

It fetches exactly the ids the graph would ever crawl, at a controlled rate
(`OPENALEX_MAX_RPS`). Re-run it after every importer run so new authors get cached.

## Run it

### Backend + database (Docker)

```bash
cp backend/.env.example backend/.env   # set OPENALEX_MAILTO
docker compose build
docker compose up -d db                # Postgres (published on host port 5434)
docker compose run --rm backend alembic upgrade head      # create schema
docker compose run --rm backend python -m app.importer    # preload all UM authors (~2 min)
docker compose up -d backend
```

Health check: <http://127.0.0.1:8001/api/health> · Docs: <http://127.0.0.1:8001/docs>

> The DB is published on host port **5434** to avoid clashing with any local
> Postgres on 5432. Inside the compose network the backend reaches it as `db:5432`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## Hosting in production

Docker is **only a dev convenience** — the app is plain FastAPI + PostgreSQL + a
static frontend build and runs natively on any host, including **Windows Server
without Docker**.

**Full Windows runbook:** [`DEPLOY_WINDOWS.md`](DEPLOY_WINDOWS.md) — PostgreSQL as
a service → Python venv → `.env` → migrate/import/prewarm → uvicorn-as-a-service
via NSSM (gunicorn can't run on Windows) → IIS reverse proxy + HTTPS → firewall.

**One-shot database bootstrap:** [`backend/scripts/bootstrap.ps1`](backend/scripts/bootstrap.ps1)
reads `.env` and runs the whole bring-up idempotently — creates the venv + deps,
creates the Postgres role/database, migrates, imports, and pre-warms the cache:

```powershell
cd backend
.\scripts\bootstrap.ps1        # prompts once for the Postgres superuser password
```

(`scripts/init_db.sql` is the idempotent role/DB creation on its own, for manual
or non-Windows use.)

### Serving shape

```
Internet ─► reverse proxy (IIS/Nginx, :443 HTTPS)
              ├─ serves the built frontend (npm run build → dist/, static files)
              └─ proxies /api/* ─► uvicorn (127.0.0.1:8001, multiple workers)
                                      └─ PostgreSQL (127.0.0.1:5432, local only)
```

Frontend and API share one origin, so **no CORS** is needed. Run the backend with
multiple workers (`uvicorn app.main:app --workers 4`) behind the proxy; bind
uvicorn and Postgres to localhost so only the proxy is public.

### Built to handle concurrent users

- **Pre-warmed cache** (`app/prewarm.py`) keeps OpenAlex off the request path, so
  live traffic serves from Postgres — this is what avoids OpenAlex rate-limit
  (429) errors and slow cold-cache requests under load.
- **Non-blocking author routes** — search/browse/detail run in FastAPI's
  threadpool, so a slow query never stalls a worker's event loop.
- **Tuned connection pool** sized for the worker count (`DB_POOL_SIZE`,
  `DB_MAX_OVERFLOW`); keep `workers × (pool + overflow)` under Postgres
  `max_connections` (default 100).
- **Global OpenAlex rate limiter** (`OPENALEX_MAX_RPS`, per process) as a backstop
  for any remaining cold fetches, keeping you in OpenAlex's polite pool.

### Configuration (env / `.env`)

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `…@localhost:5432/researcher_explorer` | Postgres connection |
| `OPENALEX_MAILTO` | `anonymous@example.com` | Real address → OpenAlex polite pool |
| `UM_INSTITUTION_ID` | `I368840534` | Which institution counts as "UM" |
| `SNAPSHOT_PATH` | `/data/um_authors.jsonl` | Importer snapshot path (use a Windows path on Windows) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `10` / `5` | Connection pool, per worker |
| `OPENALEX_MAX_RPS` | `8` | Max OpenAlex requests/sec, per process |
| `HTTP_CONCURRENCY` | `8` | Max concurrent OpenAlex crawls |
| `MAX_COLLABORATORS_PER_AUTHOR` | `40` | Graph fan-out cap |
| `CORS_ALLOW_ORIGINS` | localhost dev origins | Only needed if frontend is a different origin than the API |

### Staying up (reboots, crashes, monitoring)

Three layers keep it running unattended (details in `DEPLOY_WINDOWS.md` §10):

- **Auto-start on boot** — Postgres, the web server, and the `RexBackend` NSSM
  service are all set to Automatic, so a reboot brings everything back.
- **Auto-restart on crash** — NSSM restarts the backend process; `sc failure`
  adds service-level recovery.
- **Watchdog** — `backend/scripts/healthcheck.ps1` runs every 5 min as a Scheduled
  Task, probes `/api/health`, and restarts anything found down (catches a hung
  backend or a service that didn't come back after an update).

> On Windows, **Nginx is not a service** and won't restart after a reboot/crash
> unless wrapped with NSSM — IIS is the lower-maintenance choice.

### CI/CD (GitHub Actions, incl. on-prem)

Works even though the server is on-prem, via a **self-hosted runner** that polls
GitHub over outbound HTTPS (no inbound firewall change). Setup:
[`docs/SELF_HOSTED_RUNNER.md`](docs/SELF_HOSTED_RUNNER.md).

| Workflow | Runner | Trigger | Does |
| --- | --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | GitHub-hosted | PR + push to `main` | ruff lint, backend import check, frontend build/typecheck |
| [`deploy.yml`](.github/workflows/deploy.yml) | self-hosted | manual (`Run workflow`) | build → sync to web root + backend → migrate → restart → `/api/health` gate |
| [`refresh-data.yml`](.github/workflows/refresh-data.yml) | self-hosted | manual / optional cron | re-import authors + re-warm the cache |

The pipeline builds on the one-time manual baseline in `DEPLOY_WINDOWS.md`; it
updates code and restarts, it doesn't create the DB or service.

## Visual encoding

All four channels are user-switchable from the **Encoding** panel:

| Channel       | Default            | Other options                             |
| ------------- | ------------------ | ----------------------------------------- |
| Node size     | # collaborators    | works, citations                          |
| Node color    | institution        | country, depth-from-root                  |
| Node border   | h-index            | citations, none                           |
| Edge width    | # co-authored works| (always — fixed encoding)                 |

## Controls

- **Scroll** — zoom
- **Drag** background — pan
- **Drag** node — reposition
- **Click** node — open the side panel
- **Double-click** node — expand its collaborators
- Toolbar: `+`, `−`, `fit`, `⊙` center, `PNG`, `JSON`

## API

| Method | Path                                  | Purpose                                  |
| ------ | ------------------------------------- | ---------------------------------------- |
| GET    | `/api/authors/search?q=…`             | Name search within the UM dataset        |
| GET    | `/api/authors/browse?limit=&offset=&sort=` | Paginated directory of all UM authors |
| GET    | `/api/authors/{id}`                   | Full author metadata for the side panel  |
| GET    | `/api/graph/expand?author_id=…&depth=N` | UM-only co-author subgraph within N hops |
| GET    | `/api/health`                         | Liveness                                 |

## Notes

- OpenAlex requires a `mailto` param for higher rate limits; set `OPENALEX_MAILTO`
  in `.env`. After [pre-warming the cache](#collaborator-cache-appprewarmpy), live
  traffic doesn't call OpenAlex at all — only the importer and prewarm do.
- `MAX_COLLABORATORS_PER_AUTHOR` caps fan-out (default 40) so prolific authors
  don't explode the graph. Raise it via the env var or `max_per_node` query
  param if you want denser graphs.
- Re-run the importer to refresh the dataset (then re-run `app.prewarm`). To
  change which institution is "UM", set `UM_INSTITUTION_ID` and re-import.
- To reset the database entirely: drop and recreate it (Docker:
  `docker compose down -v`; native: `DROP DATABASE` then `scripts/init_db.sql`),
  then re-run the migration + importer + prewarm.

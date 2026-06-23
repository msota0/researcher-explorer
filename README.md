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

- **Backend** (`backend/`): FastAPI + SQLAlchemy + **PostgreSQL**, run in Docker.
  Serves the preloaded UM author dataset; only hits OpenAlex live for collaborator
  edges (which are then cached in Postgres).
- **Database** (`db` service): PostgreSQL 16 in Docker. Structured, typed tables
  (not JSON blobs) so authors are queryable/sortable; full OpenAlex record kept in
  a `JSONB` column for the detail view. Schema is managed with **Alembic**.
- **Frontend** (`frontend/`): React + Vite + TypeScript + Tailwind + Cytoscape.js
  (fcose layout), run on the host. Talks to the backend over `/api/*` via the Vite proxy.

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

- OpenAlex requires a `mailto` param for higher rate limits; set it in `.env`.
- `MAX_COLLABORATORS_PER_AUTHOR` caps fan-out (default 40) so prolific authors
  don't explode the graph. Raise it via the env var or `max_per_node` query
  param if you want denser graphs.
- Re-run the importer to refresh the dataset. To change which institution is
  "UM", set `UM_INSTITUTION_ID` and re-import.
- To reset the database entirely: `docker compose down -v` (drops the `pgdata`
  volume), then re-run the migration + importer.

import os
from dotenv import load_dotenv

load_dotenv()

OPENALEX_BASE = "https://api.openalex.org"
OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "anonymous@example.com")

# University of Mississippi (Ole Miss). Everything in the app is scoped to this.
UM_INSTITUTION_ID = os.getenv("UM_INSTITUTION_ID", "I368840534")
# The directory/search/merge only consider authors whose affiliation is exactly
# the University of Mississippi (not UMMC, hospitals, or other institutions that
# appear in the raw OpenAlex dataset).
UM_INSTITUTION_NAME = os.getenv("UM_INSTITUTION_NAME", "University of Mississippi")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://rex:rex@localhost:5432/researcher_explorer",
)

# Connection pool. With N uvicorn workers, total Postgres connections is
# N * (DB_POOL_SIZE + DB_MAX_OVERFLOW); keep that under Postgres max_connections
# (default 100). Defaults below suit ~4 workers (4 * 15 = 60).
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "5"))
DB_POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "30"))
DB_POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "1800"))

HTTP_CONCURRENCY = int(os.getenv("HTTP_CONCURRENCY", "8"))
MAX_COLLABORATORS_PER_AUTHOR = int(os.getenv("MAX_COLLABORATORS_PER_AUTHOR", "40"))

# Global cap on OpenAlex requests/second (per process). OpenAlex's polite pool
# allows ~10/s; we leave headroom. NOTE: this limiter is per worker process, so
# with N uvicorn workers the effective rate is N * OPENALEX_MAX_RPS. Prewarming
# the collaborator cache (see app.prewarm) is a single process and stays exact.
OPENALEX_MAX_RPS = float(os.getenv("OPENALEX_MAX_RPS", "8"))

# How many times to retry a single request that comes back 429 before giving up.
# Each retry honors the server's Retry-After (or backs off exponentially, capped
# at 60s) and pauses the whole process, so a high ceiling here lets a long batch
# run (app.prewarm) ride out an extended throttle instead of shedding thousands
# of authors. Raise OPENALEX_MAX_RETRIES / lower OPENALEX_MAX_RPS if prewarm
# still sees 429s on your network.
OPENALEX_MAX_RETRIES = int(os.getenv("OPENALEX_MAX_RETRIES", "8"))

# Comma-separated allowed CORS origins for the hosted frontend. When the
# frontend is served same-origin (e.g. via IIS reverse proxy) CORS is not used
# at all; this only matters if the frontend is on a different origin.
CORS_ALLOW_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174",
    ).split(",")
    if o.strip()
]

# Where the importer writes the durable raw snapshot (source of truth).
SNAPSHOT_PATH = os.getenv("SNAPSHOT_PATH", "/data/um_authors.jsonl")

import os
from dotenv import load_dotenv

load_dotenv()

OPENALEX_BASE = "https://api.openalex.org"
OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "anonymous@example.com")

# University of Mississippi (Ole Miss). Everything in the app is scoped to this.
UM_INSTITUTION_ID = os.getenv("UM_INSTITUTION_ID", "I368840534")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://rex:rex@localhost:5432/researcher_explorer",
)

HTTP_CONCURRENCY = int(os.getenv("HTTP_CONCURRENCY", "8"))
MAX_COLLABORATORS_PER_AUTHOR = int(os.getenv("MAX_COLLABORATORS_PER_AUTHOR", "40"))

# Where the importer writes the durable raw snapshot (source of truth).
SNAPSHOT_PATH = os.getenv("SNAPSHOT_PATH", "/data/um_authors.jsonl")

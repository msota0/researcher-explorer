"""Preload the full University of Mississippi author dataset into Postgres.

Pipeline:
  1. Cursor-page OpenAlex authors filtered to UM (deterministic, re-runnable).
  2. Append every raw record to a JSONL snapshot (durable source of truth).
  3. Single-writer batched upsert into Postgres.

Usage (inside the backend container):
  python -m app.importer                 # fetch from OpenAlex + load DB + snapshot
  python -m app.importer --from-snapshot # reload DB from the existing snapshot only
"""
from __future__ import annotations

import json
import os
import sys
from typing import Iterator

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import (
    OPENALEX_BASE,
    OPENALEX_MAILTO,
    SNAPSHOT_PATH,
    UM_INSTITUTION_ID,
)
from .db import SessionLocal
from .db_models import Author, AuthorAffiliation, AuthorConcept
from . import mapping

PER_PAGE = 200


def _iter_openalex_um_authors() -> Iterator[dict]:
    """Yield every UM author payload via cursor pagination."""
    params = {
        "filter": f"last_known_institutions.id:{UM_INSTITUTION_ID}",
        "per_page": PER_PAGE,
        "mailto": OPENALEX_MAILTO,
    }
    headers = {"User-Agent": f"researcher-explorer (mailto:{OPENALEX_MAILTO})"}
    cursor = "*"
    seen = 0
    with httpx.Client(base_url=OPENALEX_BASE, headers=headers, timeout=60.0) as client:
        while cursor:
            r = client.get("/authors", params={**params, "cursor": cursor})
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            for a in results:
                yield a
            seen += len(results)
            total = data.get("meta", {}).get("count", 0)
            print(f"  fetched {seen}/{total}", flush=True)
            cursor = data.get("meta", {}).get("next_cursor")
            if not results:
                break


def _upsert_batch(db, payloads: list[dict]) -> None:
    if not payloads:
        return
    cols = [mapping.author_columns(p, um_institution_id=UM_INSTITUTION_ID) for p in payloads]
    stmt = pg_insert(Author).values(cols)
    update = {
        c: getattr(stmt.excluded, c)
        for c in cols[0].keys()
        if c != "id"
    }
    stmt = stmt.on_conflict_do_update(index_elements=["id"], set_=update)
    db.execute(stmt)

    ids = [c["id"] for c in cols]
    db.query(AuthorConcept).filter(AuthorConcept.author_id.in_(ids)).delete(
        synchronize_session=False
    )
    db.query(AuthorAffiliation).filter(AuthorAffiliation.author_id.in_(ids)).delete(
        synchronize_session=False
    )
    concept_rows = []
    affil_rows = []
    for p in payloads:
        aid = mapping.short_id(p["id"])
        for c in mapping.concept_rows(p):
            concept_rows.append({"author_id": aid, **c})
        for a in mapping.affiliation_rows(p):
            affil_rows.append({"author_id": aid, **a})
    if concept_rows:
        db.execute(pg_insert(AuthorConcept).values(concept_rows))
    if affil_rows:
        db.execute(pg_insert(AuthorAffiliation).values(affil_rows))
    db.commit()


def run(from_snapshot: bool = False) -> None:
    db = SessionLocal()
    total = 0
    try:
        if from_snapshot:
            print(f"Reloading from snapshot {SNAPSHOT_PATH}", flush=True)
            with open(SNAPSHOT_PATH) as fh:
                batch = []
                for line in fh:
                    batch.append(json.loads(line))
                    if len(batch) >= PER_PAGE:
                        _upsert_batch(db, batch)
                        total += len(batch)
                        batch = []
                if batch:
                    _upsert_batch(db, batch)
                    total += len(batch)
        else:
            os.makedirs(os.path.dirname(SNAPSHOT_PATH) or ".", exist_ok=True)
            print(
                f"Importing UM authors (institution {UM_INSTITUTION_ID}) "
                f"-> snapshot {SNAPSHOT_PATH}",
                flush=True,
            )
            with open(SNAPSHOT_PATH, "w") as snap:
                batch = []
                for payload in _iter_openalex_um_authors():
                    snap.write(json.dumps(payload) + "\n")
                    batch.append(payload)
                    if len(batch) >= PER_PAGE:
                        _upsert_batch(db, batch)
                        total += len(batch)
                        batch = []
                if batch:
                    _upsert_batch(db, batch)
                    total += len(batch)
    finally:
        db.close()
    print(f"Done. Loaded {total} authors.", flush=True)


if __name__ == "__main__":
    run(from_snapshot="--from-snapshot" in sys.argv)

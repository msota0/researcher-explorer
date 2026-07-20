"""Export / import the collaborator cache as a portable file.

The `collaborators` table is the expensive part of a cold start: filling it means
crawling every UM author's publication history on OpenAlex (see app.prewarm),
which is slow and rate-limited. Once one machine has warmed it, there is no reason
for another to re-crawl -- this moves the cache as a single compressed file.

The file is gzipped JSON Lines (one collaborator edge per line). It is:
  * Portable  - plain text over the wire; no pg_dump/pg_restore version or client
                matching between the exporting and importing Postgres.
  * Small     - only the cache table, not the 42 MB author snapshot (which the
                target already has via data/um_authors.jsonl + app.importer).
  * Idempotent- import upserts by (author_id, collaborator_id), so re-importing
                or importing onto a partially-warm cache just fills/refreshes.

Usage (from the backend directory, venv active, .env pointing at the DB):

  python -m app.transfer export                     # -> collaborators.jsonl.gz
  python -m app.transfer export --out cache.jsonl.gz
  python -m app.transfer import collaborators.jsonl.gz

Typical move: run `export` where the cache is warm, copy the .jsonl.gz to the
other host, run `import` there. No OpenAlex calls happen in either direction.
"""
from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import SessionLocal
from .db_models import Collaborator

DEFAULT_PATH = "collaborators.jsonl.gz"
_BATCH = 5000


def export(path: str = DEFAULT_PATH) -> None:
    db = SessionLocal()
    try:
        total = db.scalar(select(func.count()).select_from(Collaborator)) or 0
        print(f"Exporting {total} collaborator edges -> {path}", flush=True)
        written = 0
        # yield_per streams the table instead of materializing every row at once.
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            for r in db.scalars(select(Collaborator).execution_options(yield_per=_BATCH)):
                fh.write(
                    json.dumps(
                        {
                            "author_id": r.author_id,
                            "collaborator_id": r.collaborator_id,
                            "work_count": r.work_count,
                            "shared_work_ids": r.shared_work_ids or [],
                            "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
                        }
                    )
                    + "\n"
                )
                written += 1
                if written % 50000 == 0:
                    print(f"  {written}/{total} written", flush=True)
    finally:
        db.close()
    print(f"Done. Wrote {written} edges to {path}.", flush=True)


def _flush(db, rows: list[dict]) -> None:
    """Upsert a batch of edges on the (author_id, collaborator_id) primary key."""
    stmt = pg_insert(Collaborator).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Collaborator.author_id, Collaborator.collaborator_id],
        set_={
            "work_count": stmt.excluded.work_count,
            "shared_work_ids": stmt.excluded.shared_work_ids,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    db.execute(stmt)
    db.commit()


def import_(path: str) -> None:
    db = SessionLocal()
    loaded = 0
    try:
        batch: list[dict] = []
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                fetched = rec.get("fetched_at")
                batch.append(
                    {
                        "author_id": rec["author_id"],
                        "collaborator_id": rec["collaborator_id"],
                        "work_count": rec.get("work_count") or 0,
                        "shared_work_ids": rec.get("shared_work_ids") or [],
                        "fetched_at": datetime.fromisoformat(fetched) if fetched else None,
                    }
                )
                if len(batch) >= _BATCH:
                    _flush(db, batch)
                    loaded += len(batch)
                    batch = []
                    print(f"  {loaded} edges imported", flush=True)
        if batch:
            _flush(db, batch)
            loaded += len(batch)
    finally:
        db.close()
    print(f"Done. Imported {loaded} edges from {path}.", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Export/import the collaborator cache.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    ex = sub.add_parser("export", help="dump the collaborators table to a .jsonl.gz file")
    ex.add_argument("--out", default=DEFAULT_PATH, help=f"output path (default {DEFAULT_PATH})")

    im = sub.add_parser("import", help="load a .jsonl.gz file into the collaborators table")
    im.add_argument("path", help="path to the .jsonl.gz file produced by export")

    args = ap.parse_args()
    if args.cmd == "export":
        export(args.out)
    else:
        import_(args.path)


if __name__ == "__main__":
    main()

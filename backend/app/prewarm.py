"""Offline pre-warm of the UM<->UM collaborator cache.

The graph endpoints fetch each author's co-authors from OpenAlex live, then cache
the result in the `collaborators` table (see repository.put_collaborators). On a
cold cache that fetch is slow (it paginates an author's whole publication
history) and, under many concurrent users, hammers OpenAlex's rate limit.

This script does all of that fetching *once*, offline, at a controlled rate, so
that hosted/live traffic is served entirely from Postgres and never touches
OpenAlex. It is:

  * Exact     - it fetches precisely the set of ids the graph would ever fetch
                (each canonical author's merge members), no more.
  * Resumable - already-cached ids are skipped unless --force is given, so you
                can stop and re-run it, or re-run it periodically to refresh.
  * Rate-safe - all OpenAlex calls go through the shared per-process limiter
                (config.OPENALEX_MAX_RPS); run this as a single process and the
                rate ceiling is exact.

Usage (from the backend directory, with the venv active and .env pointing at the
production Postgres):

  python -m app.prewarm                 # fill in everything not yet cached
  python -m app.prewarm --force         # re-fetch and overwrite everything
  python -m app.prewarm --concurrency 4 # gentler on OpenAlex / the DB
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from .config import HTTP_CONCURRENCY, UM_INSTITUTION_NAME
from .db import SessionLocal
from .db_models import Author
from .graph import _RAW_FETCH_CAP
from .merge import get_merge_map
from . import openalex, repository


def _fetch_ids(db, mm) -> list[str]:
    """The exact set of author ids the graph ever crawls collaborators for.

    For every UM author we take its canonical id and union in that canonical's
    merge-member ids (the same list graph._collaborators_um iterates). A
    non-merged author contributes just itself.
    """
    rows = db.scalars(
        select(Author.id).where(
            Author.last_known_institution_name == UM_INSTITUTION_NAME
        )
    ).all()
    fetch: set[str] = set()
    for aid in rows:
        canon = mm.canonical(aid)
        for mid in mm.members.get(canon, [canon]):
            fetch.add(mid)
    return sorted(fetch)


async def prewarm(*, force: bool = False, concurrency: int = HTTP_CONCURRENCY) -> None:
    scan = SessionLocal()
    try:
        mm = get_merge_map(scan)
        all_ids = _fetch_ids(scan, mm)
        if force:
            todo = all_ids
        else:
            todo = [
                aid
                for aid in all_ids
                if repository.get_cached_collaborators(scan, aid) is None
            ]
    finally:
        scan.close()

    total = len(todo)
    print(
        f"{len(all_ids)} author ids in crawl set; "
        f"{total} to fetch{' (forced refresh)' if force else ' (missing from cache)'}.",
        flush=True,
    )
    if not total:
        print("Cache already warm. Nothing to do.", flush=True)
        return

    sem = asyncio.Semaphore(concurrency)
    done = 0
    failures: list[tuple[str, str]] = []
    lock = asyncio.Lock()

    async def one(aid: str) -> None:
        nonlocal done
        try:
            async with sem:
                collabs = await openalex.fetch_collaborators(
                    aid, max_collaborators=_RAW_FETCH_CAP
                )
            # Fresh short-lived session per write: the delete+insert+commit in
            # put_collaborators is fully synchronous, so it runs atomically under
            # asyncio, but a dedicated session keeps state from leaking.
            w = SessionLocal()
            try:
                repository.put_collaborators(w, aid, collabs)
            finally:
                w.close()
        except Exception as exc:  # keep going; one bad author must not abort the run
            async with lock:
                failures.append((aid, f"{type(exc).__name__}: {exc}"))
        finally:
            async with lock:
                done += 1
                if done % 50 == 0 or done == total:
                    print(f"  {done}/{total} fetched", flush=True)

    await asyncio.gather(*[one(aid) for aid in todo])

    print(f"Done. {total - len(failures)}/{total} cached.", flush=True)
    if failures:
        print(f"{len(failures)} failed:", flush=True)
        for aid, err in failures[:20]:
            print(f"  {aid}: {err}", flush=True)
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Pre-warm the collaborator cache.")
    ap.add_argument(
        "--force",
        action="store_true",
        help="re-fetch and overwrite every id, not just uncached ones",
    )
    ap.add_argument(
        "--concurrency",
        type=int,
        default=HTTP_CONCURRENCY,
        help=f"max concurrent author crawls (default {HTTP_CONCURRENCY})",
    )
    args = ap.parse_args()
    asyncio.run(prewarm(force=args.force, concurrency=args.concurrency))


if __name__ == "__main__":
    main()

"""Async OpenAlex client: polite-pool headers, retries, collaborator fetch.

Author records are served from Postgres (see repository.py); this module only
talks to OpenAlex for things not in the dataset, i.e. live collaborator lookups.
"""
from __future__ import annotations

import asyncio
from collections import Counter, defaultdict

import httpx

from .config import (
    MAX_COLLABORATORS_PER_AUTHOR,
    OPENALEX_BASE,
    OPENALEX_MAILTO,
)


def short_id(openalex_id: str) -> str:
    if not openalex_id:
        return openalex_id
    return openalex_id.rsplit("/", 1)[-1]


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=OPENALEX_BASE,
        params={"mailto": OPENALEX_MAILTO},
        headers={"User-Agent": f"researcher-explorer (mailto:{OPENALEX_MAILTO})"},
        timeout=30.0,
    )


async def _get_json(client: httpx.AsyncClient, path: str, **params) -> dict:
    attempts = 0
    while True:
        attempts += 1
        r = await client.get(path, params=params)
        if r.status_code == 429 and attempts <= 4:
            await asyncio.sleep(2 ** attempts)
            continue
        r.raise_for_status()
        return r.json()


async def fetch_collaborators(
    author_id: str, *, max_collaborators: int | None = None
) -> list[dict]:
    """Tally an author's co-authors across all their works (live OpenAlex)."""
    sid = short_id(author_id)
    cap = max_collaborators or MAX_COLLABORATORS_PER_AUTHOR

    counts: Counter[str] = Counter()
    work_ids: dict[str, list[str]] = defaultdict(list)
    names: dict[str, str] = {}

    cursor = "*"
    async with _client() as client:
        while cursor:
            data = await _get_json(
                client,
                "/works",
                filter=f"author.id:{sid}",
                per_page=200,
                cursor=cursor,
                select="id,authorships",
            )
            for w in data.get("results", []):
                wid = short_id(w["id"])
                for ship in w.get("authorships", []):
                    author = ship.get("author", {})
                    coid = short_id(author.get("id") or "")
                    if not coid or coid == sid:
                        continue
                    counts[coid] += 1
                    work_ids[coid].append(wid)
                    names.setdefault(coid, author.get("display_name") or coid)
            cursor = data.get("meta", {}).get("next_cursor")
            if not cursor or len(counts) > 5000:
                break

    ranked = counts.most_common(cap)
    return [
        {
            "id": cid,
            "display_name": names.get(cid, cid),
            "work_count": cnt,
            "work_ids": work_ids[cid][:25],
        }
        for cid, cnt in ranked
    ]

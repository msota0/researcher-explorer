"""Async OpenAlex client: polite-pool headers, retries, collaborator fetch.

Author records are served from Postgres (see repository.py); this module only
talks to OpenAlex for things not in the dataset, i.e. live collaborator lookups.
"""
from __future__ import annotations

import asyncio
import time
from collections import Counter, defaultdict

import httpx

from .config import (
    MAX_COLLABORATORS_PER_AUTHOR,
    OPENALEX_BASE,
    OPENALEX_MAILTO,
    OPENALEX_MAX_RPS,
)


class _RateLimiter:
    """Process-wide async token spacer: at most `rate` requests per second.

    Serializes only the *scheduling* of requests (spaced by 1/rate); the HTTP
    calls themselves still overlap. Shared by live graph fetches and the offline
    prewarm so nothing in this process exceeds the polite-pool ceiling.
    """

    def __init__(self, rate_per_sec: float) -> None:
        self._interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0.0
        self._lock = asyncio.Lock()
        self._next = 0.0

    async def acquire(self) -> None:
        if self._interval <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            wait = self._next - now
            if wait > 0:
                await asyncio.sleep(wait)
                now = time.monotonic()
            self._next = max(now, self._next) + self._interval


_rate_limiter = _RateLimiter(OPENALEX_MAX_RPS)


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
        await _rate_limiter.acquire()
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

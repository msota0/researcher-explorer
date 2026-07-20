"""Async OpenAlex client: polite-pool headers, retries, collaborator fetch.

Author records are served from Postgres (see repository.py); this module only
talks to OpenAlex for things not in the dataset, i.e. live collaborator lookups.
"""
from __future__ import annotations

import asyncio
import random
import time
from collections import Counter, defaultdict

import httpx

from .config import (
    MAX_COLLABORATORS_PER_AUTHOR,
    OPENALEX_BASE,
    OPENALEX_MAILTO,
    OPENALEX_MAX_RETRIES,
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

    async def pause(self, seconds: float) -> None:
        """Globally defer the *next* allowed request by `seconds`.

        Called when OpenAlex returns 429: instead of each coroutine backing off
        on its own (which lets them all retry together and re-trip the limit),
        we push the shared schedule forward so every in-flight and queued
        request waits out the cooldown as one. Uses max() so concurrent 429s
        collapse into a single cooldown rather than stacking.
        """
        async with self._lock:
            self._next = max(self._next, time.monotonic() + seconds)


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


def _retry_after_seconds(value: str | None) -> float | None:
    """Parse a Retry-After header. OpenAlex sends an integer number of seconds;
    fall back to None (caller uses exponential backoff) for anything else."""
    if not value:
        return None
    try:
        return max(0.0, float(value.strip()))
    except ValueError:
        return None  # HTTP-date form: ignore, let the caller back off instead


async def _get_json(client: httpx.AsyncClient, path: str, **params) -> dict:
    attempts = 0
    while True:
        attempts += 1
        await _rate_limiter.acquire()
        r = await client.get(path, params=params)
        if r.status_code == 429 and attempts <= OPENALEX_MAX_RETRIES:
            # Prefer the server's Retry-After; otherwise exponential backoff
            # capped at 60s. Add jitter so many crawls don't resume in lockstep.
            hinted = _retry_after_seconds(r.headers.get("Retry-After"))
            backoff = hinted if hinted is not None else min(60.0, 2.0 ** attempts)
            backoff += random.uniform(0, 1.0)
            # Pause the whole process, not just this coroutine, so we actually
            # let the rate limit recover instead of hammering it in parallel.
            await _rate_limiter.pause(backoff)
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

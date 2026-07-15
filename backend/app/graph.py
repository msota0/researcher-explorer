"""Graph expansion restricted to the UM author dataset.

The root must be a UM author. Collaborators are fetched live from OpenAlex,
then filtered down to co-authors who are themselves UM authors, so every node
and edge in the graph stays within University of Mississippi.
"""
from __future__ import annotations

import asyncio

from sqlalchemy.orm import Session

from .config import HTTP_CONCURRENCY, MAX_COLLABORATORS_PER_AUTHOR
from .mapping import to_summary
from .merge import MergeMap, get_merge_map
from .models import GraphEdge, GraphLinks, GraphNode, GraphPayload
from . import openalex, repository

# Pull a wide net of co-authors before filtering to UM.
_RAW_FETCH_CAP = 200

# Bound concurrent OpenAlex crawls (each call paginates an author's full works).
_fetch_sem = asyncio.Semaphore(HTTP_CONCURRENCY)


async def _collaborators_um(
    db: Session, node_id: str, *, max_per_node: int, mm: MergeMap
) -> list[dict]:
    """UM-only collaborators for one (canonical) node, with a DB-backed cache.

    Collaborator ids are remapped to their canonical id so an ORCID-duplicate
    can never appear as a separate node; remapped duplicates have their work
    counts summed.
    """
    raw: list[dict] = []
    for member_id in mm.members.get(node_id, [node_id]):
        cached = repository.get_cached_collaborators(db, member_id)
        if cached is None:
            cached = await openalex.fetch_collaborators(
                member_id, max_collaborators=_RAW_FETCH_CAP
            )
            repository.put_collaborators(db, member_id, cached)
        raw.extend(cached)

    merged: dict[str, dict] = {}
    for c in raw:
        cid = mm.canonical(c["id"])
        if cid == node_id:
            continue  # self-loop after remap
        e = merged.get(cid)
        if e is None:
            merged[cid] = {
                "id": cid,
                "work_count": c["work_count"],
                "work_ids": list(c.get("work_ids") or []),
            }
        else:
            e["work_count"] += c["work_count"]
            e["work_ids"] = list({*e["work_ids"], *(c.get("work_ids") or [])})

    cand = list(merged.values())
    um = repository.um_ids_among(db, [c["id"] for c in cand])
    um_collabs = [c for c in cand if c["id"] in um]
    um_collabs.sort(key=lambda c: c["work_count"], reverse=True)
    return um_collabs[:max_per_node]


async def expand(
    db: Session,
    root_id: str,
    depth: int = 1,
    *,
    max_per_node: int = MAX_COLLABORATORS_PER_AUTHOR,
) -> GraphPayload:
    mm = get_merge_map(db)
    root_short = mm.canonical(openalex.short_id(root_id))
    if not repository.author_exists(db, root_short):
        raise LookupError(f"{root_short} is not a University of Mississippi author")

    visited: set[str] = {root_short}
    node_depth: dict[str, int] = {root_short: 0}
    frontier: list[tuple[str, int]] = [(root_short, 0)]
    edge_acc: dict[frozenset, tuple[int, list[str]]] = {}

    while frontier:
        current_level = [(nid, d) for nid, d in frontier if d < depth]
        frontier = []
        if not current_level:
            break

        results = await asyncio.gather(
            *[_collaborators_um(db, nid, max_per_node=max_per_node, mm=mm)
              for nid, _ in current_level]
        )
        for (nid, d), collabs in zip(current_level, results):
            for c in collabs:
                cid = c["id"]
                key = frozenset({nid, cid})
                prev = edge_acc.get(key)
                if prev is None or c["work_count"] > prev[0]:
                    edge_acc[key] = (c["work_count"], c.get("work_ids") or [])
                if cid not in node_depth:
                    node_depth[cid] = d + 1
                    visited.add(cid)
                    if d + 1 < depth:
                        frontier.append((cid, d + 1))

    payloads = repository.get_authors_raw(db, list(visited))
    nodes = []
    for nid in visited:
        if nid not in payloads:
            continue
        summary = to_summary(payloads[nid])
        ov = mm.stats.get(nid)
        if ov:
            summary.works_count = ov["works_count"]
            summary.cited_by_count = ov["cited_by_count"]
            summary.h_index = ov["h_index"]
        nodes.append(GraphNode(id=nid, depth=node_depth[nid], data=summary))
    edges = []
    for key, (weight, work_ids) in edge_acc.items():
        a, b = tuple(key)
        if a in payloads and b in payloads:
            edges.append(
                GraphEdge(source=a, target=b, weight=weight, shared_work_ids=work_ids)
            )

    return GraphPayload(root_id=root_short, nodes=nodes, edges=edges)


async def internal_links(db: Session, ids: list[str]) -> GraphLinks:
    """Edges *among* an existing set of nodes — no new nodes are introduced.

    Used by the "connect visible" action so a lazily-loaded node reveals its real
    connections to authors already on screen without expanding the graph outward.
    DB access stays sequential (one session); only the OpenAlex crawls run
    concurrently (bounded).
    """
    mm = get_merge_map(db)
    canon_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in ids:
        cid = mm.canonical(openalex.short_id(raw_id))
        if cid not in seen and repository.author_exists(db, cid):
            seen.add(cid)
            canon_ids.append(cid)
    idset = set(canon_ids)
    if len(canon_ids) < 2:
        return GraphLinks(edges=[])

    # Per node, the member ids whose collaborators we union (handles merged people).
    node_members = {nid: mm.members.get(nid, [nid]) for nid in canon_ids}

    # Read cache sequentially; collect the misses to fetch over the network.
    raw_by_member: dict[str, list[dict]] = {}
    misses: list[str] = []
    for members in node_members.values():
        for mid in members:
            if mid in raw_by_member or mid in misses:
                continue
            cached = repository.get_cached_collaborators(db, mid)
            if cached is None:
                misses.append(mid)
            else:
                raw_by_member[mid] = cached

    async def _fetch(mid: str) -> tuple[str, list[dict]]:
        async with _fetch_sem:
            return mid, await openalex.fetch_collaborators(mid, max_collaborators=_RAW_FETCH_CAP)

    if misses:
        for mid, lst in await asyncio.gather(*[_fetch(m) for m in misses]):
            raw_by_member[mid] = lst
            repository.put_collaborators(db, mid, lst)  # sequential write

    edge_acc: dict[frozenset, int] = {}
    for nid in canon_ids:
        weights: dict[str, int] = {}
        for mid in node_members[nid]:
            for c in raw_by_member.get(mid, []):
                cid = mm.canonical(c["id"])
                if cid == nid:
                    continue
                weights[cid] = weights.get(cid, 0) + c["work_count"]
        for cid, w in weights.items():
            if cid in idset:
                key = frozenset({nid, cid})
                if w > edge_acc.get(key, 0):
                    edge_acc[key] = w

    edges = []
    for key, weight in edge_acc.items():
        a, b = tuple(key)
        edges.append(GraphEdge(source=a, target=b, weight=weight, shared_work_ids=[]))
    return GraphLinks(edges=edges)

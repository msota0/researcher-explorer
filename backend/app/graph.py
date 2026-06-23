"""Graph expansion restricted to the UM author dataset.

The root must be a UM author. Collaborators are fetched live from OpenAlex,
then filtered down to co-authors who are themselves UM authors, so every node
and edge in the graph stays within University of Mississippi.
"""
from __future__ import annotations

import asyncio

from sqlalchemy.orm import Session

from .config import MAX_COLLABORATORS_PER_AUTHOR
from .mapping import to_summary
from .models import GraphEdge, GraphNode, GraphPayload
from . import openalex, repository

# Pull a wide net of co-authors before filtering to UM.
_RAW_FETCH_CAP = 200


async def _collaborators_um(
    db: Session, node_id: str, *, max_per_node: int
) -> list[dict]:
    """UM-only collaborators for one node, with a DB-backed cache."""
    cached = repository.get_cached_collaborators(db, node_id)
    if cached is None:
        fetched = await openalex.fetch_collaborators(
            node_id, max_collaborators=_RAW_FETCH_CAP
        )
        repository.put_collaborators(db, node_id, fetched)
        cached = fetched

    um = repository.um_ids_among(db, [c["id"] for c in cached])
    um_collabs = [c for c in cached if c["id"] in um]
    um_collabs.sort(key=lambda c: c["work_count"], reverse=True)
    return um_collabs[:max_per_node]


async def expand(
    db: Session,
    root_id: str,
    depth: int = 1,
    *,
    max_per_node: int = MAX_COLLABORATORS_PER_AUTHOR,
) -> GraphPayload:
    root_short = openalex.short_id(root_id)
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
            *[_collaborators_um(db, nid, max_per_node=max_per_node)
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
    nodes = [
        GraphNode(id=nid, depth=node_depth[nid], data=to_summary(payloads[nid]))
        for nid in visited
        if nid in payloads
    ]
    edges = []
    for key, (weight, work_ids) in edge_acc.items():
        a, b = tuple(key)
        if a in payloads and b in payloads:
            edges.append(
                GraphEdge(source=a, target=b, weight=weight, shared_work_ids=work_ids)
            )

    return GraphPayload(root_id=root_short, nodes=nodes, edges=edges)

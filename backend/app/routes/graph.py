from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import graph
from ..config import MAX_COLLABORATORS_PER_AUTHOR
from ..db import get_session
from ..models import GraphLinks, GraphPayload

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("/links", response_model=GraphLinks)
async def links(
    ids: str = Query(..., description="Comma-separated author ids already in the graph"),
    db: Session = Depends(get_session),
):
    """Edges among the given nodes only — fills in connections, adds no nodes."""
    id_list = [x for x in ids.split(",") if x.strip()]
    return await graph.internal_links(db, id_list)


@router.get("/expand", response_model=GraphPayload)
async def expand(
    author_id: str = Query(..., description="OpenAlex author id (e.g. A1234567)"),
    depth: int = Query(1, ge=0, le=3),
    max_per_node: int = Query(MAX_COLLABORATORS_PER_AUTHOR, ge=1, le=200),
    db: Session = Depends(get_session),
):
    """Subgraph of UM co-authors reachable from `author_id` within `depth` hops."""
    try:
        return await graph.expand(db, author_id, depth=depth, max_per_node=max_per_node)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {exc}")

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import repository
from ..db import get_session
from ..mapping import to_detail
from ..merge import get_merge_map
from ..models import AuthorDetail

router = APIRouter(prefix="/api/authors", tags=["authors"])


# These routes do only synchronous Postgres work. Defining them as `def` (not
# `async def`) makes FastAPI run them in its threadpool, so a slow query never
# blocks the worker's event loop / the concurrent graph requests it is serving.
@router.get("/search")
def search(
    q: str = Query(..., min_length=2),
    limit: int = 10,
    db: Session = Depends(get_session),
):
    """Search within the University of Mississippi author dataset."""
    return repository.search_authors(db, q, limit=limit)


@router.get("/browse")
def browse(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str = Query("works_count"),
    db: Session = Depends(get_session),
):
    """Paginated directory of all UM authors."""
    return repository.list_authors(db, limit=limit, offset=offset, sort=sort)


@router.get("/{author_id}", response_model=AuthorDetail)
def get(author_id: str, db: Session = Depends(get_session)):
    # Resolve an ORCID-duplicate id to its canonical record so a phantom/alias
    # id still loads the merged author.
    mm = get_merge_map(db)
    canonical = mm.canonical(author_id)
    raw = repository.get_author_raw(db, canonical)
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail=f"{author_id} is not in the University of Mississippi dataset",
        )
    detail = to_detail(raw)
    ov = mm.stats.get(canonical)
    if ov:
        detail.works_count = ov["works_count"]
        detail.cited_by_count = ov["cited_by_count"]
        detail.h_index = ov["h_index"]
    return detail

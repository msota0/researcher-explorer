from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import repository
from ..db import get_session
from ..mapping import to_detail
from ..models import AuthorDetail

router = APIRouter(prefix="/api/authors", tags=["authors"])


@router.get("/search")
async def search(
    q: str = Query(..., min_length=2),
    limit: int = 10,
    db: Session = Depends(get_session),
):
    """Search within the University of Mississippi author dataset."""
    return repository.search_authors(db, q, limit=limit)


@router.get("/browse")
async def browse(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str = Query("works_count"),
    db: Session = Depends(get_session),
):
    """Paginated directory of all UM authors."""
    return repository.list_authors(db, limit=limit, offset=offset, sort=sort)


@router.get("/{author_id}", response_model=AuthorDetail)
async def get(author_id: str, db: Session = Depends(get_session)):
    raw = repository.get_author_raw(db, author_id)
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail=f"{author_id} is not in the University of Mississippi dataset",
        )
    return to_detail(raw)
